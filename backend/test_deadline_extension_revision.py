import unittest
from fastapi.testclient import TestClient
from datetime import datetime, date, timedelta
try:
    from main import app
    from database import SessionLocal, run_migrations, engine
    import models
except ImportError:
    from backend.main import app
    from backend.database import SessionLocal, run_migrations, engine
    from backend import models

class TestDeadlineExtensionRevision(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        run_migrations(engine)
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_seller_deadline_extension_revision(self):
        """
        Tests the exact user scenario:
        When a seller requests an extension of deadline (e.g., +7 days) with $0 additional cost,
        and buyer accepts it:
        1. No phantom costs or extra milestones are generated.
        2. No PayPal supplemental escrow blocks acceptance.
        3. Agreement transitions to version 2 (ACTIVE), old becomes SUPERSEDED.
        4. All uncompleted milestone deadlines in the agreement shift forward by proposed_extra_days.
        5. Project deadline shifts forward by proposed_extra_days.
        6. GET /api/projects/{id} returns the new active agreement and shifted deadlines.
        """
        # 1. Setup users
        ts = datetime.utcnow().timestamp()
        buyer = models.User(
            email=f"buyer_deadline_{ts}@prooflens.com",
            password_hash="mock_hash",
            full_name="Alice Buyer",
            role_type="buyer"
        )
        seller = models.User(
            email=f"seller_deadline_{ts}@prooflens.com",
            password_hash="mock_hash",
            full_name="Bob Contractor",
            role_type="seller"
        )
        self.db.add(buyer)
        self.db.add(seller)
        self.db.commit()
        self.db.refresh(buyer)
        self.db.refresh(seller)

        # 2. Setup project with 3 milestones and deadline 2026-11-20
        project = models.Project(
            title="Custom Oak Dining Table",
            industry_type="Carpentry",
            description="Solid white oak dining table with mortise and tenon joinery.",
            total_price=300.0,
            deadline="2026-11-20",
            buyer_id=buyer.id,
            seller_id=seller.id,
            status=models.ProjectStatus.ACTIVE
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        initial_milestones = [
            {
                "title": "White Oak Lumber Selection & Milling",
                "description": "Lumber purchase and rough dimensioning",
                "price_allocation": 90.0,
                "deadline": "2026-11-05",
                "relative_deadline": "Due in 5 days",
                "proof_required": "Live photo with calipers",
                "status": "approved"  # Completed
            },
            {
                "title": "Full Assembly & Precision Surface Sanding",
                "description": "Joinery and assembly",
                "price_allocation": 120.0,
                "deadline": "2026-11-12",
                "relative_deadline": "Due in 12 days",
                "proof_required": "Photos of squareness and joinery",
                "status": "pending"  # Uncompleted (should shift)
            },
            {
                "title": "Protective Multi-Coat Finish & Delivery",
                "description": "Finishing and delivery",
                "price_allocation": 90.0,
                "deadline": "2026-11-20",
                "relative_deadline": "Due in 20 days",
                "proof_required": "Live video of table and dispatch receipt",
                "status": "pending"  # Uncompleted (should shift)
            }
        ]

        agreement_v1 = models.Agreement(
            project_id=project.id,
            version=1,
            status="ACTIVE",
            is_accepted_by_client=1,
            ai_generated_contract="Standard Master Service Agreement v1.0",
            evidence_requirements="High-resolution physical proof photos.",
            milestones=initial_milestones
        )
        self.db.add(agreement_v1)
        self.db.commit()
        self.db.refresh(agreement_v1)

        project_id = project.id

        # 3. Seller requests a 7-day timeline extension with $0 cost
        init_payload = {
            "description": "Need to extend deadline by 7 days due to lumber kiln drying delay. No additional cost.",
            "user_email": seller.email,
            "proposed_extra_days": 7,
            "proposed_extra_cost": 0.0
        }
        init_resp = self.client.post(f"/api/projects/{project_id}/scope-change/init", json=init_payload)
        self.assertEqual(init_resp.status_code, 200, init_resp.text)
        sc = init_resp.json()["scope_change"]

        self.assertEqual(sc["proposed_extra_days"], 7)
        self.assertEqual(sc["proposed_extra_cost"], 0.0)
        self.assertEqual(sc["status"], "NEGOTIATING")
        sc_id = sc["id"]

        # 4. Check active scope change endpoint
        active_resp = self.client.get(f"/api/projects/{project_id}/scope-change/active")
        self.assertEqual(active_resp.status_code, 200)
        self.assertTrue(active_resp.json()["has_active_request"])

        # 5. Buyer accepts the revision
        accept_payload = {
            "scope_change_id": sc_id,
            "user_email": buyer.email
        }
        accept_resp = self.client.post(f"/api/projects/{project_id}/scope-change/accept", json=accept_payload)
        self.assertEqual(accept_resp.status_code, 200, accept_resp.text)
        accept_data = accept_resp.json()

        # Must be immediately ACCEPTED without requiring PayPal escrow checkout
        self.assertEqual(accept_data["status"], "ACCEPTED")
        self.assertEqual(accept_data["agreement_version"], 2)
        self.assertEqual(accept_data["project"]["total_price"], 300.0) # No unwanted fee added
        self.assertEqual(accept_data["project"]["deadline"], "2026-11-27") # 2026-11-20 + 7 days = 2026-11-27

        # 6. Verify shifted milestone deadlines in accept response
        revised_milestones = accept_data["milestones"]
        self.assertEqual(len(revised_milestones), 3)

        # Milestone 1 (approved) stays at 2026-11-05
        self.assertEqual(revised_milestones[0]["deadline"], "2026-11-05")
        self.assertEqual(revised_milestones[0]["status"], "approved")

        # Milestone 2 (uncompleted) shifted +7 days: 2026-11-12 -> 2026-11-19
        self.assertEqual(revised_milestones[1]["deadline"], "2026-11-19")

        # Milestone 3 (uncompleted) shifted +7 days: 2026-11-20 -> 2026-11-27
        self.assertEqual(revised_milestones[2]["deadline"], "2026-11-27")

        # 7. Verify GET /api/projects/{id} returns the new Version 2 Agreement with shifted deadlines
        get_proj = self.client.get(f"/api/projects/{project_id}")
        self.assertEqual(get_proj.status_code, 200)
        p_json = get_proj.json()

        self.assertEqual(p_json["project"]["deadline"], "2026-11-27")
        self.assertEqual(p_json["agreement"]["version"], 2)
        self.assertEqual(p_json["agreement"]["status"], "ACTIVE")

        # Active agreement milestones must match the shifted deadlines
        ag_milestones = p_json["agreement"]["milestones"]
        self.assertEqual(ag_milestones[0]["deadline"], "2026-11-05")
        self.assertEqual(ag_milestones[1]["deadline"], "2026-11-19")
        self.assertEqual(ag_milestones[2]["deadline"], "2026-11-27")

        # 8. Verify database agreements version history
        check_db = SessionLocal()
        agreements = check_db.query(models.Agreement).filter(models.Agreement.project_id == project_id).order_by(models.Agreement.version.asc()).all()
        self.assertEqual(len(agreements), 2)
        self.assertEqual(agreements[0].version, 1)
        self.assertEqual(agreements[0].status, "SUPERSEDED")
        self.assertEqual(agreements[1].version, 2)
        self.assertEqual(agreements[1].status, "ACTIVE")
        check_db.close()

    def test_negotiation_room_deadline_change_dynamic_sync(self):
        """
        Tests the specific scenario from the user screenshot:
        When seller submits modification request 'I need 5 days to complete the work',
        and buyer regenerates agreement and dispatches updated terms:
        1. All milestone deadlines shift forward by 5 days.
        2. Overall project target due date (project.deadline) is dynamically updated to the final milestone date.
        3. GET /api/projects/{id} returns the new project.deadline and updated milestone dates.
        """
        ts = datetime.utcnow().timestamp()
        buyer = models.User(
            email=f"buyer_nego_{ts}@prooflens.com",
            password_hash="mock_hash",
            full_name="Alice Buyer",
            role_type="buyer"
        )
        seller = models.User(
            email=f"seller_nego_{ts}@prooflens.com",
            password_hash="mock_hash",
            full_name="Bob Contractor",
            role_type="seller"
        )
        self.db.add(buyer)
        self.db.add(seller)
        self.db.commit()
        self.db.refresh(buyer)
        self.db.refresh(seller)

        project = models.Project(
            title="Logo redesign",
            industry_type="digital art",
            description="Complete corporate vector logo and brand identity.",
            total_price=300.0,
            deadline="2026-11-03", # Initial project deadline
            buyer_id=buyer.id,
            seller_id=seller.id,
            status=models.ProjectStatus.NEGOTIATING
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        initial_milestones = [
            {
                "title": "Creative Brief Alignment & Moodboard",
                "description": "Initial design concepts and typography pairings.",
                "price_allocation": 90.0,
                "deadline": "2026-10-31",
                "proof_required": "PDF design deck",
                "status": "pending"
            },
            {
                "title": "Concept Refinements & Iterations",
                "description": "Revising chosen concept based on feedback.",
                "price_allocation": 110.0,
                "deadline": "2026-11-02",
                "proof_required": "High-res PNG mockups",
                "status": "pending"
            },
            {
                "title": "Final Vector Master Assets & Package Delivery",
                "description": "Final SVG, AI, EPS files and style guide.",
                "price_allocation": 100.0,
                "deadline": "2026-11-03",
                "proof_required": "Exported vector zip archive",
                "status": "pending"
            }
        ]

        agreement = models.Agreement(
            project_id=project.id,
            version=1,
            status="ACTIVE",
            is_accepted_by_client=0,
            ai_generated_contract="Initial logo redesign terms.",
            evidence_requirements="Digital file links and vector exports.",
            milestones=initial_milestones
        )
        self.db.add(agreement)
        self.db.commit()
        self.db.refresh(agreement)
        p_id = project.id

        # 1. Seller submits modification request: 'I need 5 days to complete the work'
        nego_resp = self.client.post(f"/api/projects/{p_id}/negotiate", json={
            "role": "seller",
            "message": "I need 5 days to complete the work"
        })
        self.assertEqual(nego_resp.status_code, 200)

        # 2. Buyer regenerates agreement terms via AI
        regen_resp = self.client.post(f"/api/projects/{p_id}/regenerate-agreement", json={
            "buyer_response": "Approved. Extending milestone deadlines by 5 days."
        })
        self.assertEqual(regen_resp.status_code, 200)
        regen_data = regen_resp.json()

        # Milestones must have shifted by 5 days:
        # M1: 2026-10-31 + 5d = 2026-11-05
        # M2: 2026-11-02 + 5d = 2026-11-07
        # M3: 2026-11-03 + 5d = 2026-11-08
        new_ms = regen_data["milestones"]
        self.assertEqual(new_ms[0]["deadline"], "2026-11-05")
        self.assertEqual(new_ms[1]["deadline"], "2026-11-07")
        self.assertEqual(new_ms[2]["deadline"], "2026-11-08")
        # Target project deadline must now be 2026-11-08 (final milestone deadline)
        self.assertEqual(regen_data["project_deadline"], "2026-11-08")

        # 3. Buyer dispatches updated terms to seller
        update_resp = self.client.post(f"/api/projects/{p_id}/update-terms", json={
            "contract_terms": regen_data["contract_terms"],
            "evidence_requirements": regen_data["evidence_requirements"],
            "buyer_message": "Approved. Extending milestone deadlines by 5 days.",
            "milestones": new_ms
        })
        self.assertEqual(update_resp.status_code, 200)
        update_data = update_resp.json()
        self.assertEqual(update_data["project_deadline"], "2026-11-08")

        # 4. Verify GET /api/projects/{id} returns updated project.deadline matching the final milestone
        get_proj = self.client.get(f"/api/projects/{p_id}")
        self.assertEqual(get_proj.status_code, 200)
        p_json = get_proj.json()
        self.assertEqual(p_json["project"]["deadline"], "2026-11-08")
        self.assertEqual(p_json["agreement"]["milestones"][0]["deadline"], "2026-11-05")
        self.assertEqual(p_json["agreement"]["milestones"][-1]["deadline"], "2026-11-08")

if __name__ == "__main__":
    unittest.main()
