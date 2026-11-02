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

class TestMilestoneInvoicing(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_milestone_approval_and_invoice_lifecycle(self):
        # 1. Initialize a test project
        init_res = self.client.post("/api/projects/init", json={
            "title": "Architectural Drafting & Foundation",
            "industry_type": "Architecture",
            "description": "Full blueprints and site excavation with soil test",
            "total_price": 500.0,
            "deadline": "2026-12-30",
            "buyer_email": "sb-buyer@personal.example.com"
        })
        self.assertEqual(init_res.status_code, 200)
        p_id = init_res.json()["project_id"]

        # 2. Finalize draft agreement with 2 milestones
        fin_res = self.client.post(f"/api/projects/{p_id}/finalize-draft", json={
            "contract_terms": "Standard architectural delivery terms.",
            "evidence_requirements": "Stamped CAD drawings and site survey.",
            "milestones": [
                {
                    "title": "Milestone 1: Architectural Foundation Plans",
                    "description": "Submission of structural drawings and permit filings",
                    "price_allocation": 250.0,
                    "proof_required": "Stamped CAD drawings and approval letter",
                    "deadline": "2026-11-20"
                },
                {
                    "title": "Milestone 2: Foundation Excavation & Pour",
                    "description": "Completed concrete foundation pour with inspection signoff",
                    "price_allocation": 250.0,
                    "proof_required": "Slump test log and structural signoff",
                    "deadline": "2026-12-15"
                }
            ]
        })
        self.assertEqual(fin_res.status_code, 200)

        # 3. Accept agreement (triggers PayPal Escrow authorization)
        accept_res = self.client.post(f"/api/projects/{p_id}/accept")
        self.assertEqual(accept_res.status_code, 200)
        accept_data = accept_res.json()
        self.assertIn("paypal_order_id", accept_data)

        # 4. Confirm authorization (simulating buyer approval)
        conf_res = self.client.post("/api/escrow/confirm-authorization", json={
            "project_id": p_id,
            "token": accept_data["paypal_order_id"]
        })
        self.assertEqual(conf_res.status_code, 200)

        # 5. Approve Milestone 1
        approve_res = self.client.post(f"/api/milestones/{p_id}_0/approve")
        self.assertEqual(approve_res.status_code, 200)
        app_data = approve_res.json()
        self.assertEqual(app_data["status"], "approved")
        self.assertEqual(app_data["escrow_released"], 250.0)
        self.assertIsNotNone(app_data["paypal_capture_id"])

        # Check invoice data in approve response
        inv = app_data.get("invoice")
        self.assertIsNotNone(inv, "Invoice object should be attached to approve response")
        self.assertIn("paypal_invoice_id", inv)
        self.assertIn("invoice_number", inv)
        self.assertIn("invoice_url", inv)
        self.assertEqual(inv["status"], "PAID")
        self.assertEqual(inv["amount"], 250.0)

        # 6. Query Milestone 1 Invoice endpoint
        get_inv_res = self.client.get(f"/api/projects/{p_id}/milestones/0/invoice")
        self.assertEqual(get_inv_res.status_code, 200)
        inv_data = get_inv_res.json()
        self.assertEqual(inv_data["invoice_number"], inv["invoice_number"])
        self.assertEqual(inv_data["status"], "PAID")
        self.assertEqual(inv_data["amount"], 250.0)

        # 7. Query Project Invoices list
        list_inv_res = self.client.get(f"/api/projects/{p_id}/invoices")
        self.assertEqual(list_inv_res.status_code, 200)
        list_data = list_inv_res.json()
        self.assertGreaterEqual(list_data["total_invoices"], 1)

        # 8. Query Printable HTML Receipt
        receipt_res = self.client.get(f"/api/projects/{p_id}/milestones/0/invoice/receipt")
        self.assertEqual(receipt_res.status_code, 200)
        receipt_html = receipt_res.text
        self.assertIn("ProofLens", receipt_html)
        self.assertIn("PAID IN FULL", receipt_html)
        self.assertIn(inv["invoice_number"], receipt_html)
        self.assertIn("PAYPAL AUTHORITATIVE SETTLEMENT REFERENCE", receipt_html)

if __name__ == "__main__":
    unittest.main()
