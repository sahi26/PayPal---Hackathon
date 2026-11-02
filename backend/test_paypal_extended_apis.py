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

class TestPayPalExtendedAPIs(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_paypal_balances_api(self):
        """Transaction Search v1: Tests GET /api/paypal/balances"""
        res = self.client.get("/api/paypal/balances")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("balances", data)
        self.assertIsInstance(data["balances"], list)
        self.assertGreaterEqual(len(data["balances"]), 1)
        bal = data["balances"][0]
        self.assertIn("currency", bal)
        self.assertIn("total_balance", bal)
        self.assertIn("available_balance", bal)
        print(f"[OK] GET /api/paypal/balances returned: {bal['currency']} Available = {bal['available_balance']['value']}")

    def test_paypal_transactions_api(self):
        """Transaction Search v1: Tests GET /api/paypal/transactions"""
        res = self.client.get("/api/paypal/transactions?days_back=15&page_size=10")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue("transaction_details" in data or "total_items" in data)
        print(f"[OK] GET /api/paypal/transactions returned payload with {len(data.get('transaction_details', []))} records")

    def test_escrow_void_and_refund_lifecycle(self):
        """Payments v2: Tests Escrow Authorization Voiding and Capture Refunding"""
        # 1. Create a project
        init_res = self.client.post("/api/projects/init", json={
            "title": "Extended PayPal API Test Project",
            "industry_type": "Software",
            "description": "PayPal transaction and void API testing",
            "total_price": 750.0,
            "deadline": "2026-12-31",
            "buyer_email": "test-buyer@prooflens.com"
        })
        self.assertEqual(init_res.status_code, 200)
        p_id = init_res.json()["project_id"]

        # 2. Finalize draft
        fin_res = self.client.post(f"/api/projects/{p_id}/finalize-draft", json={
            "contract_terms": "Standard software delivery terms.",
            "evidence_requirements": "GitHub repo and PR link.",
            "milestones": [
                {
                    "title": "Milestone Alpha",
                    "description": "Backend API integration",
                    "price_allocation": 750.0,
                    "proof_required": "Unit tests and postman collection",
                    "deadline": "2026-12-15"
                }
            ]
        })
        self.assertEqual(fin_res.status_code, 200)

        # 3. Test void on project with no authorized payment -> 400
        bad_void = self.client.post(f"/api/escrow/{p_id}/void", json={"note": "Cancel without hold"})
        self.assertEqual(bad_void.status_code, 400)
        self.assertIn("No active authorized escrow payment found", bad_void.json()["detail"])

        # 4. Accept agreement to generate PayPal Escrow order
        accept_res = self.client.post(f"/api/projects/{p_id}/accept")
        self.assertEqual(accept_res.status_code, 200)
        order_id = accept_res.json()["paypal_order_id"]

        # 5. Confirm authorization
        conf_res = self.client.post("/api/escrow/confirm-authorization", json={
            "project_id": p_id,
            "token": order_id
        })
        self.assertEqual(conf_res.status_code, 200)

        # 6. Verify Payment is now AUTHORIZED in DB
        db_payment = self.db.query(models.Payment).filter(models.Payment.project_id == p_id).first()
        self.assertIsNotNone(db_payment)
        self.assertEqual(db_payment.status, models.PaymentStatus.AUTHORIZED)
        self.assertIsNotNone(db_payment.authorization_id)

        # 7. Test Void Escrow Authorization
        void_res = self.client.post(f"/api/escrow/{p_id}/void", json={
            "note": "Mutual contract cancellation before delivery"
        })
        self.assertEqual(void_res.status_code, 200)
        void_data = void_res.json()
        self.assertEqual(void_data["status"], "voided")
        self.assertIn("Escrow authorization voided successfully", void_data["message"])

        # DB payment should now be VOIDED
        self.db.refresh(db_payment)
        self.assertEqual(db_payment.status, models.PaymentStatus.VOIDED)
        print(f"[OK] POST /api/escrow/{p_id}/void successfully voided authorization {db_payment.authorization_id}")

        # 8. Test Refund on captured payment
        # Create a captured payment record for testing refund
        refund_project_init = self.client.post("/api/projects/init", json={
            "title": "Refund Test Project",
            "industry_type": "Design",
            "description": "Graphic branding design",
            "total_price": 300.0,
            "deadline": "2026-12-31",
            "buyer_email": "refund-buyer@prooflens.com"
        })
        rp_id = refund_project_init.json()["project_id"]

        captured_payment = models.Payment(
            project_id=rp_id,
            amount=300.0,
            status=models.PaymentStatus.CAPTURED,
            paypal_order_id="TEST_ORDER_REFUND_123",
            capture_id="TEST_CAPTURE_456"
        )
        self.db.add(captured_payment)
        self.db.commit()

        refund_res = self.client.post(f"/api/escrow/{rp_id}/refund", json={
            "capture_id": "TEST_CAPTURE_456",
            "amount": 100.0,
            "currency": "USD",
            "note": "Partial refund for late deliverable"
        })
        self.assertEqual(refund_res.status_code, 200)
        ref_data = refund_res.json()
        self.assertEqual(ref_data["capture_id"], "TEST_CAPTURE_456")
        self.assertIn("refund", ref_data)
        print(f"[OK] POST /api/escrow/{rp_id}/refund successfully executed for capture TEST_CAPTURE_456")

    def test_order_shipment_tracking_api(self):
        """Orders v2: Tests POST /api/projects/{project_id}/track"""
        init_res = self.client.post("/api/projects/init", json={
            "title": "Physical Deliverable Project",
            "industry_type": "Manufacturing",
            "description": "Custom 3D printed prototype delivery",
            "total_price": 450.0,
            "deadline": "2026-12-31",
            "buyer_email": "delivery-buyer@prooflens.com"
        })
        p_id = init_res.json()["project_id"]

        # Create payment record with order_id
        payment = models.Payment(
            project_id=p_id,
            amount=450.0,
            status=models.PaymentStatus.AUTHORIZED,
            paypal_order_id="TEST_ORDER_TRACK_789"
        )
        self.db.add(payment)
        self.db.commit()

        track_res = self.client.post(f"/api/projects/{p_id}/track", json={
            "tracking_number": "1Z9999999999999999",
            "carrier": "UPS",
            "status": "SHIPPED",
            "notify_payer": True
        })
        self.assertEqual(track_res.status_code, 200)
        track_data = track_res.json()
        self.assertEqual(track_data["order_id"], "TEST_ORDER_TRACK_789")
        self.assertIn("tracking", track_data)
        print(f"[OK] POST /api/projects/{p_id}/track successfully attached UPS tracking to order TEST_ORDER_TRACK_789")

if __name__ == "__main__":
    unittest.main()
