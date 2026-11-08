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

class TestNegotiationNotifications(unittest.TestCase):
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
        # Clean notifications for isolated testing
        self.db.query(models.Notification).delete()
        self.db.commit()
        
        self.buyer = models.User(
            email=f"buyer_notif_{datetime.utcnow().timestamp()}@example.com",
            password_hash="secret123",
            full_name="Alice Buyer",
            role_type="buyer"
        )
        self.seller = models.User(
            email=f"seller_notif_{datetime.utcnow().timestamp()}@example.com",
            password_hash="secret123",
            full_name="Bob Contractor",
            role_type="seller"
        )
        self.db.add_all([self.buyer, self.seller])
        self.db.commit()
        self.db.refresh(self.buyer)
        self.db.refresh(self.seller)

        self.project = models.Project(
            title="Brand logo redesign",
            description="High-end corporate logo package",
            total_price=1200.0,
            buyer_id=self.buyer.id,
            seller_id=self.seller.id,
            status=models.ProjectStatus.ACTIVE,
            invite_token=f"tok_{datetime.utcnow().timestamp()}"
        )
        self.db.add(self.project)
        self.db.commit()
        self.db.refresh(self.project)

        self.agreement = models.Agreement(
            project_id=self.project.id,
            version=1,
            status="DRAFT",
            milestones=[
                {
                    "title": "Complete brand logo redesign",
                    "description": "Deliver final logo mockups",
                    "price_allocation": 1200.0,
                    "proof_required": "High resolution PNG",
                    "status": "pending",
                    "deadline": "2026-11-06"
                }
            ]
        )
        self.db.add(self.agreement)
        self.db.commit()
        self.db.refresh(self.agreement)

    def tearDown(self):
        self.db.close()

    def test_seller_change_request_does_not_bump_version_and_notifies_buyer(self):
        project_id = self.project.id

        # Seller submits a change request: "I need 2 days instead of 1day"
        res = self.client.post(
            f"/api/projects/{project_id}/negotiate",
            json={"message": "I need 2 days instead of 1day", "role": "seller"}
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        
        # 1. Version must NOT increment on seller request! Must stay at 1
        self.assertEqual(data["version"], 1)
        self.assertEqual(data["latest_seller_message"], "I need 2 days instead of 1day")
        self.assertIsNone(data["latest_buyer_message"])

        # 2. Buyer must receive an unread notification for the change request
        notif_res = self.client.get(f"/api/notifications?user_id={self.buyer.id}&role=buyer")
        self.assertEqual(notif_res.status_code, 200)
        notif_data = notif_res.json()
        self.assertEqual(notif_data["unread_count"], 1)
        
        matching = [n for n in notif_data["notifications"] if n["type"] == "SCOPE_CHANGE_REQUEST"]
        self.assertEqual(len(matching), 1)
        notif = matching[0]
        self.assertEqual(notif["title"], "Contractor Requested Scope Change")
        self.assertIn("I need 2 days instead of 1day", notif["message"])
        self.assertIn("Brand logo redesign", notif["message"])
        self.assertEqual(notif["is_read"], False)
        self.assertEqual(notif["action_url"], f"/project/{project_id}/negotiate")

    def test_buyer_commit_terms_increments_version_and_notifies_seller(self):
        project_id = self.project.id

        # First seller asks for change
        self.client.post(
            f"/api/projects/{project_id}/negotiate",
            json={"message": "I need 2 days instead of 1day", "role": "seller"}
        )

        # Buyer accommodates and commits updated terms
        update_payload = {
            "contract_terms": "Updated master terms: 2 days timeline accommodated.",
            "evidence_requirements": "High resolution PNG with horizontal and vertical lockup.",
            "buyer_message": "Accommodated 2 days delivery schedule as requested.",
            "milestones": [
                {
                    "title": "Complete brand logo redesign",
                    "description": "Deliver final logo mockups with revisions",
                    "price_allocation": 1200.0,
                    "proof_required": "High resolution PNG",
                    "deadline": "2026-11-07"
                }
            ],
            "role": "buyer"
        }
        res = self.client.post(f"/api/projects/{project_id}/update-terms", json=update_payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        # Version must increment to 2
        self.assertEqual(data["version"], 2)
        self.assertEqual(data["latest_buyer_message"], "Accommodated 2 days delivery schedule as requested.")

        # Check DB: latest_seller_message must be cleared
        db = TestingSessionLocal()
        ag = db.query(models.Agreement).filter_by(project_id=project_id).first()
        self.assertIsNone(ag.latest_seller_message)
        self.assertEqual(ag.version, 2)
        db.close()

        # Seller must receive TERMS_UPDATED notification
        seller_notif_res = self.client.get(f"/api/notifications?user_id={self.seller.id}&role=seller")
        self.assertEqual(seller_notif_res.status_code, 200)
        seller_notifs = seller_notif_res.json()["notifications"]
        updated_notifs = [n for n in seller_notifs if n["type"] == "TERMS_UPDATED"]
        self.assertEqual(len(updated_notifs), 1)
        self.assertIn("Updated Agreement Terms Received (v2.0)", updated_notifs[0]["title"])
        self.assertIn("Accommodated 2 days delivery schedule", updated_notifs[0]["message"])

    def test_notification_read_and_mark_all_read(self):
        project_id = self.project.id
        self.client.post(
            f"/api/projects/{project_id}/negotiate",
            json={"message": "Please confirm format", "role": "seller"}
        )

        notif_res = self.client.get(f"/api/notifications?user_id={self.buyer.id}&role=buyer")
        self.assertEqual(len(notif_res.json()["notifications"]), 1)
        notif_id = notif_res.json()["notifications"][0]["id"]

        # Mark single read
        read_res = self.client.post(f"/api/notifications/{notif_id}/read")
        self.assertEqual(read_res.status_code, 200)

        # Verify unread count is 0
        notif_res2 = self.client.get(f"/api/notifications?user_id={self.buyer.id}&role=buyer")
        self.assertEqual(notif_res2.json()["unread_count"], 0)

if __name__ == "__main__":
    unittest.main()
