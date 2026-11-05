"""
Unit tests for PayPal Reauthorize API, 29-Day Escrow Hold Extension,
FUNDS_AT_RISK Flagging, Background Task Maintenance & Escrow Re-approval.
"""

import unittest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from database import SessionLocal, engine
import models
import database
from main import app, auto_reauthorize_expiring_escrow
import paypal_service

models.Base.metadata.create_all(bind=engine)
database.run_migrations(engine)
client = TestClient(app)

class TestPayPalReauthorization(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_database_models_escrow_tracking(self):
        """Phase 1: Project has paypal_authorization_id, authorization_expires_at & FUNDS_AT_RISK status"""
        self.assertIn("FUNDS_AT_RISK", [s.value for s in models.ProjectStatus])

        proj = models.Project(
            title="Escrow Tracking Model Test",
            industry_type="Digital Art",
            description="Testing paypal authorization fields",
            total_price=250.0,
            status=models.ProjectStatus.ACTIVE,
            paypal_authorization_id="AUTH-INITIAL-12345",
            authorization_expires_at=datetime.utcnow() + timedelta(days=29)
        )
        self.db.add(proj)
        self.db.commit()
        self.db.refresh(proj)

        self.assertEqual(proj.paypal_authorization_id, "AUTH-INITIAL-12345")
        self.assertIsNotNone(proj.authorization_expires_at)

    def test_paypal_service_reauthorize(self):
        """Phase 2: paypal_service.reauthorize_payment renews authorization and returns new ID & 29-day expiration"""
        import asyncio
        loop = asyncio.get_event_loop()
        res = loop.run_until_complete(
            paypal_service.reauthorize_payment("AUTH-ORIGINAL-999", amount=150.0, currency="USD")
        )

        self.assertTrue(res["success"])
        self.assertTrue(res["id"].startswith("AUTH-RENEW-") or len(res["id"]) > 5)
        self.assertIsNotNone(res["expiration_date"])
        diff_days = (res["expiration_date"] - datetime.utcnow()).total_seconds() / 86400.0
        self.assertAlmostEqual(diff_days, 29.0, delta=1.0)

        # Test simulated failure raises exception
        with self.assertRaises(Exception):
            loop.run_until_complete(
                paypal_service.reauthorize_payment("AUTH-DECLINE-TEST", amount=150.0, simulate_failure=True)
            )

    def test_manual_reauthorize_5_day_window_enforcement(self):
        """Phase 3: POST /api/payments/{project_id}/reauthorize enforces 5-day window constraint"""
        now = datetime.utcnow()
        proj = models.Project(
            title="Window Check Project",
            industry_type="Home Renovation",
            description="Testing 5-day window",
            total_price=500.0,
            status=models.ProjectStatus.ACTIVE,
            paypal_authorization_id="AUTH-LONG-HOLD-001",
            authorization_expires_at=now + timedelta(days=20) # 20 days away (> 5 days)
        )
        self.db.add(proj)
        self.db.commit()
        self.db.refresh(proj)

        # Calling without force should return 400
        res = client.post(f"/api/payments/{proj.id}/reauthorize")
        self.assertEqual(res.status_code, 400)
        self.assertIn("within 5 days", res.json()["detail"])

        # Calling with force=true bypasses the check and successfully renews
        res_forced = client.post(f"/api/payments/{proj.id}/reauthorize?force=true")
        self.assertEqual(res_forced.status_code, 200)
        data = res_forced.json()
        self.assertEqual(data["status"], "success")
        self.assertTrue(data["new_authorization_id"].startswith("AUTH-RENEW-"))

        self.db.refresh(proj)
        self.assertEqual(proj.paypal_authorization_id, data["new_authorization_id"])
        # New expiration is ~29 days from now
        new_diff = (proj.authorization_expires_at - datetime.utcnow()).total_seconds() / 86400.0
        self.assertAlmostEqual(new_diff, 29.0, delta=1.0)

    def test_manual_reauthorize_within_5_days_succeeds(self):
        """Phase 3: POST /api/payments/{project_id}/reauthorize succeeds naturally when within 5 days"""
        now = datetime.utcnow()
        proj = models.Project(
            title="Expiring Soon Project",
            industry_type="Home Renovation",
            description="Testing 4 days remaining",
            total_price=350.0,
            status=models.ProjectStatus.ACTIVE,
            paypal_authorization_id="AUTH-EXPIRING-SOON",
            authorization_expires_at=now + timedelta(days=4) # 4 days away (<= 5 days)
        )
        self.db.add(proj)
        self.db.commit()
        self.db.refresh(proj)

        res = client.post(f"/api/payments/{proj.id}/reauthorize")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")

        self.db.refresh(proj)
        new_diff = (proj.authorization_expires_at - datetime.utcnow()).total_seconds() / 86400.0
        self.assertAlmostEqual(new_diff, 29.0, delta=1.0)

    def test_reauthorization_failure_flags_funds_at_risk(self):
        """Phase 3: Failure flags project status as FUNDS_AT_RISK and returns urgent notification message"""
        now = datetime.utcnow()
        proj = models.Project(
            title="Card Expired Project",
            industry_type="Digital Art",
            description="Testing card decline",
            total_price=200.0,
            status=models.ProjectStatus.ACTIVE,
            paypal_authorization_id="AUTH-WILL-FAIL",
            authorization_expires_at=now + timedelta(days=2)
        )
        self.db.add(proj)
        self.db.commit()
        self.db.refresh(proj)

        # Trigger reauthorization with simulated failure (card expired)
        res = client.post(f"/api/payments/{proj.id}/reauthorize?simulate_failure=true")
        self.assertEqual(res.status_code, 402)
        data = res.json()
        self.assertEqual(data["status"], "FUNDS_AT_RISK")
        self.assertEqual(data["project_status"], "FUNDS_AT_RISK")
        self.assertIn("Action Required: Escrow authorization expired. Buyer must re-approve payment to continue the project.", data["message"])

        self.db.refresh(proj)
        self.assertEqual(proj.status, models.ProjectStatus.FUNDS_AT_RISK)

        # Verify escrow status endpoint reflects FUNDS_AT_RISK
        status_res = client.get(f"/api/projects/{proj.id}/escrow-status")
        self.assertEqual(status_res.status_code, 200)
        status_data = status_res.json()
        self.assertTrue(status_data["is_funds_at_risk"])
        self.assertIn("Action Required", status_data["urgent_banner"])

    def test_reapprove_escrow_endpoint(self):
        """Buyer re-approves payment when project is in FUNDS_AT_RISK"""
        proj = models.Project(
            title="Re-approve Escrow Project",
            industry_type="Digital Art",
            description="Testing re-approval",
            total_price=400.0,
            status=models.ProjectStatus.FUNDS_AT_RISK
        )
        self.db.add(proj)
        self.db.commit()
        self.db.refresh(proj)

        res = client.post(f"/api/projects/{proj.id}/re-approve-escrow")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "APPROVAL_REQUIRED")
        self.assertTrue("checkoutnow" in data["paypal_approval_url"] or "sandbox.paypal" in data["paypal_approval_url"])

    def test_automated_background_maintenance_job(self):
        """Phase 3 Automation: Background task renews ACTIVE projects where authorization_expires_at < 3 days"""
        import asyncio
        now = datetime.utcnow()
        proj_expiring = models.Project(
            title="Auto Renew Project",
            industry_type="Digital Art",
            description="Testing auto maintenance",
            total_price=300.0,
            status=models.ProjectStatus.ACTIVE,
            paypal_authorization_id="AUTH-CRON-EXPIRING",
            authorization_expires_at=now + timedelta(days=2) # < 3 days!
        )
        proj_safe = models.Project(
            title="Safe Project",
            industry_type="Digital Art",
            description="Testing safe hold",
            total_price=300.0,
            status=models.ProjectStatus.ACTIVE,
            paypal_authorization_id="AUTH-CRON-SAFE",
            authorization_expires_at=now + timedelta(days=15) # > 3 days!
        )
        self.db.add_all([proj_expiring, proj_safe])
        self.db.commit()

        # Run maintenance function
        loop = asyncio.get_event_loop()
        results = loop.run_until_complete(auto_reauthorize_expiring_escrow(self.db))

        self.db.refresh(proj_expiring)
        self.db.refresh(proj_safe)

        # Expiring project should have been renewed for 29 days
        diff_renewed = (proj_expiring.authorization_expires_at - datetime.utcnow()).total_seconds() / 86400.0
        self.assertAlmostEqual(diff_renewed, 29.0, delta=1.0)
        self.assertTrue(proj_expiring.paypal_authorization_id.startswith("AUTH-RENEW-"))

        # Safe project should remain untouched
        self.assertEqual(proj_safe.paypal_authorization_id, "AUTH-CRON-SAFE")

if __name__ == "__main__":
    unittest.main()
