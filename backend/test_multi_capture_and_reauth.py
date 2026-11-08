import unittest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from datetime import datetime, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import database
import models
import paypal_service
from main import app, get_db, auto_reauthorize_expiring_escrow

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class TestMultiCaptureAndReauth(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        models.Base.metadata.create_all(bind=engine)
        database.run_migrations(engine)

        def override_get_db():
            db = TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def setUp(self):
        self.db = TestingSessionLocal()

        self.buyer = models.User(
            email=f"buyer_multicap_{datetime.utcnow().timestamp()}@example.com",
            password_hash="secret123",
            full_name="Escrow Buyer",
            role_type="buyer"
        )
        self.seller = models.User(
            email=f"seller_multicap_{datetime.utcnow().timestamp()}@example.com",
            password_hash="secret123",
            full_name="Escrow Contractor",
            role_type="seller"
        )
        self.db.add_all([self.buyer, self.seller])
        self.db.commit()
        self.db.refresh(self.buyer)
        self.db.refresh(self.seller)

        # 3 milestones: $100, $100, $100 = $300 total
        self.project = models.Project(
            title="Multi-Capture Escrow Test Project",
            description="Testing 3-chunk multi-capture against a $300 authorization hold",
            total_price=300.0,
            buyer_id=self.buyer.id,
            seller_id=self.seller.id,
            status=models.ProjectStatus.ACTIVE,
            captured_amount=0.0,
            paypal_authorization_id="AUTH-ORIGINAL-300",
            authorization_expires_at=datetime.utcnow() + timedelta(days=2) # <3 days to test auto-reauth
        )
        self.db.add(self.project)
        self.db.commit()
        self.db.refresh(self.project)

        self.agreement = models.Agreement(
            project_id=self.project.id,
            status="ACTIVE",
            milestones=[
                {
                    "title": "Phase 1 Foundations",
                    "price_allocation": 100.0,
                    "status": "pending"
                },
                {
                    "title": "Phase 2 Framing",
                    "price_allocation": 100.0,
                    "status": "pending"
                },
                {
                    "title": "Phase 3 Final Inspection",
                    "price_allocation": 100.0,
                    "status": "pending"
                }
            ]
        )
        self.payment = models.Payment(
            project_id=self.project.id,
            amount=300.0,
            currency="USD",
            status=models.PaymentStatus.AUTHORIZED,
            authorization_id="AUTH-ORIGINAL-300",
            paypal_authorization_id="AUTH-ORIGINAL-300",
            authorization_expires_at=datetime.utcnow() + timedelta(days=2)
        )
        self.db.add_all([self.agreement, self.payment])
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_phase1_capture_payment_payload_final_capture_flag(self):
        """
        Verify that paypal_service.capture_payment generates payload with:
        final_capture = False for intermediate milestone,
        final_capture = True for final milestone.
        """
        import asyncio

        # Test intermediate: final_capture=False
        res_intermediate = asyncio.run(
            paypal_service.capture_payment(
                authorization_id="AUTH-TEST-FLAG",
                amount=100.0,
                currency="USD",
                final_capture=False
            )
        )
        self.assertEqual(res_intermediate["final_capture"], False)
        self.assertEqual(res_intermediate["is_final_capture"], False)

        # Test final: final_capture=True
        res_final = asyncio.run(
            paypal_service.capture_payment(
                authorization_id="AUTH-TEST-FLAG",
                amount=100.0,
                currency="USD",
                final_capture=True
            )
        )
        self.assertEqual(res_final["final_capture"], True)
        self.assertEqual(res_final["is_final_capture"], True)

    def test_phase2_multi_capture_tracking_and_hold_validation(self):
        """
        Verify:
        1. Intermediate milestone 0 approval passes final_capture: False and captured_amount becomes $100.
        2. Intermediate milestone 1 approval passes final_capture: False and captured_amount becomes $200.
        3. Attempting to capture an amount exceeding remaining hold throws 500 error.
        4. Final milestone 2 approval passes final_capture: True and captured_amount becomes $300.
        """
        project_id = self.project.id

        # --- Milestone 0: $100 (Intermediate) ---
        with patch("paypal_service.capture_payment", new_callable=AsyncMock) as mock_cap:
            mock_cap.return_value = {
                "id": "CAP-CHUNK-1",
                "status": "COMPLETED",
                "amount": {"value": "100.00", "currency_code": "USD"},
                "final_capture": False
            }
            res = self.client.post(f"/api/projects/{project_id}/milestones/0/approve")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["captured_amount"], 100.0)
            self.assertEqual(data["remaining_escrow_hold"], 200.0)
            self.assertEqual(data["final_capture"], False)

            # Assert mock was called with final_capture=False
            mock_cap.assert_called_once()
            _, kwargs = mock_cap.call_args
            self.assertEqual(kwargs.get("final_capture"), False)

        # Check DB project state
        self.db.expire_all()
        p = self.db.query(models.Project).filter(models.Project.id == project_id).first()
        self.assertEqual(p.captured_amount, 100.0)

        # --- Milestone 1: $100 (Intermediate) ---
        with patch("paypal_service.capture_payment", new_callable=AsyncMock) as mock_cap:
            mock_cap.return_value = {
                "id": "CAP-CHUNK-2",
                "status": "COMPLETED",
                "amount": {"value": "100.00", "currency_code": "USD"},
                "final_capture": False
            }
            res = self.client.post(f"/api/projects/{project_id}/milestones/1/approve")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["captured_amount"], 200.0)
            self.assertEqual(data["remaining_escrow_hold"], 100.0)
            self.assertEqual(data["final_capture"], False)

            _, kwargs = mock_cap.call_args
            self.assertEqual(kwargs.get("final_capture"), False)

        self.db.expire_all()
        p = self.db.query(models.Project).filter(models.Project.id == project_id).first()
        self.assertEqual(p.captured_amount, 200.0)

        # --- Validation Test: Amount > Remaining Escrow Hold ---
        # Remaining hold is $300 - $200 = $100.
        # If milestone 2 price is artificially inflated to $150, the backend must throw 500 error!
        ag = self.db.query(models.Agreement).filter(models.Agreement.project_id == project_id).first()
        ms = list(ag.milestones)
        ms[2]["price_allocation"] = 150.0  # $150 exceeds $100 remaining
        ag.milestones = ms
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(ag, "milestones")
        self.db.commit()

        res_blocked = self.client.post(f"/api/projects/{project_id}/milestones/2/approve")
        self.assertEqual(res_blocked.status_code, 500)
        self.assertIn("exceeds remaining authorized escrow hold", res_blocked.json()["detail"])
        self.assertIn("Capture blocked to prevent PayPal rejection", res_blocked.json()["detail"])

        # Reset price allocation to $100 so it matches exact remaining hold
        ms[2]["price_allocation"] = 100.0
        ag.milestones = ms
        flag_modified(ag, "milestones")
        self.db.commit()

        # --- Milestone 2: $100 (Final Milestone) ---
        with patch("paypal_service.capture_payment", new_callable=AsyncMock) as mock_cap:
            mock_cap.return_value = {
                "id": "CAP-CHUNK-3-FINAL",
                "status": "COMPLETED",
                "amount": {"value": "100.00", "currency_code": "USD"},
                "final_capture": True
            }
            res = self.client.post(f"/api/projects/{project_id}/milestones/2/approve")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["captured_amount"], 300.0)
            self.assertEqual(data["remaining_escrow_hold"], 0.0)
            self.assertEqual(data["final_capture"], True)

            _, kwargs = mock_cap.call_args
            self.assertEqual(kwargs.get("final_capture"), True)

        self.db.expire_all()
        p = self.db.query(models.Project).filter(models.Project.id == project_id).first()
        self.assertEqual(p.captured_amount, 300.0)

    def test_phase3_reauthorize_remaining_balance_after_partial_captures(self):
        """
        Verify Phase 3:
        If $100 has been captured out of $300, Reauthorization must reauthorize
        the remaining uncaptured balance ($200.00), NOT the original $300.00.
        """
        project_id = self.project.id

        # Set captured_amount to $100.00
        p = self.db.query(models.Project).filter(models.Project.id == project_id).first()
        p.captured_amount = 100.0
        self.db.commit()

        # 1. Manual trigger: POST /api/payments/{project_id}/reauthorize
        with patch("paypal_service.reauthorize_payment", new_callable=AsyncMock) as mock_reauth:
            mock_reauth.return_value = {
                "id": "AUTH-RENEWED-200",
                "status": "CREATED",
                "amount": {"value": "200.00", "currency_code": "USD"},
                "expiration_date": datetime.utcnow() + timedelta(days=29)
            }

            res = self.client.post(f"/api/payments/{project_id}/reauthorize?force=true")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["reauthorized_amount"], 200.0)

            # Check paypal_service was called with amount=200.0 (not 300.0)
            mock_reauth.assert_called_once()
            _, kwargs = mock_reauth.call_args
            self.assertEqual(kwargs.get("amount"), 200.0)

        # 2. Automated background task: auto_reauthorize_expiring_escrow
        # Reset expiration date to within 2 days so auto-reauth picks it up
        p = self.db.query(models.Project).filter(models.Project.id == project_id).first()
        p.authorization_expires_at = datetime.utcnow() + timedelta(days=2)
        self.db.commit()

        with patch("paypal_service.reauthorize_payment", new_callable=AsyncMock) as mock_cron_reauth:
            mock_cron_reauth.return_value = {
                "id": "AUTH-CRON-200",
                "status": "CREATED",
                "amount": {"value": "200.00", "currency_code": "USD"},
                "expiration_date": datetime.utcnow() + timedelta(days=29)
            }

            import asyncio
            cron_results = asyncio.run(auto_reauthorize_expiring_escrow(self.db))
            proj_cron_res = next((r for r in cron_results if r["project_id"] == project_id), None)
            self.assertIsNotNone(proj_cron_res)
            self.assertEqual(proj_cron_res["reauthorized_amount"], 200.0)

            mock_cron_reauth.assert_called()
            # Verify at least one call was with amount=200.0
            amounts_reauthorized = [call.kwargs.get("amount") for call in mock_cron_reauth.call_args_list]
            self.assertIn(200.0, amounts_reauthorized)

if __name__ == "__main__":
    unittest.main()
