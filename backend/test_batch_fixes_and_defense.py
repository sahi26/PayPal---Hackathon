import unittest
import os
import io
import json
from datetime import datetime, date, timedelta
from fastapi.testclient import TestClient
from main import app, get_db, calculate_milestone_deadlines, normalize_milestone_schedule, apply_negotiated_deadlines, validate_file_format_against_proof_requirement
from database import Base, engine, SessionLocal
import models

client = TestClient(app)

class TestBatchFixesAndDefense(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        Base.metadata.create_all(bind=engine)

    def setUp(self):
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_t_plus_1_milestone_calculation(self):
        """Phase 1: T+1 Milestone Calculation anchoring strictly to next calendar day"""
        created = date(2026, 11, 2)
        # 1-day project: sole milestone strictly due Nov 3 (T+1)
        deadlines_1day = calculate_milestone_deadlines(
            deadline_str="2026-11-03",
            num_milestones=None,
            created_at=created,
            total_price=100.0
        )
        self.assertEqual(len(deadlines_1day), 1)
        self.assertEqual(deadlines_1day[0], "2026-11-03")

        # Multi-day project: First milestone anchors strictly to T+1 (Nov 3)
        deadlines_multi = calculate_milestone_deadlines(
            deadline_str="2026-11-15",
            num_milestones=3,
            created_at=created,
            total_price=500.0
        )
        self.assertGreaterEqual(len(deadlines_multi), 2)
        self.assertEqual(deadlines_multi[0], "2026-11-03")
        self.assertEqual(deadlines_multi[-1], "2026-11-15")

    def test_schedule_normalization_matches_project_duration(self):
        created = datetime(2026, 11, 5)
        milestones = [
            {"title": "Concepts", "description": "Create concepts", "proof_required": "Concept deck", "price_allocation": 600},
            {"title": "Handover", "description": "Deliver final files", "proof_required": "Source files", "price_allocation": 600},
        ]

        one_day = normalize_milestone_schedule(
            milestones,
            "2026-11-06",
            created_at=created,
            total_price=1200
        )
        self.assertEqual(len(one_day), 1)
        self.assertEqual(one_day[0]["deadline"], "2026-11-06")
        self.assertEqual(one_day[0]["price_allocation"], 1200)
        self.assertIn("Create concepts", one_day[0]["description"])
        self.assertIn("Deliver final files", one_day[0]["description"])

        two_days = normalize_milestone_schedule(
            [
                {"title": "Planning", "description": "Plan work", "proof_required": "Plan", "price_allocation": 200},
                {"title": "Build", "description": "Build scope", "proof_required": "Build proof", "price_allocation": 400},
                {"title": "Delivery", "description": "Deliver work", "proof_required": "Final proof", "price_allocation": 600},
            ],
            "2026-11-07",
            created_at=created,
            total_price=1200
        )
        self.assertEqual(len(two_days), 2)
        self.assertEqual([m["deadline"] for m in two_days], ["2026-11-06", "2026-11-07"])
        self.assertEqual(sum(m["price_allocation"] for m in two_days), 1200)

    def test_negotiated_two_day_total_ends_on_second_project_day(self):
        created = datetime(2026, 11, 5)
        milestones, updated = apply_negotiated_deadlines(
            [
                {"title": "Milestone 1", "deadline": "2026-11-06"},
                {"title": "Milestone 2", "deadline": "2026-11-06"}
            ],
            seller_request="I need 2 days instead of 1 day",
            buyer_response="I accept 2 days of scheduled delivery",
            project_deadline="2026-11-06",
            created_at=created
        )

        self.assertTrue(updated)
        self.assertEqual([m["deadline"] for m in milestones], ["2026-11-06", "2026-11-07"])
        self.assertEqual([m["relative_deadline"] for m in milestones], [
            "Due 1 day from project creation",
            "Due 2 days from project creation"
        ])

        plain_duration_milestones, _ = apply_negotiated_deadlines(
            [
                {"title": "Milestone 1", "deadline": "2026-11-06"},
                {"title": "Milestone 2", "deadline": "2026-11-06"}
            ],
            buyer_response="I need 2 days of scheduled delivery",
            project_deadline="2026-11-06",
            created_at=created
        )
        self.assertEqual(
            [m["deadline"] for m in plain_duration_milestones],
            ["2026-11-06", "2026-11-07"]
        )

    def test_agreement_edit_locking(self):
        """Phase 1: Seller 403 Forbidden blocks and Buyer locked on ACCEPTED status"""
        # Create test project
        project = models.Project(
            title="Locking Test Project",
            industry_type="Digital Art",
            description="Logo design",
            total_price=300.0,
            status=models.ProjectStatus.DRAFT
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        agreement = models.Agreement(
            project_id=project.id,
            version=1,
            status="ACTIVE",
            milestones=[{"title": "M1", "price_allocation": 300.0, "deadline": "2026-11-05"}]
        )
        self.db.add(agreement)
        self.db.commit()

        # 1. Seller block
        res = client.post(
            f"/api/projects/{project.id}/update-milestones",
            json={
                "milestones": [{"title": "M1", "price_allocation": 400.0, "deadline": "2026-11-08"}],
                "role": "seller"
            }
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn("Seller cannot manually edit", res.json()["detail"])

        # 2. Buyer can edit before acceptance
        res = client.post(
            f"/api/projects/{project.id}/update-milestones",
            json={
                "milestones": [{"title": "M1", "price_allocation": 300.0, "deadline": "2026-11-06"}],
                "role": "buyer"
            }
        )
        self.assertEqual(res.status_code, 200)

        # 3. Transition to ACCEPTED -> Buyer is now locked
        agreement.status = "ACCEPTED"
        project.status = models.ProjectStatus.ACCEPTED
        self.db.commit()

        res_locked = client.post(
            f"/api/projects/{project.id}/update-milestones",
            json={
                "milestones": [{"title": "M1", "price_allocation": 350.0, "deadline": "2026-11-09"}],
                "role": "buyer"
            }
        )
        self.assertEqual(res_locked.status_code, 403)
        self.assertIn("Agreement is locked", res_locked.json()["detail"])

    def test_dynamic_physical_challenge_endpoint(self):
        """Phase 2: Dynamic Physical Challenge Token endpoint"""
        project = models.Project(
            title="Challenge Test Project",
            industry_type="Home Renovation",
            description="Custom shelving",
            total_price=450.0,
            status=models.ProjectStatus.ACTIVE
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        res = client.get(f"/api/projects/{project.id}/challenge-token")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["token"].startswith("CHAL-"))
        self.assertIn("instruction", data)
        self.assertIn("action", data)
        self.assertIn("code", data)

    def test_strict_file_format_mapping(self):
        """Phase 2: Strict File & Format Mapping rejection before deep analysis"""
        # 1. Zip requirement rejects image file
        with self.assertRaises(Exception) as ctx:
            validate_file_format_against_proof_requirement(
                filename="submission.png",
                proof_required="Deliver complete source code repository in a .zip archive"
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn(".zip archive", ctx.exception.detail)

        # 2. Visual requirement rejects .dmg executable
        with self.assertRaises(Exception) as ctx:
            validate_file_format_against_proof_requirement(
                filename="installer.dmg",
                proof_required="High-resolution presentation deck with PNG/SVG vector logos"
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("visual/vector deliverables", ctx.exception.detail)

        # 3. Valid files pass without exception
        try:
            validate_file_format_against_proof_requirement(
                filename="deliverables.zip",
                proof_required="Deliver complete source code repository in a .zip archive"
            )
            validate_file_format_against_proof_requirement(
                filename="vector_logo.svg",
                proof_required="High-resolution presentation deck with PNG/SVG vector logos"
            )
        except Exception:
            self.fail("validate_file_format_against_proof_requirement raised exception on valid format")

    def test_early_warranty_fund_release(self):
        """Phase 4: Early Warranty Retainage Fund Release"""
        project = models.Project(
            title="Warranty Release Test",
            industry_type="Home Renovation",
            description="Wood table fabrication",
            total_price=500.0,
            status=models.ProjectStatus.WARRANTY_PERIOD
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        agreement = models.Agreement(
            project_id=project.id,
            version=1,
            status="WARRANTY_PERIOD",
            lock_in_type="FINAL_MILESTONE",
            lock_in_amount=75.0,
            lock_in_days=14,
            warranty_end_date=datetime.utcnow() + timedelta(days=14),
            warranty_payout_status="PENDING"
        )
        self.db.add(agreement)
        self.db.commit()

        res = client.post(f"/api/projects/{project.id}/warranty/early-release")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["amount"], 75.0)

        self.db.refresh(project)
        self.db.refresh(agreement)
        self.assertEqual(project.status, models.ProjectStatus.COMPLETED)
        self.assertEqual(agreement.warranty_payout_status, "SUCCESS")

    def test_retainage_final_milestone_and_custom_preservation(self):
        """Retainage logic: FINAL_MILESTONE dynamically tracks final milestone; CUSTOM remains fixed"""
        # 1. FINAL_MILESTONE project
        project = models.Project(
            title="Final Milestone Retainage Test",
            industry_type="Digital Art",
            description="Vector logo",
            total_price=305.0,
            status=models.ProjectStatus.ACTIVE
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        milestones = [
            {"title": "M1", "price_allocation": 90.0, "status": "approved"},
            {"title": "M2", "price_allocation": 120.0, "status": "approved"},
            {"title": "M3", "price_allocation": 90.0, "status": "approved"},
            {"title": "M4 Addendum", "price_allocation": 5.0, "status": "pending"}
        ]
        agreement = models.Agreement(
            project_id=project.id,
            version=2,
            status="ACTIVE",
            milestones=milestones,
            lock_in_type="FINAL_MILESTONE",
            lock_in_amount=90.0, # old amount from M3
            lock_in_days=14
        )
        self.db.add(agreement)
        self.db.commit()

        # Approve Milestone 4 (index 3)
        res = client.post(f"/api/milestones/{project.id}_3/approve")
        self.assertEqual(res.status_code, 200)

        self.db.refresh(project)
        self.db.refresh(agreement)
        # Lock in amount should now be updated to M4's amount ($5.0)
        self.assertEqual(agreement.lock_in_amount, 5.0)
        self.assertEqual(project.status, models.ProjectStatus.WARRANTY_PERIOD)
        self.assertEqual(agreement.status, "WARRANTY_PERIOD")

        # 2. CUSTOM retainage project: do not change amount!
        project_custom = models.Project(
            title="Custom Retainage Test",
            industry_type="Digital Art",
            description="Vector logo custom hold",
            total_price=305.0,
            status=models.ProjectStatus.ACTIVE
        )
        self.db.add(project_custom)
        self.db.commit()
        self.db.refresh(project_custom)

        custom_milestones = [
            {"title": "M1", "price_allocation": 90.0, "status": "approved"},
            {"title": "M2 Addendum", "price_allocation": 15.0, "status": "pending"}
        ]
        ag_custom = models.Agreement(
            project_id=project_custom.id,
            version=2,
            status="ACTIVE",
            milestones=custom_milestones,
            lock_in_type="CUSTOM",
            lock_in_amount=40.0, # custom retainage of $40
            lock_in_days=14
        )
        self.db.add(ag_custom)
        self.db.commit()

        # Approve final milestone M2 (index 1)
        res_custom = client.post(f"/api/milestones/{project_custom.id}_1/approve")
        self.assertEqual(res_custom.status_code, 200)

        self.db.refresh(project_custom)
        self.db.refresh(ag_custom)
        # Lock in amount MUST REMAIN 40.0 (custom retainage unchanged!)
        self.assertEqual(ag_custom.lock_in_amount, 40.0)
        self.assertEqual(project_custom.status, models.ProjectStatus.WARRANTY_PERIOD)

    def test_get_project_self_heals_status_when_milestone_pending(self):
        """get_project automatically self-heals status from WARRANTY_PERIOD to ACTIVE when addendum milestones are pending"""
        project = models.Project(
            title="Self-healing project",
            industry_type="Digital Art",
            description="Testing addendum pending status",
            total_price=305.0,
            status=models.ProjectStatus.WARRANTY_PERIOD # stuck in WARRANTY_PERIOD
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        milestones = [
            {"title": "M1", "price_allocation": 100.0, "status": "approved"},
            {"title": "M2 New Addendum", "price_allocation": 25.0, "status": "pending"}
        ]
        agreement = models.Agreement(
            project_id=project.id,
            version=2,
            status="ACTIVE",
            milestones=milestones,
            lock_in_type="FINAL_MILESTONE",
            lock_in_amount=100.0,
            lock_in_days=14
        )
        self.db.add(agreement)
        self.db.commit()

        res = client.get(f"/api/projects/{project.id}")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["project"]["status"].lower(), "active")
        self.assertEqual(data["agreement"]["lock_in_type"], "FINAL_MILESTONE")
        self.assertEqual(data["agreement"]["lock_in_amount"], 25.0)

if __name__ == "__main__":
    unittest.main()
