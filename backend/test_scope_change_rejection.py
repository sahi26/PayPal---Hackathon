import os
import sys
import unittest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ["APP_ENV"] = "test"
os.environ["ALLOW_INSECURE_TEST_AUTH"] = "1"

import main
main.os.environ["GEMINI_API_KEY"] = ""
main.GEMINI_API_KEY = ""

from main import app
from database import SessionLocal, run_migrations, engine
import models

class TestScopeChangeRejection(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        run_migrations(engine)
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_seller_scope_change_rejection_flow(self):
        import uuid
        uid = uuid.uuid4().hex[:8]
        # 1. Create buyer and seller users
        buyer = models.User(
            email=f"buyer_scope_{uid}@prooflens.com",
            password_hash="mock_hash",
            full_name="Alice Buyer",
            role_type="buyer"
        )
        seller = models.User(
            email=f"seller_scope_{uid}@prooflens.com",
            password_hash="mock_hash",
            full_name="Bob Contractor",
            role_type="seller"
        )
        self.db.add(buyer)
        self.db.add(seller)
        self.db.commit()
        self.db.refresh(buyer)
        self.db.refresh(seller)

        # 2. Create an active project
        project = models.Project(
            title="Custom Hardwood Pergola",
            industry_type="Construction",
            description="Handmade cedar pergola with custom shade.",
            total_price=1000.0,
            deadline="2026-12-01",
            buyer_id=buyer.id,
            seller_id=seller.id,
            status=models.ProjectStatus.ACTIVE
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        # 3. Create active agreement (v1)
        agreement = models.Agreement(
            project_id=project.id,
            version=1,
            status="ACTIVE",
            is_accepted_by_client=1,
            ai_generated_contract="Pergola construction terms v1.",
            evidence_requirements="Footings and framing photos.",
            milestones=[
                {
                    "title": "Footings",
                    "price_allocation": 500.0,
                    "deadline": "2026-11-15",
                    "status": "approved",
                    "proof_required": "Footing photos"
                },
                {
                    "title": "Framing",
                    "price_allocation": 500.0,
                    "deadline": "2026-12-01",
                    "status": "pending",
                    "proof_required": "Framing photos"
                }
            ]
        )
        self.db.add(agreement)
        self.db.commit()

        # 4. Create a proposed scope change request (NEGOTIATING)
        scope_change = models.ScopeChangeRequest(
            project_id=project.id,
            requested_by_id=buyer.id,
            description="Add solar panel mounting brackets and wiring channels ($250 extra, 5 days)",
            proposed_extra_cost=250.0,
            proposed_extra_days=5,
            status=models.ScopeChangeStatus.NEGOTIATING.value,
            addendum_contract="Addendum v2 for solar mounting brackets.",
            proposed_milestones=[
                {
                    "title": "Solar Mount Framing",
                    "price_allocation": 250.0,
                    "deadline": "2026-12-06",
                    "status": "pending",
                    "proof_required": "Photos of installed aluminum mounting channels",
                    "is_addendum": True
                }
            ],
            chat_history=[
                {
                    "sender": "buyer",
                    "sender_name": "Alice Buyer",
                    "message": "Proposed adding solar brackets (+ $250, + 5 days)"
                }
            ]
        )
        self.db.add(scope_change)
        self.db.commit()
        self.db.refresh(scope_change)

        sc_id = scope_change.id

        # 5. Seller rejects with empty reason -> should fail validation (HTTP 400)
        empty_rej_resp = self.client.post(
            f"/api/projects/{project.id}/scope-change/reject",
            json={
                "scope_change_id": sc_id,
                "reason": "   ",
                "user_email": seller.email
            }
        )
        self.assertEqual(empty_rej_resp.status_code, 400)

        # 6. Seller rejects with concrete reason -> should succeed (HTTP 200)
        rejection_reason = "Timeline too tight for required delivery. Sourcing certified solar bracket hardware takes at least 14 days, not 5 days."
        rej_resp = self.client.post(
            f"/api/projects/{project.id}/scope-change/reject",
            json={
                "scope_change_id": sc_id,
                "reason": rejection_reason,
                "user_email": seller.email
            }
        )
        self.assertEqual(rej_resp.status_code, 200, rej_resp.text)
        rej_data = rej_resp.json()
        self.assertEqual(rej_data["status"], "REJECTED")
        self.assertEqual(rej_data["scope_change"]["status"], "REJECTED")
        self.assertEqual(rej_data["scope_change"]["rejection_reason"], rejection_reason)

        # Verify chat history contains rejection
        chat = rej_data["scope_change"]["chat_history"]
        self.assertTrue(any("SCOPE REVISION REJECTED" in msg.get("message", "") for msg in chat))

        # 7. Verify GET /api/projects/{id}/scope-changes returns the rejected scope change with rejection_reason
        list_resp = self.client.get(f"/api/projects/{project.id}/scope-changes")
        self.assertEqual(list_resp.status_code, 200)
        list_data = list_resp.json()
        self.assertIsNone(list_data["active_scope_change"])
        self.assertGreaterEqual(len(list_data["scope_changes"]), 1)
        sc_record = next(sc for sc in list_data["scope_changes"] if sc["id"] == sc_id)
        self.assertEqual(sc_record["status"], "REJECTED")
        self.assertEqual(sc_record["rejection_reason"], rejection_reason)
