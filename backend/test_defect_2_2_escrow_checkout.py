import os
import sys
import unittest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import main
main.os.environ["GEMINI_API_KEY"] = ""
main.GEMINI_API_KEY = ""

from main import app
from database import SessionLocal
import models

class TestDefect22EscrowCheckout(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_acceptance_launches_escrow_and_confirm(self):
        # 1. Initialize a test project
        init_res = self.client.post("/api/projects/init", json={
            "title": "Bespoke Walnut Credenza",
            "industry_type": "Carpentry",
            "description": "Custom walnut storage credenza with brass pulls",
            "total_price": 750.0,
            "deadline": "2026-12-15",
            "buyer_email": "buyer_defect22@prooflens.com"
        })
        self.assertEqual(init_res.status_code, 200)
        p_id = init_res.json()["project_id"]

        # 2. Finalize draft agreement
        fin_res = self.client.post(f"/api/projects/{p_id}/finalize-draft", json={
            "contract_terms": "Standard fine woodworking agreement.",
            "evidence_requirements": "Lumber selection and finished joinery photos.",
            "milestones": [
                {
                    "title": "Lumber Dimensioning",
                    "description": "Rough mill white walnut",
                    "price_allocation": 375.0,
                    "proof_required": "Photos with calipers",
                    "deadline": "2026-11-20"
                },
                {
                    "title": "Cabinet Glue-Up & Finish",
                    "description": "Dovetail joints and hardwax oil finish",
                    "price_allocation": 375.0,
                    "proof_required": "Photos of completed credenza",
                    "deadline": "2026-12-10"
                }
            ]
        })
        self.assertEqual(fin_res.status_code, 200)

        # 3. Test Acceptance (Defect 2.2 Core Test)
        # Calling POST /api/projects/{id}/accept MUST return approval_url and create PayPal Payment record
        accept_res = self.client.post(f"/api/projects/{p_id}/accept")
        self.assertEqual(accept_res.status_code, 200)
        data = accept_res.json()

        self.assertEqual(data["status"], "accepted")
        self.assertIsNotNone(data.get("paypal_order_id"))
        self.assertIsNotNone(data.get("approval_url"))
        self.assertIn("paypal.com", data["approval_url"])
        print(f"[OK] POST /api/projects/{p_id}/accept generated PayPal escrow order: {data['paypal_order_id']}")
        print(f"   Approval URL: {data['approval_url']}")

        # 4. Verify GET /api/projects/{id} exposes payment info & paypal_approval_url to frontend
        get_res = self.client.get(f"/api/projects/{p_id}")
        self.assertEqual(get_res.status_code, 200)
        proj_data = get_res.json()
        self.assertIsNotNone(proj_data.get("payment"))
        self.assertEqual(proj_data["payment"]["amount"], 750.0)
        self.assertIsNotNone(proj_data.get("paypal_approval_url"))
        print(f"[OK] GET /api/projects/{p_id} returned payment status: {proj_data['payment']['status']}")

        # 5. Simulate Buyer return from PayPal checkout: POST /api/escrow/confirm-authorization
        confirm_res = self.client.post(f"/api/escrow/confirm-authorization?order_id={data['paypal_order_id']}")
        self.assertEqual(confirm_res.status_code, 200)
        confirm_data = confirm_res.json()
        self.assertEqual(confirm_data["status"], "authorized")
        self.assertIsNotNone(confirm_data["authorization_id"])
        print(f"[OK] POST /api/escrow/confirm-authorization locked 29-day hold: {confirm_data['authorization_id']}")

        # 6. Verify project is now ACTIVE and escrow is locked
        get_active = self.client.get(f"/api/projects/{p_id}")
        self.assertEqual(get_active.json()["project"]["status"], "active")
        print("[OK] Project successfully transitioned to ACTIVE with full escrow protection locked!")

if __name__ == "__main__":
    unittest.main()
