import os
import sys
import json
import unittest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import backend.main as main
main.os.environ["GEMINI_API_KEY"] = ""
main.GEMINI_API_KEY = ""
from backend.main import app

class TestMilestoneRejectionFlow(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_milestone_rejection_and_resubmission(self):
        # 1. Create project
        init_res = self.client.post("/api/projects/init", json={
            "title": "Bespoke Dining Table",
            "industry_type": "Carpentry",
            "description": "Solid walnut dining table 8ft x 3ft.",
            "total_price": 600.0,
            "deadline": "2026-12-01",
            "buyer_email": "buyer@test.com"
        })
        self.assertEqual(init_res.status_code, 200)
        p_id = init_res.json()["project_id"]

        # Finalize draft with 3 milestones
        milestones = [
            {
                "title": "Lumber Milling & Joinery",
                "description": "Rough dimensioning and mortise-and-tenon joints.",
                "price_allocation": 200.0,
                "proof_required": "Photos of dimensioned lumber with tape measure.",
                "deadline": "2026-11-10",
                "status": "pending"
            },
            {
                "title": "Assembly & Precision Sanding",
                "description": "Dry fit, glue up, square clamp, sanding to 220 grit.",
                "price_allocation": 200.0,
                "proof_required": "Caliper photos and flatness straightedge check.",
                "deadline": "2026-11-20",
                "status": "pending"
            },
            {
                "title": "Hardwax Oil Finish & Delivery",
                "description": "3 coats of Rubio Monocoat and delivery.",
                "price_allocation": 200.0,
                "proof_required": "Video of water droplet bead test and carrier receipt.",
                "deadline": "2026-11-30",
                "status": "pending"
            }
        ]

        fin_res = self.client.post(f"/api/projects/{p_id}/finalize-draft", json={
            "contract_terms": "Standard agreement terms",
            "evidence_requirements": "Photographic evidence required",
            "milestones": milestones
        })
        self.assertEqual(fin_res.status_code, 200)
        invite_token = fin_res.json()["invite_token"]

        # Seller joins and accepts terms
        join_res = self.client.post(f"/api/projects/invite/{invite_token}/join", json={
            "seller_email": "seller@carpentry.com",
            "seller_name": "Master Craftsman"
        })
        self.assertEqual(join_res.status_code, 200)

        accept_res = self.client.post(f"/api/projects/{p_id}/accept")
        self.assertEqual(accept_res.status_code, 200)

        # 2. Contractor submits evidence for Milestone 1
        sub_res = self.client.post(
            f"/api/milestones/{p_id}_0/submit-evidence",
            data={
                "capture_method": "live_camera",
                "evidence_type": "milestone_evidence",
                "milestone_index": 0
            },
            files={"file": ("test_rough_lumber.jpg", b"fake_image_bytes_here_12345", "image/jpeg")}
        )
        self.assertEqual(sub_res.status_code, 200)
        self.assertEqual(sub_res.json()["status"], "awaiting_buyer_review")

        # 3. Buyer REJECTS Milestone 1 evidence and requests resubmission
        reject_reason = "Lumber dimensions appear 2 inches narrower than blueprint. Please remeasure with a clear caliper view."
        reject_res = self.client.post(
            f"/api/projects/{p_id}/milestones/0/reject",
            json={"reason": reject_reason}
        )
        self.assertEqual(reject_res.status_code, 200)
        reject_data = reject_res.json()
        self.assertEqual(reject_data["status"], "resubmission_requested")
        self.assertEqual(reject_data["rejection_reason"], reject_reason)
        print("✅ Milestone 1 evidence rejected by buyer successfully!")

        # 4. Check alerts for contractor
        alert_res = self.client.get(f"/api/projects/{p_id}/alerts")
        self.assertEqual(alert_res.status_code, 200)
        alert_json = alert_res.json()
        self.assertTrue(alert_json["has_alert"])
        self.assertEqual(alert_json["alert_type"], "resubmission_requested")
        self.assertIn("Lumber dimensions appear 2 inches narrower", alert_json["message"])
        print(f"✅ Contractor active alert verified: {alert_json['message']}")

        # 5. Milestone 2 submission must STILL be blocked by sequential logic
        blocked_res = self.client.post(
            f"/api/milestones/{p_id}_1/submit-evidence",
            data={
                "capture_method": "live_camera",
                "evidence_type": "milestone_evidence",
                "milestone_index": 1
            },
            files={"file": ("assembly.jpg", b"fake_assembly_bytes", "image/jpeg")}
        )
        self.assertEqual(blocked_res.status_code, 400)
        self.assertIn("Sequential milestone restriction", blocked_res.json()["detail"])
        print("✅ Milestone 2 submission correctly blocked while Milestone 1 is in resubmission state!")

        # 6. Contractor RESUBMITS Milestone 1 with corrected proof
        resub_res = self.client.post(
            f"/api/milestones/{p_id}_0/submit-evidence",
            data={
                "capture_method": "live_camera",
                "evidence_type": "milestone_evidence",
                "milestone_index": 0
            },
            files={"file": ("test_caliper_measure.jpg", b"fake_caliper_photo_bytes_9999", "image/jpeg")}
        )
        self.assertEqual(resub_res.status_code, 200)
        self.assertEqual(resub_res.json()["status"], "awaiting_buyer_review")
        print("✅ Contractor successfully resubmitted Milestone 1 evidence!")

        # Check milestone status in project
        ms_res = self.client.get(f"/api/projects/{p_id}/milestones")
        self.assertEqual(ms_res.status_code, 200)
        m0 = ms_res.json()["milestones"][0]
        self.assertEqual(m0["status"], "awaiting_buyer_review")
        self.assertIsNone(m0["rejection_reason"])
        self.assertEqual(m0["previous_rejection_reason"], reject_reason)
        print("✅ Milestone 1 status back to awaiting_buyer_review; previous rejection preserved in history!")

        # 7. Buyer APPROVES Milestone 1
        app_res = self.client.post(f"/api/projects/{p_id}/milestones/0/approve")
        self.assertEqual(app_res.status_code, 200)
        self.assertEqual(app_res.json()["status"], "approved")
        self.assertEqual(app_res.json()["next_active_milestone_index"], 1)
        print("✅ Milestone 1 approved by buyer! Milestone 2 unlocked.")

        # 8. Now Milestone 2 can be submitted
        m2_res = self.client.post(
            f"/api/milestones/{p_id}_1/submit-evidence",
            data={
                "capture_method": "live_camera",
                "evidence_type": "milestone_evidence",
                "milestone_index": 1
            },
            files={"file": ("assembly.jpg", b"fake_assembly_bytes", "image/jpeg")}
        )
        self.assertEqual(m2_res.status_code, 200)
        self.assertEqual(m2_res.json()["status"], "awaiting_buyer_review")
        print("✅ Milestone 2 evidence submitted successfully!")

if __name__ == "__main__":
    unittest.main()
