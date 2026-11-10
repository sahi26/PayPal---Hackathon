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
        self.assertTrue(m0.get("resubmitted_at"))
        self.assertGreater(m0.get("rejected_evidence_max_id", 0), 0)
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

    def test_evidence_batch_multi_angle_rejection_and_rapid_resubmission(self):
        init_res = self.client.post("/api/projects/init", json={
            "title": "Custom Jewellery Ring",
            "industry_type": "Jewellery",
            "description": "Custom 18k gold gemstone ring handcrafted physically.",
            "total_price": 500.0,
            "deadline": "2026-12-15",
            "buyer_email": "buyer_jewel@test.com"
        })
        self.assertEqual(init_res.status_code, 200)
        p_id = init_res.json()["project_id"]

        milestones = [
            {
                "title": "Wax Casting & Stone Setting",
                "description": "Cast ring setting and set gemstone.",
                "price_allocation": 250.0,
                "proof_required": "Photos of cast ring and stone setting.",
                "deadline": "2026-11-20",
                "status": "pending"
            },
            {
                "title": "Final Polish & Hallmark",
                "description": "Final mirror polish and 18k stamp.",
                "price_allocation": 250.0,
                "proof_required": "Photos of polished ring and hallmark.",
                "deadline": "2026-12-10",
                "status": "pending"
            }
        ]
        fin_res = self.client.post(f"/api/projects/{p_id}/finalize-draft", json={
            "contract_terms": "Physical craftsmanship agreement",
            "evidence_requirements": "Live camera multi-angle photos",
            "milestones": milestones
        })
        self.assertEqual(fin_res.status_code, 200)
        invite_token = fin_res.json()["invite_token"]

        join_res = self.client.post(f"/api/projects/invite/{invite_token}/join", json={
            "seller_email": "jeweller@test.com",
            "seller_name": "Artisan Jeweller"
        })
        self.assertEqual(join_res.status_code, 200)
        self.assertEqual(self.client.post(f"/api/projects/{p_id}/accept").status_code, 200)

        # 1. Seller submits 2-angle live capture batch
        batch1_res = self.client.post(
            f"/api/projects/{p_id}/evidence-batch",
            data={
                "capture_method": "live_camera",
                "evidence_type": "milestone_evidence",
                "milestone_index": 0
            },
            files=[
                ("files", ("angle1.jpg", b"ring_attempt_1_angle_1_bytes", "image/jpeg")),
                ("files", ("angle2.jpg", b"ring_attempt_1_angle_2_bytes", "image/jpeg")),
            ]
        )
        self.assertEqual(batch1_res.status_code, 200)
        b1_json = batch1_res.json()
        self.assertEqual(b1_json["total_uploaded"], 2)
        b1_id = b1_json["submission_batch_id"]
        self.assertTrue(b1_id)
        for item in b1_json["items"]:
            self.assertEqual(item["ai_comparison_details"]["submission_batch_id"], b1_id)

        # 2. Buyer rejects Milestone 0
        reason = "Lighting obscured prong setting. Please recapture closer to gemstone."
        reject_res = self.client.post(
            f"/api/projects/{p_id}/milestones/0/reject",
            json={"reason": reason}
        )
        self.assertEqual(reject_res.status_code, 200)
        m0_after_reject = reject_res.json()["milestones"][0]
        self.assertEqual(m0_after_reject["status"], "resubmission_requested")
        self.assertIn("+00:00", m0_after_reject["rejected_at"])
        max_b1_ev_id = max(item["id"] for item in b1_json["items"])
        self.assertEqual(m0_after_reject["rejected_evidence_max_id"], max_b1_ev_id)

        # Both angles in batch 1 must be marked buyer_resubmission_requested
        ev_list_after_reject = self.client.get(f"/api/projects/{p_id}/evidence").json()
        self.assertEqual(len(ev_list_after_reject), 2)
        for ev in ev_list_after_reject:
            self.assertIn("buyer_resubmission_requested", ev["fraud_flags"])
            self.assertIn("Buyer Rejection Feedback:", ev["ai_analysis_notes"])

        # Alert endpoint should report resubmission_requested
        alert_res = self.client.get(f"/api/projects/{p_id}/alerts").json()
        self.assertTrue(alert_res["has_alert"])
        self.assertEqual(alert_res["alert_type"], "resubmission_requested")

        # 3. Seller rapidly (<1s) resubmits 2 new angles via evidence-batch
        batch2_res = self.client.post(
            f"/api/projects/{p_id}/evidence-batch",
            data={
                "capture_method": "live_camera",
                "evidence_type": "milestone_evidence",
                "milestone_index": 0
            },
            files=[
                ("files", ("new_angle1.jpg", b"ring_attempt_2_angle_1_bytes", "image/jpeg")),
                ("files", ("new_angle2.jpg", b"ring_attempt_2_angle_2_bytes", "image/jpeg")),
            ]
        )
        self.assertEqual(batch2_res.status_code, 200)
        b2_json = batch2_res.json()
        b2_id = b2_json["submission_batch_id"]
        self.assertNotEqual(b1_id, b2_id)
        for item in b2_json["items"]:
            self.assertEqual(item["ai_comparison_details"]["submission_batch_id"], b2_id)
            self.assertNotIn("buyer_resubmission_requested", item["fraud_flags"])

        # Milestone state must flip back to awaiting_buyer_review & clear active rejection_reason
        proj_after_resub = self.client.get(f"/api/projects/{p_id}").json()
        m0_after_resub = proj_after_resub["agreement"]["milestones"][0]
        self.assertEqual(m0_after_resub["status"], "awaiting_buyer_review")
        self.assertIsNone(m0_after_resub["rejection_reason"])
        self.assertEqual(m0_after_resub["previous_rejection_reason"], reason)
        self.assertTrue(m0_after_resub.get("resubmitted_at"))
        self.assertEqual(m0_after_resub["rejected_evidence_max_id"], max_b1_ev_id)

        # Approve succeeds using newest batch
        app_res = self.client.post(f"/api/projects/{p_id}/milestones/0/approve")
        self.assertEqual(app_res.status_code, 200)
        self.assertEqual(app_res.json()["status"], "approved")

    def test_digital_evidence_url_and_file_rejection_resubmission(self):
        init_res = self.client.post("/api/projects/init", json={
            "title": "SaaS Dashboard UI Kit",
            "industry_type": "Software",
            "description": "Design Figma UI components and dashboard screens.",
            "total_price": 400.0,
            "deadline": "2026-12-20",
            "buyer_email": "buyer_ui@test.com"
        })
        self.assertEqual(init_res.status_code, 200)
        p_id = init_res.json()["project_id"]

        milestones = [
            {
                "title": "Design System & Components",
                "description": "Figma library with tokens and components.",
                "price_allocation": 400.0,
                "proof_required": "Figma link or SVG/PNG asset export.",
                "deadline": "2026-12-01",
                "status": "pending"
            }
        ]
        fin_res = self.client.post(f"/api/projects/{p_id}/finalize-draft", json={
            "contract_terms": "Digital UI kit terms",
            "evidence_requirements": "Digital deliverables and preview links",
            "milestones": milestones
        })
        self.assertEqual(fin_res.status_code, 200)
        invite_token = fin_res.json()["invite_token"]

        self.client.post(f"/api/projects/invite/{invite_token}/join", json={
            "seller_email": "designer@test.com",
            "seller_name": "UI Designer"
        })
        self.assertEqual(self.client.post(f"/api/projects/{p_id}/accept").status_code, 200)

        # 1. Seller submits URL-only milestone deliverable via /evidence
        sub1 = self.client.post(
            f"/api/projects/{p_id}/evidence",
            data={
                "capture_method": "file_upload",
                "evidence_type": "milestone_evidence",
                "milestone_index": 0,
                "asset_url": "https://www.figma.com/design/attempt-1"
            }
        )
        self.assertEqual(sub1.status_code, 200)
        s1_json = sub1.json()
        self.assertEqual(s1_json["evidence_type"], "milestone_evidence")
        self.assertEqual(s1_json["milestone_index"], 0)
        self.assertEqual(s1_json["asset_url"], "https://www.figma.com/design/attempt-1")

        # Must NOT wrongly flip before_evidence_status to "provided"
        proj1 = self.client.get(f"/api/projects/{p_id}").json()
        self.assertNotEqual(proj1["project"]["before_evidence_status"], "provided")
        self.assertEqual(proj1["agreement"]["milestones"][0]["status"], "awaiting_buyer_review")

        # 2. Buyer rejects Milestone 0
        reason1 = "Missing mobile breakpoints in Figma file."
        rej1 = self.client.post(f"/api/projects/{p_id}/milestones/0/reject", json={"reason": reason1})
        self.assertEqual(rej1.status_code, 200)
        self.assertEqual(rej1.json()["milestones"][0]["status"], "resubmission_requested")

        # 3. Seller resubmits via URL-only
        sub2 = self.client.post(
            f"/api/projects/{p_id}/evidence",
            data={
                "capture_method": "file_upload",
                "evidence_type": "milestone_evidence",
                "milestone_index": 0,
                "asset_url": "https://www.figma.com/design/attempt-2-responsive"
            }
        )
        self.assertEqual(sub2.status_code, 200)
        proj2 = self.client.get(f"/api/projects/{p_id}").json()
        m0_2 = proj2["agreement"]["milestones"][0]
        self.assertEqual(m0_2["status"], "awaiting_buyer_review")
        self.assertIsNone(m0_2["rejection_reason"])
        self.assertEqual(m0_2["previous_rejection_reason"], reason1)
        self.assertNotEqual(
            s1_json["ai_comparison_details"]["submission_batch_id"],
            sub2.json()["ai_comparison_details"]["submission_batch_id"],
        )

        # 4. Buyer rejects a second time, seller resubmits via PNG file upload
        reason2 = "Export hi-res preview screenshot as well."
        self.client.post(f"/api/projects/{p_id}/milestones/0/reject", json={"reason": reason2})
        sub3 = self.client.post(
            f"/api/projects/{p_id}/evidence",
            data={
                "capture_method": "file_upload",
                "evidence_type": "milestone_evidence",
                "milestone_index": 0
            },
            files={"file": ("dashboard_v3.png", b"png_binary_payload_attempt_3", "image/png")}
        )
        self.assertEqual(sub3.status_code, 200)

        ev_list = self.client.get(f"/api/projects/{p_id}/evidence").json()
        self.assertEqual(len(ev_list), 3)
        self.assertEqual(ev_list[0]["id"], sub3.json()["evidence_id"])
        self.assertEqual(ev_list[1]["asset_url"], "https://www.figma.com/design/attempt-2-responsive")
        self.assertIn("buyer_resubmission_requested", ev_list[1]["fraud_flags"])
        self.assertIn("buyer_resubmission_requested", ev_list[2]["fraud_flags"])

        proj3 = self.client.get(f"/api/projects/{p_id}").json()
        m0_3 = proj3["agreement"]["milestones"][0]
        self.assertEqual(m0_3["status"], "awaiting_buyer_review")
        self.assertIsNone(m0_3["rejection_reason"])
        self.assertEqual(m0_3["rejected_evidence_max_id"], sub2.json()["evidence_id"])

        app_res = self.client.post(f"/api/projects/{p_id}/milestones/0/approve")
        self.assertEqual(app_res.status_code, 200)
        self.assertEqual(app_res.json()["status"], "approved")

if __name__ == "__main__":
    unittest.main()
