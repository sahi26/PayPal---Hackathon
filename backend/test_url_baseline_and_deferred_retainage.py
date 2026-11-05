import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch, AsyncMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

import database
import models
import main

TEST_DB_URL = "sqlite:///./test_url_and_retainage.db"
test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

def override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()

main.app.dependency_overrides[database.get_db] = override_get_db
main.SessionLocal = TestSessionLocal
client = TestClient(main.app)

class TestUrlBaselineAndDeferredRetainage(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        models.Base.metadata.create_all(bind=test_engine)

    @classmethod
    def tearDownClass(cls):
        models.Base.metadata.drop_all(bind=test_engine)
        if os.path.exists("./test_url_and_retainage.db"):
            os.remove("./test_url_and_retainage.db")

    def setUp(self):
        self.db = TestSessionLocal()
        self.db.query(models.Notification).delete()
        self.db.query(models.Invoice).delete()
        self.db.query(models.Evidence).delete()
        self.db.query(models.Payment).delete()
        self.db.query(models.Agreement).delete()
        self.db.query(models.Project).delete()
        self.db.query(models.User).delete()
        self.db.commit()

        self.buyer = models.User(email="buyer@test.com", password_hash="pw", full_name="Buyer", role_type="buyer")
        self.seller = models.User(email="seller@test.com", password_hash="pw", full_name="Seller", role_type="seller")
        self.db.add_all([self.buyer, self.seller])
        self.db.commit()
        self.db.refresh(self.buyer)
        self.db.refresh(self.seller)

    def tearDown(self):
        self.db.close()

    def test_url_only_digital_baseline_submission(self):
        """
        Fix 1: Verifies that a Digital Renovation baseline submission with ONLY an asset URL
        (and no physical file) succeeds without a 422 Unprocessable Entity error.
        """
        project = models.Project(
            title="SaaS App Interface Redesign",
            industry_type="Software",
            project_domain="digital",
            is_renovation=True,
            total_price=500.0,
            status=models.ProjectStatus.DRAFT,
            buyer_id=self.buyer.id,
            seller_id=self.seller.id
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        # POST without any 'file' parameter, only form data including asset_url
        data = {
            "capture_method": "file_upload",
            "evidence_type": "before_evidence",
            "asset_url": "https://www.figma.com/design/xyz123/ProofFlow-UI-Kit"
        }
        res = client.post(f"/api/projects/{project.id}/evidence", data=data)
        self.assertEqual(res.status_code, 200)
        res_json = res.json()
        self.assertIn("Baseline URL reference successfully stored", res_json["message"])
        self.assertIsNotNone(res_json["file_hash"])
        self.assertEqual(res_json["status"], "verified")

        # Verify DB evidence record
        self.db.refresh(project)
        self.assertEqual(project.before_evidence_status, "provided")

        ev = self.db.query(models.Evidence).filter(
            models.Evidence.project_id == project.id,
            models.Evidence.evidence_type == "before_evidence"
        ).first()
        self.assertIsNotNone(ev)
        self.assertEqual(ev.asset_url, "https://www.figma.com/design/xyz123/ProofFlow-UI-Kit")
        self.assertEqual(ev.status, models.EvidenceStatus.VERIFIED)

    def test_deferred_final_milestone_capture_and_early_release(self):
        """
        Fix 2:
        1. When final milestone is approved and warranty_days > 0, do NOT capture from PayPal yet.
        2. Project transitions to WARRANTY_PERIOD with uncaptured hold intact.
        3. Early release calls paypal_service.capture_payment(final_capture=True) instead of Payouts API.
        """
        project = models.Project(
            title="Custom Hardwood Flooring",
            industry_type="Carpentry",
            project_domain="physical",
            total_price=300.0,
            status=models.ProjectStatus.ACTIVE,
            buyer_id=self.buyer.id,
            seller_id=self.seller.id,
            captured_amount=0.0
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        milestones = [
            {"title": "M1 Subfloor Preparation", "price_allocation": 150.0, "status": "approved"},
            {"title": "M2 Plank Installation & Finish", "price_allocation": 150.0, "status": "pending"}
        ]
        agreement = models.Agreement(
            project_id=project.id,
            version=1,
            status="ACTIVE",
            milestones=milestones,
            lock_in_type="FINAL_MILESTONE",
            lock_in_amount=150.0,
            lock_in_days=14,
            warranty_days=14
        )
        payment = models.Payment(
            project_id=project.id,
            amount=300.0,
            currency="USD",
            status=models.PaymentStatus.AUTHORIZED,
            authorization_id="AUTH-WARRANTY-TEST-123"
        )
        self.db.add_all([agreement, payment])
        self.db.commit()

        # Approve Milestone 1 (the final milestone with 14 warranty days)
        with patch("paypal_service.capture_payment", new_callable=AsyncMock) as mock_capture:
            res_approve = client.post(f"/api/projects/{project.id}/milestones/1/approve")
            self.assertEqual(res_approve.status_code, 200)
            data_appr = res_approve.json()

            # Ensure capture_payment was NOT called (funds deferred on hold!)
            mock_capture.assert_not_called()
            self.assertEqual(data_appr["project_status"], "WARRANTY_PERIOD")
            self.assertEqual(data_appr["escrow_released"], 0.0)
            self.assertEqual(data_appr["is_final_capture"], False)

        # Verify DB state: project is in WARRANTY_PERIOD, captured_amount is 0.0
        self.db.refresh(project)
        self.db.refresh(agreement)
        self.assertEqual(project.status, models.ProjectStatus.WARRANTY_PERIOD)
        self.assertEqual(agreement.status, "WARRANTY_PERIOD")
        self.assertEqual(project.captured_amount, 0.0)
        self.assertEqual(agreement.milestones[1]["status"], "approved")
        self.assertEqual(agreement.milestones[1]["is_paid"], False)
        self.assertTrue(agreement.milestones[1]["retainage_held"])

        # Now: Buyer clicks [Early Fund Release] -> Settle retainage via final Capture
        with patch("paypal_service.capture_payment", new_callable=AsyncMock) as mock_capture:
            mock_capture.return_value = {
                "id": "CAP-FINAL-WARRANTY-RELEASE",
                "status": "COMPLETED",
                "amount": {"value": "150.00", "currency_code": "USD"},
                "final_capture": True
            }

            res_release = client.post(f"/api/projects/{project.id}/warranty/early-release")
            self.assertEqual(res_release.status_code, 200)
            rel_data = res_release.json()
            self.assertEqual(rel_data["status"], "success")
            self.assertEqual(rel_data["capture_id"], "CAP-FINAL-WARRANTY-RELEASE")

            # Verify capture_payment was invoked with final_capture=True
            mock_capture.assert_called_once()
            _, kwargs = mock_capture.call_args
            self.assertEqual(kwargs.get("final_capture"), True)
            self.assertEqual(kwargs.get("amount"), 150.0)
            self.assertEqual(kwargs.get("authorization_id"), "AUTH-WARRANTY-TEST-123")

        # Verify final terminal DB state
        self.db.refresh(project)
        self.db.refresh(agreement)
        self.db.refresh(payment)
        self.assertEqual(project.status, models.ProjectStatus.COMPLETED)
        self.assertEqual(agreement.status, "COMPLETED")
        self.assertEqual(agreement.warranty_payout_status, "SUCCESS")
        self.assertEqual(project.captured_amount, 150.0)
        self.assertEqual(payment.status, models.PaymentStatus.CAPTURED)
        self.assertEqual(agreement.milestones[1]["is_paid"], True)

    def test_matured_warranty_payout_background_task(self):
        """
        Verify process_matured_warranty_payouts captures from original authorization hold when warranty expires.
        """
        project = models.Project(
            title="Plumbing Overhaul",
            industry_type="Plumbing",
            total_price=400.0,
            status=models.ProjectStatus.WARRANTY_PERIOD,
            buyer_id=self.buyer.id,
            seller_id=self.seller.id,
            captured_amount=200.0
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        milestones = [
            {"title": "M1 Rough-in", "price_allocation": 200.0, "status": "approved", "is_paid": True},
            {"title": "M2 Fixture Test", "price_allocation": 200.0, "status": "approved", "is_paid": False}
        ]
        agreement = models.Agreement(
            project_id=project.id,
            version=1,
            status="WARRANTY_PERIOD",
            milestones=milestones,
            lock_in_type="FINAL_MILESTONE",
            lock_in_amount=200.0,
            lock_in_days=14,
            warranty_days=14,
            warranty_end_date=datetime.utcnow() - timedelta(minutes=5), # Matured!
            warranty_payout_status="PENDING",
            dispute_active=False
        )
        payment = models.Payment(
            project_id=project.id,
            amount=400.0,
            currency="USD",
            status=models.PaymentStatus.PARTIALLY_CAPTURED,
            authorization_id="AUTH-MATURED-WARRANTY"
        )
        self.db.add_all([agreement, payment])
        self.db.commit()

        with patch("paypal_service.capture_payment", new_callable=AsyncMock) as mock_capture:
            mock_capture.return_value = {
                "id": "CAP-MATURED-RETAINAGE-999",
                "status": "COMPLETED",
                "amount": {"value": "200.00", "currency_code": "USD"},
                "final_capture": True
            }

            res = client.post("/api/warranty/process-matured-payouts")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["processed_count"], 1)

            mock_capture.assert_called_once()
            _, kwargs = mock_capture.call_args
            self.assertEqual(kwargs.get("final_capture"), True)
            self.assertEqual(kwargs.get("amount"), 200.0)
            self.assertEqual(kwargs.get("authorization_id"), "AUTH-MATURED-WARRANTY")

        self.db.refresh(project)
        self.db.refresh(agreement)
        self.db.refresh(payment)
        self.assertEqual(project.status, models.ProjectStatus.COMPLETED)
        self.assertEqual(agreement.status, "COMPLETED")
        self.assertEqual(agreement.warranty_payout_status, "SUCCESS")
        self.assertEqual(project.captured_amount, 400.0) # 200 + 200
        self.assertEqual(payment.status, models.PaymentStatus.CAPTURED)

if __name__ == "__main__":
    unittest.main()
