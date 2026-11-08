import unittest
from unittest.mock import patch, AsyncMock
from fastapi.testclient import TestClient
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import database
import models
from main import app, get_db

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class TestVoidEscrowAndNotifications(unittest.TestCase):
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
        
        # Create buyer and seller users
        self.buyer = models.User(
            email=f"buyer_void_{datetime.utcnow().timestamp()}@example.com",
            password_hash="secret123",
            full_name="Test Buyer",
            role_type="buyer"
        )
        self.seller = models.User(
            email=f"seller_void_{datetime.utcnow().timestamp()}@example.com",
            password_hash="secret123",
            full_name="Test Contractor",
            role_type="seller"
        )
        self.db.add_all([self.buyer, self.seller])
        self.db.commit()
        self.db.refresh(self.buyer)
        self.db.refresh(self.seller)

        # Create a project with both buyer and seller
        self.project = models.Project(
            title="Office Renovation Void Test",
            description="Testing mutual consent void escrow",
            total_price=1500.0,
            buyer_id=self.buyer.id,
            seller_id=self.seller.id,
            status=models.ProjectStatus.ACTIVE,
            void_escrow_status="NONE"
        )
        self.db.add(self.project)
        self.db.commit()
        self.db.refresh(self.project)

        # Create agreement and authorized payment
        self.agreement = models.Agreement(
            project_id=self.project.id,
            status="ACCEPTED",
            milestones=[
                {
                    "title": "Demolition",
                    "price_allocation": 500.0,
                    "status": "pending",
                    "due_date": "2026-11-20"
                },
                {
                    "title": "Drywall",
                    "price_allocation": 1000.0,
                    "status": "pending",
                    "due_date": "2026-11-25"
                }
            ]
        )
        self.payment = models.Payment(
            project_id=self.project.id,
            amount=1500.0,
            currency="USD",
            status=models.PaymentStatus.AUTHORIZED,
            authorization_id="AUTH-TEST-VOID-12345"
        )
        self.db.add_all([self.agreement, self.payment])
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_mutual_consent_void_escrow_workflow(self):
        project_id = self.project.id

        # 1. Direct void attempt without contractor consent must fail with 400
        res = self.client.post(f"/api/escrow/{project_id}/void", json={"note": "Cancel early"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("Mutual consent required", res.json()["detail"])

        # 2. Buyer sends void escrow cancellation request
        res = self.client.post(
            f"/api/escrow/{project_id}/void-request",
            json={"reason": "Permits were cancelled by the city"}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "pending_consent")
        self.assertEqual(data["void_escrow_status"], "PENDING_SELLER_CONSENT")

        # Verify contractor received a notification
        notif_res = self.client.get(f"/api/notifications?user_id={self.seller.id}")
        self.assertEqual(notif_res.status_code, 200)
        notifs = notif_res.json()["notifications"]
        self.assertTrue(any(n["type"] == "VOID_ESCROW_REQUEST" for n in notifs))
        self.assertGreater(notif_res.json()["unread_count"], 0)

        # 3. Direct void attempt still fails because status is PENDING_SELLER_CONSENT
        res = self.client.post(f"/api/escrow/{project_id}/void", json={"note": "Cancel now"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("Mutual consent required", res.json()["detail"])

        # 4. Contractor declines the request
        res = self.client.post(
            f"/api/escrow/{project_id}/void-request/respond",
            json={"agree": False, "note": "Already purchased materials"}
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["void_escrow_status"], "DECLINED")

        # Buyer received decline notification
        buyer_notif_res = self.client.get(f"/api/notifications?user_id={self.buyer.id}")
        self.assertTrue(any(n["type"] == "VOID_ESCROW_RESPONSE" for n in buyer_notif_res.json()["notifications"]))

        # 5. Contractor agrees to cancellation
        res = self.client.post(
            f"/api/escrow/{project_id}/void-request/respond",
            json={"agree": True, "note": "Agreed to cancel and reimburse"}
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["void_escrow_status"], "SELLER_AGREED")

        # 6. Now Buyer executes Void Escrow with mock PayPal void service
        with patch("paypal_service.void_authorization", new_callable=AsyncMock) as mock_void:
            mock_void.return_value = {"id": "AUTH-TEST-VOID-12345", "status": "VOIDED"}
            res = self.client.post(
                f"/api/escrow/{project_id}/void",
                json={"note": "Mutual cancellation confirmed"}
            )
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["status"], "voided")
            self.assertEqual(data["project_status"], "cancelled")

        # Verify in DB: project status is CANCELLED and void_escrow_status is VOIDED
        db = TestingSessionLocal()
        p_check = db.query(models.Project).filter(models.Project.id == project_id).first()
        self.assertEqual(p_check.void_escrow_status, "VOIDED")
        self.assertEqual(p_check.status, models.ProjectStatus.CANCELLED)
        db.close()

    def test_milestone_funds_credited_notification(self):
        project_id = self.project.id

        # Buyer approves Milestone 0 ($500)
        with patch("paypal_service.capture_authorization", new_callable=AsyncMock) as mock_capture:
            mock_capture.return_value = {
                "id": "CAP-NOTIF-TEST-1",
                "status": "COMPLETED",
                "amount": {"value": "500.00", "currency_code": "USD"}
            }
            res = self.client.post(f"/api/projects/{project_id}/milestones/0/approve")
            self.assertEqual(res.status_code, 200)

        # Contractor should have received a FUNDS_CREDITED notification
        res = self.client.get(f"/api/notifications?user_id={self.seller.id}")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        credited_notifs = [n for n in data["notifications"] if n["type"] == "FUNDS_CREDITED"]
        self.assertTrue(len(credited_notifs) > 0)
        notif = credited_notifs[0]
        self.assertIn("$500.00 USD has been credited to your PayPal account", notif["message"])
        self.assertEqual(notif["is_read"], False)

        # Test marking notification as read
        read_res = self.client.post(f"/api/notifications/{notif['id']}/read")
        self.assertEqual(read_res.status_code, 200)

        # Test mark all as read
        mark_all_res = self.client.post(f"/api/notifications/mark-all-read?user_id={self.seller.id}")
        self.assertEqual(mark_all_res.status_code, 200)
        
        # Verify unread count is 0
        res = self.client.get(f"/api/notifications?user_id={self.seller.id}")
        self.assertEqual(res.json()["unread_count"], 0)

if __name__ == "__main__":
    unittest.main()
