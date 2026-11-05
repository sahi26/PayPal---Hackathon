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
from main import app, get_db

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class TestPartialVoidAndCancelFlow(unittest.TestCase):
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

    def setUp(self):
        self.db = TestingSessionLocal()
        self.db.query(models.Notification).delete()
        self.db.query(models.Evidence).delete()
        self.db.query(models.Payment).delete()
        self.db.query(models.Agreement).delete()
        self.db.query(models.Project).delete()
        self.db.query(models.User).delete()
        self.db.commit()

        self.buyer = models.User(
            email="buyer_void@example.com",
            password_hash="hash",
            full_name="Buyer Void",
            role_type="buyer"
        )
        self.seller = models.User(
            email="seller_void@example.com",
            password_hash="hash",
            full_name="Seller Void",
            role_type="seller"
        )
        self.db.add_all([self.buyer, self.seller])
        self.db.commit()

    def tearDown(self):
        self.db.close()

    @patch("paypal_service.void_authorization", new_callable=AsyncMock)
    def test_partial_void_and_mutual_cancellation(self, mock_void):
        mock_void.return_value = {"status": "VOIDED", "id": "AUTH-123"}

        # 1. Project with total $300, 2 of 3 milestones approved ($200 captured)
        project = models.Project(
            title="Brand logo redesign",
            industry_type="Digital Art",
            description="Vector brand identity and mark",
            total_price=300.0,
            captured_amount=200.0,
            voided_amount=0.0,
            status=models.ProjectStatus.ACTIVE,
            buyer_id=self.buyer.id,
            seller_id=self.seller.id,
            void_escrow_status="SELLER_AGREED"
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        milestones = [
            {"id": "m1", "title": "Concept", "price_allocation": 100.0, "status": "approved", "is_paid": True},
            {"id": "m2", "title": "Revisions", "price_allocation": 100.0, "status": "approved", "is_paid": True},
            {"id": "m3", "title": "Final Vectors", "price_allocation": 100.0, "status": "pending", "is_paid": False}
        ]
        agreement = models.Agreement(
            project_id=project.id,
            version=1,
            status="ACTIVE",
            milestones=milestones
        )
        self.db.add(agreement)

        payment = models.Payment(
            project_id=project.id,
            paypal_order_id="ORDER-PARTIAL-VOID",
            authorization_id="AUTH-123",
            amount=300.0,
            currency="USD",
            status=models.PaymentStatus.PARTIALLY_CAPTURED
        )
        self.db.add(payment)
        self.db.commit()

        # 2. Invoke mutual cancellation endpoint POST /api/projects/{project_id}/cancel
        res = self.client.post(f"/api/projects/{project.id}/cancel", json={"note": "Mutually agreed to end project mid-way"})
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()

        # 3. Verify Remaining Balance Voided: $300 total - $200 captured = $100 voided
        self.assertEqual(data["status"], "voided")
        self.assertEqual(data["project_status"], "partially_completed_canceled")
        self.assertEqual(data["captured_amount"], 200.0)
        self.assertEqual(data["voided_amount"], 100.0)
        self.assertEqual(data["total_price"], 300.0)

        # Verify DB persisted values
        self.db.expire_all()
        refreshed_project = self.db.query(models.Project).filter(models.Project.id == project.id).first()
        self.assertEqual(refreshed_project.status, models.ProjectStatus.PARTIALLY_COMPLETED_CANCELED)
        self.assertEqual(refreshed_project.voided_amount, 100.0)
        self.assertEqual(refreshed_project.captured_amount, 200.0)

        # Verify unpaid milestone 3 transitioned to 'cancelled'
        refreshed_agreement = self.db.query(models.Agreement).filter(models.Agreement.project_id == project.id).first()
        self.assertEqual(refreshed_agreement.status, "CANCELLED")
        self.assertEqual(refreshed_agreement.milestones[0]["status"], "approved")
        self.assertEqual(refreshed_agreement.milestones[1]["status"], "approved")
        self.assertEqual(refreshed_agreement.milestones[2]["status"], "cancelled")

        # Verify PayPal void service was called with remaining authorization id
        mock_void.assert_called_once_with("AUTH-123", note="Mutually agreed to end project mid-way")

    @patch("paypal_service.create_order_for_authorize", new_callable=AsyncMock)
    def test_incremental_delta_escrow_authorization_amount(self, mock_create_order):
        mock_create_order.return_value = {
            "id": "ORDER-DELTA-5",
            "status": "CREATED",
            "links": [{"rel": "approve", "href": "https://paypal.com/checkout?token=ORDER-DELTA-5"}]
        }

        # Project had $300 already completed and captured. Total price is now $305 with Milestone 4 addendum (+ $5)
        project = models.Project(
            title="Brand logo redesign",
            industry_type="Digital Art",
            description="Logo mark addendum",
            total_price=305.0,
            captured_amount=300.0,
            status=models.ProjectStatus.ACTIVE,
            buyer_id=self.buyer.id,
            seller_id=self.seller.id,
            before_evidence_status="provided"
        )
        self.db.add(project)
        self.db.commit()

        milestones = [
            {"id": "m1", "title": "M1", "price_allocation": 90.0, "status": "approved"},
            {"id": "m2", "title": "M2", "price_allocation": 120.0, "status": "approved"},
            {"id": "m3", "title": "M3", "price_allocation": 90.0, "status": "approved"},
            {"id": "m4", "title": "Addendum: color variation", "price_allocation": 5.0, "status": "pending", "is_addendum": True}
        ]
        agreement = models.Agreement(
            project_id=project.id,
            version=4,
            status="ACTIVE",
            milestones=milestones
        )
        self.db.add(agreement)
        self.db.commit()

        # Request authorization without explicit amount -> backend must authorize remaining delta ($5.00), NOT $305.00
        res = self.client.post("/api/payments/authorize", json={
            "project_id": project.id,
            "currency": "USD"
        })
        self.assertEqual(res.status_code, 200, res.text)
        # Verify PayPal order was created for $5.00 (the delta), NOT $305.00
        mock_create_order.assert_called_once()
        call_kwargs = mock_create_order.call_args[1]
        self.assertEqual(call_kwargs["amount"], 5.0)

    def test_digital_domain_resolution_and_get_project(self):
        project = models.Project(
            title="Brand logo redesign",
            industry_type="Digital Art",
            description="Corporate branding assets and vectors",
            total_price=305.0,
            captured_amount=300.0,
            voided_amount=0.0,
            status=models.ProjectStatus.ACTIVE,
            buyer_id=self.buyer.id,
            seller_id=self.seller.id
        )
        self.db.add(project)
        self.db.commit()

        milestones = [
            {"id": "m1", "title": "M1", "price_allocation": 90.0, "status": "approved"},
            {"id": "m2", "title": "M2", "price_allocation": 120.0, "status": "approved"},
            {"id": "m3", "title": "M3", "price_allocation": 90.0, "status": "approved"},
            {"id": "m4", "title": "Color", "price_allocation": 5.0, "status": "pending"}
        ]
        agreement = models.Agreement(
            project_id=project.id,
            version=4,
            status="ACTIVE",
            milestones=milestones,
            lock_in_type="FINAL_MILESTONE",
            lock_in_days=14,
            lock_in_amount=5.0
        )
        self.db.add(agreement)
        self.db.commit()

        res = self.client.get(f"/api/projects/{project.id}")
        self.assertEqual(res.status_code, 200, res.text)
        p_data = res.json()["project"]
        
        # Domain must resolve to digital
        self.assertEqual(p_data["project_domain"], "digital")
        # Captured amount & remaining hold must match
        self.assertEqual(p_data["captured_amount"], 300.0)
        self.assertEqual(p_data["remaining_escrow_hold"], 5.0)
        self.assertEqual(p_data["voided_amount"], 0.0)

if __name__ == "__main__":
    unittest.main()
