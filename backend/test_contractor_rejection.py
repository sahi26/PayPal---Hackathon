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

class TestContractorRejection(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_contractor_agreement_rejection_flow(self):
        # 1. Initialize test project
        init_res = self.client.post("/api/projects/init", json={
            "title": "Custom Modern Pergola",
            "industry_type": "Construction",
            "description": "Cedar pergola with motorized louvers",
            "total_price": 1200.0,
            "deadline": "2026-11-20",
            "buyer_email": "buyer_reject_test@prooflens.com"
        })
        self.assertEqual(init_res.status_code, 200)
        p_id = init_res.json()["project_id"]

        # 2. Finalize draft
        fin_res = self.client.post(f"/api/projects/{p_id}/finalize-draft", json={
            "contract_terms": "Outdoor carpentry pergola construction.",
            "evidence_requirements": "Site footing inspection and completed structure.",
            "milestones": [
                {
                    "title": "Footings & Framing",
                    "description": "Concrete post footings and beam framing",
                    "price_allocation": 600.0,
                    "proof_required": "Site footing photos",
                    "deadline": "2026-11-10"
                },
                {
                    "title": "Louver Motorization & Finish",
                    "description": "Install motorized cedar louvers",
                    "price_allocation": 600.0,
                    "proof_required": "Video demonstration of louvers",
                    "deadline": "2026-11-20"
                }
            ]
        })
        self.assertEqual(fin_res.status_code, 200)

        # 3. Test rejection validation (empty reason rejected)
        rej_fail = self.client.post(f"/api/projects/{p_id}/reject", json={
            "reason": "   ",
            "role": "seller"
        })
        self.assertEqual(rej_fail.status_code, 400)

        # 4. Contractor rejects with detailed reason
        rejection_reason = "Milestone 1 deadline of Nov 10 is too aggressive for concrete curing and lumber delivery. Please extend timeline by 10 days."
        rej_res = self.client.post(f"/api/projects/{p_id}/reject", json={
            "reason": rejection_reason,
            "role": "seller"
        })
        self.assertEqual(rej_res.status_code, 200)
        rej_data = rej_res.json()
        self.assertEqual(rej_data["status"], "rejected")
        self.assertEqual(rej_data["contractor_rejection_reason"], rejection_reason)

        # 5. Verify GET /api/projects/{id} reflects rejection
        get_res = self.client.get(f"/api/projects/{p_id}")
        self.assertEqual(get_res.status_code, 200)
        proj_data = get_res.json()
        self.assertEqual(proj_data["project"]["status"], "rejected")
        self.assertEqual(proj_data["project"]["contractor_rejection_reason"], rejection_reason)

        # 6. Verify buyer can counter-negotiate to move status back to negotiating
        neg_res = self.client.post(f"/api/projects/{p_id}/negotiate", json={
            "message": "Understood, extending deadline to Nov 25.",
            "role": "buyer"
        })
        self.assertEqual(neg_res.status_code, 200)
        self.assertEqual(neg_res.json()["status"], "negotiating")

        # 7. Contractor accepts after terms aligned
        acc_res = self.client.post(f"/api/projects/{p_id}/accept")
        self.assertEqual(acc_res.status_code, 200)
        self.assertEqual(acc_res.json()["status"], "accepted")

if __name__ == "__main__":
    unittest.main()
