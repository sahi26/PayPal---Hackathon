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

class TestScopeChangesFeature(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        run_migrations(engine)
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_scope_change_full_lifecycle(self):
        # 1. Setup a test project and initial Agreement (v1)
        buyer = models.User(
            email=f"buyer_scope_{datetime.utcnow().timestamp()}@prooflens.com",
            password_hash="mock_hash",
            full_name="Alice Buyer",
            role_type="buyer"
        )
        seller = models.User(
            email=f"seller_scope_{datetime.utcnow().timestamp()}@prooflens.com",
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
            title="Custom Oak Dining Table",
            industry_type="Carpentry",
            description="Handcrafted solid white oak dining table (72x36x30).",
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
                "price_allocation": 100.0,
                "deadline": "2026-11-05",
                "relative_deadline": "Due 5 days from project creation",
                "proof_required": "Live photo with calipers",
                "status": "approved" # Completed milestone
            },
            {
                "title": "Full Assembly & Precision Surface Sanding",
                "description": "Joinery and assembly",
                "price_allocation": 100.0,
                "deadline": "2026-11-12",
                "relative_deadline": "Due 12 days from project creation",
                "proof_required": "Photos of squareness and joinery",
                "status": "pending" # Uncompleted milestone (should be shifted)
            },
            {
                "title": "Protective Multi-Coat Finish & Delivery",
                "description": "Finishing and delivery",
                "price_allocation": 100.0,
                "deadline": "2026-11-20",
                "relative_deadline": "Due 20 days from project creation",
                "proof_required": "Live video of table and dispatch receipt",
                "status": "pending" # Uncompleted milestone (should be shifted)
            }
        ]

        agreement_v1 = models.Agreement(
            project_id=project.id,
            version=1,
            status="ACTIVE",
            is_accepted_by_client=1,
            ai_generated_contract="Initial Contract Terms v1",
            evidence_requirements="Initial Requirements v1",
            milestones=initial_milestones
        )
        self.db.add(agreement_v1)
        self.db.commit()
        self.db.refresh(agreement_v1)
        project_id = project.id
        buyer_email = buyer.email
        seller_email = seller.email

        # Verify project endpoint returns v1 agreement
        resp = self.client.get(f"/api/projects/{project_id}")
        self.assertEqual(resp.status_code, 200, resp.text)
        p_data = resp.json()
        self.assertEqual(p_data["agreement"]["version"], 1)
        self.assertEqual(p_data["agreement"]["status"], "ACTIVE")
        self.assertEqual(len(p_data["agreement"]["milestones"]), 3)

        # =========================================================================
        # Phase 2: Init Scope Change Request (POST /api/projects/{id}/scope-change/init)
        # =========================================================================
        init_payload = {
            "description": "Add two 18-inch matching extension leaves with felt-lined storage box ($120 extra, 4 extra days)",
            "user_email": buyer_email
        }
        init_resp = self.client.post(f"/api/projects/{project_id}/scope-change/init", json=init_payload)
        self.assertEqual(init_resp.status_code, 200, init_resp.text)
        init_data = init_resp.json()
        sc = init_data["scope_change"]
        self.assertIsNotNone(sc["id"])
        self.assertEqual(sc["status"], "NEGOTIATING")
        self.assertGreater(sc["proposed_extra_cost"], 0)
        self.assertGreater(sc["proposed_extra_days"], 0)
        self.assertGreaterEqual(len(sc["proposed_milestones"]), 1)
        self.assertTrue(sc["proposed_milestones"][0]["is_addendum"])
        self.assertIn("Addendum", sc["addendum_contract"])
        sc_id = sc["id"]

        # =========================================================================
        # Negotiate: Contractor Counter-Offers (POST /api/projects/{id}/scope-change/negotiate)
        # =========================================================================
        nego_payload = {
            "scope_change_id": sc_id,
            "sender_email": seller_email,
            "sender_role": "seller",
            "message": "We need $120.00 extra and 4 extra days for high-grade oak matching grain and precision brass alignment pins.",
            "proposed_extra_cost": 120.0,
            "proposed_extra_days": 4
        }
        nego_resp = self.client.post(f"/api/projects/{project_id}/scope-change/negotiate", json=nego_payload)
        self.assertEqual(nego_resp.status_code, 200, nego_resp.text)
        nego_data = nego_resp.json()
        self.assertEqual(nego_data["scope_change"]["proposed_extra_cost"], 120.0)
        self.assertEqual(nego_data["scope_change"]["proposed_extra_days"], 4)
        self.assertGreaterEqual(len(nego_data["scope_change"]["chat_history"]), 2)

        # =========================================================================
        # Accept Scope Change (POST /api/projects/{id}/scope-change/accept)
        # =========================================================================
        accept_payload = {
            "scope_change_id": sc_id,
            "user_email": buyer_email
        }
        accept_resp = self.client.post(f"/api/projects/{project_id}/scope-change/accept", json=accept_payload)
        self.assertEqual(accept_resp.status_code, 200, accept_resp.text)
        accept_data = accept_resp.json()
        self.assertEqual(accept_data["status"], "PENDING_FUNDS")
        self.assertIn("paypal_approval_url", accept_data)
        self.assertTrue(accept_data["paypal_approval_url"].startswith("http"))
        self.assertIsNotNone(accept_data["paypal_order_id"])
        self.assertEqual(accept_data["agreement_version"], 2)
        self.assertEqual(accept_data["project"]["total_price"], 420.0) # 300 + 120

        # Verify milestones in response
        combined_ms = accept_data["milestones"]
        self.assertEqual(len(combined_ms), 4) # 3 initial + 1 addendum milestone
        # Milestone 1 was approved: deadline should remain unchanged
        self.assertEqual(combined_ms[0]["deadline"], "2026-11-05")
        self.assertEqual(combined_ms[0]["status"], "approved")
        # Milestone 2 was pending: deadline shifted by 4 days (12 + 4 = 16)
        self.assertEqual(combined_ms[1]["deadline"], "2026-11-16")
        # Milestone 3 was pending: deadline shifted by 4 days (20 + 4 = 24)
        self.assertEqual(combined_ms[2]["deadline"], "2026-11-24")
        # Milestone 4 is Addendum milestone
        self.assertTrue(combined_ms[3]["is_addendum"])
        self.assertEqual(combined_ms[3]["version"], 2)

        # Verify database state
        check_db = SessionLocal()
        p_check = check_db.query(models.Project).filter(models.Project.id == project_id).first()
        self.assertEqual(len(p_check.agreements), 2)
        v1_rec = next(a for a in p_check.agreements if a.version == 1)
        v2_rec = next(a for a in p_check.agreements if a.version == 2)
        self.assertEqual(v1_rec.status, "SUPERSEDED")
        self.assertEqual(v2_rec.status, "ACTIVE")
        # Project.agreement property dynamically returns active v2 agreement
        self.assertEqual(p_check.agreement.version, 2)
        self.assertEqual(p_check.total_price, 420.0)
        check_db.close()

        # =========================================================================
        # Authorize Funds (POST /api/projects/{id}/scope-change/authorize-funds)
        # =========================================================================
        auth_payload = {
            "scope_change_id": sc_id,
            "paypal_order_id": accept_data["paypal_order_id"]
        }
        auth_resp = self.client.post(f"/api/projects/{project_id}/scope-change/authorize-funds", json=auth_payload)
        self.assertEqual(auth_resp.status_code, 200, auth_resp.text)
        auth_data = auth_resp.json()
        self.assertEqual(auth_data["status"], "ACCEPTED")
        self.assertEqual(auth_data["scope_change"]["status"], "ACCEPTED")

        # Verify Payment recorded in database
        pay_db = SessionLocal()
        payment = pay_db.query(models.Payment).filter(
            models.Payment.paypal_order_id == accept_data["paypal_order_id"]
        ).first()
        self.assertIsNotNone(payment)
        self.assertEqual(payment.amount, 120.0)
        self.assertEqual(payment.status, models.PaymentStatus.AUTHORIZED)
        pay_db.close()

        # Verify GET /api/projects/{id}/scope-changes
        sc_list_resp = self.client.get(f"/api/projects/{project_id}/scope-changes")
        self.assertEqual(sc_list_resp.status_code, 200)
        sc_list_data = sc_list_resp.json()
        self.assertGreaterEqual(len(sc_list_data["scope_changes"]), 1)

if __name__ == "__main__":
    unittest.main()
