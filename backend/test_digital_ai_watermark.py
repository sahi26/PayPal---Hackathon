import os
import sys
import unittest
import hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Offline safety probe for testing
import main
main.os.environ["GEMINI_API_KEY"] = ""
main.GEMINI_API_KEY = ""

from fastapi.testclient import TestClient
from main import app, inspect_digital_deliverable_for_ai_watermark
import models
import database

client = TestClient(app)

class TestDigitalAiWatermarkVerification(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 1. Create a digital project
        digital_payload = {
            "title": "FinTech Mobile App UI Design",
            "industry_type": "UI/UX & Web Design",
            "description": "Design high-fidelity mobile wallet app UI screens in Figma, export SVG vector assets and typography design system.",
            "total_price": 500.0,
            "deadline": "2026-11-25",
            "buyer_email": "buyer.fintech@example.com"
        }
        res = client.post("/api/projects/init", json=digital_payload)
        assert res.status_code == 200, res.text
        data = res.json()
        cls.digital_project_id = data["project_id"]
        assert data.get("project_domain") == "digital"

        # Finalize draft with 2 milestones
        milestones = [
            {
                "id": 1,
                "title": "Onboarding & Auth Flow Screens",
                "description": "Figma design frames and vector exports for login and 2FA.",
                "proof_required": "Exported SVG vector assets and typography style sheet.",
                "price_allocation": 250.0,
                "status": "pending"
            },
            {
                "id": 2,
                "title": "Wallet Dashboard & Transaction Feed",
                "description": "Interactive mobile wallet UI frames and dark mode variants.",
                "proof_required": "Complete layered UI design system deliverable.",
                "price_allocation": 250.0,
                "status": "pending"
            }
        ]
        fin_res = client.post(f"/api/projects/{cls.digital_project_id}/finalize-draft", json={
            "contract_terms": "Digital deliverable contract with anti-AI-watermark verification.",
            "evidence_requirements": "Original vector files and export assets.",
            "milestones": milestones
        })
        assert fin_res.status_code == 200, fin_res.text

        # 2. Create a physical project to test restriction enforcement
        physical_payload = {
            "title": "Custom Walnut Dining Table",
            "industry_type": "Custom Carpentry & Woodworking",
            "description": "Handcrafted live-edge walnut dining table with mortise and tenon joinery.",
            "total_price": 600.0,
            "deadline": "2026-11-30",
            "buyer_email": "buyer.furniture@example.com"
        }
        phys_res = client.post("/api/projects/init", json=physical_payload)
        assert phys_res.status_code == 200, phys_res.text
        cls.physical_project_id = phys_res.json()["project_id"]

    def test_01_physical_project_strictly_rejects_file_upload(self):
        """Physical projects must enforce strict live camera capture; file uploads must return HTTP 400."""
        fake_file = (b"Fake evidence bytes for carpentry work")
        files = {"file": ("desk.jpg", fake_file, "image/jpeg")}
        form_data = {
            "capture_method": "file_upload",
            "evidence_type": "milestone_evidence",
            "milestone_index": 0
        }
        res = client.post(f"/api/projects/{self.physical_project_id}/evidence", data=form_data, files=files)
        self.assertEqual(res.status_code, 400)
        self.assertIn("File upload is strictly disabled for physical projects", res.json()["detail"])

    def test_02_direct_inspection_detects_synthetic_ai_watermarks(self):
        """Unit test forensic watermark detection function against synthetic AI markers."""
        # 1. Clean vector/image file
        clean_file_path = "/tmp/test_clean_vector.svg"
        with open(clean_file_path, "wb") as f:
            f.write(b"<svg xmlns='http://www.w3.org/2000/svg'><circle cx='50' cy='50' r='40'/></svg>")
        
        clean_res = inspect_digital_deliverable_for_ai_watermark(clean_file_path, "Clean SVG vector deliverable", "UI Design")
        self.assertFalse(clean_res["has_ai_watermark"])
        self.assertEqual(len(clean_res["flags"]), 0)
        self.assertEqual(clean_res["confidence"], 96)

        # 2. SynthID watermark detection
        synthid_file_path = "/tmp/test_synthid_watermark.png"
        with open(synthid_file_path, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n" + b"X" * 100 + b"google synthid embedded watermark metadata signature" + b"Y" * 100)
        
        synthid_res = inspect_digital_deliverable_for_ai_watermark(synthid_file_path, "UI Screen", "UI Design")
        self.assertTrue(synthid_res["has_ai_watermark"])
        self.assertGreater(len(synthid_res["flags"]), 0)
        self.assertTrue(any("synthid" in f.lower() for f in synthid_res["flags"]))
        self.assertEqual(synthid_res["confidence"], 15)

        # 3. DALL-E watermark detection
        dalle_file_path = "/tmp/test_dalle_watermark.png"
        with open(dalle_file_path, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n" + b"DALL-E 3 generated asset prompt parameters" + b"\x00" * 50)
        
        dalle_res = inspect_digital_deliverable_for_ai_watermark(dalle_file_path, "UI Screen", "UI Design")
        self.assertTrue(dalle_res["has_ai_watermark"])
        self.assertTrue(any("dall-e" in f.lower() for f in dalle_res["flags"]))

        # 4. Midjourney / Stable Diffusion generation parameters detection
        sd_file_path = "/tmp/test_sd_watermark.png"
        with open(sd_file_path, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n" + b"parameters\x00Negative prompt: blurry\nSteps: 30, Sampler: DPM++ 2M, CFG scale: 7, Model: stablediffusion_xl")
        
        sd_res = inspect_digital_deliverable_for_ai_watermark(sd_file_path, "UI Screen", "UI Design")
        self.assertTrue(sd_res["has_ai_watermark"])
        self.assertTrue(any("stable diffusion" in f.lower() or "prompt parameters" in f.lower() for f in sd_res["flags"]))

    def test_03_digital_deliverable_upload_with_ai_watermark_is_flagged(self):
        """Uploading an image with AI watermark to a digital milestone triggers flagged state and locks payout."""
        watermarked_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4" + \
                          b"SynthID generative signature embedded deepmind_watermark" + \
                          b"\x00\x00\x00\nIDATx\x9cc`\x00\x00\x00\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82"
        
        files = {"file": ("ai_generated_mockup.png", watermarked_png, "image/png")}
        form_data = {
            "capture_method": "file_upload",
            "evidence_type": "milestone_evidence",
            "milestone_index": 0,
            "asset_url": "https://figma.com/file/test-ai-deliverable"
        }
        res = client.post(f"/api/projects/{self.digital_project_id}/evidence", data=form_data, files=files)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        
        # Verify status is flagged as possible_mismatch due to synthetic watermark
        self.assertEqual(data["status"], "possible_mismatch")
        self.assertLessEqual(data["ai_confidence_score"], 25)
        self.assertTrue(len(data.get("fraud_flags", [])) > 0)
        self.assertTrue(any("watermark" in f.lower() or "synthid" in f.lower() for f in data["fraud_flags"]))
        self.assertIn("HUMAN REVIEW REQUIRED (AI WATERMARK DETECTED)", data["ai_analysis_notes"])

    def test_04_digital_deliverable_resubmission_clean_is_verified(self):
        """Resubmitting clean authentic digital deliverable passes AI watermark scan and is verified."""
        clean_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x02\x00\x00\x00\x02\x08\x06\x00\x00\x00\x72\xb6\x0d\x24" + \
                    b"\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\x9d\xc9\x00\x00\x00\x00IEND\xaeB`\x82"
        
        files = {"file": ("authentic_ui_screens.png", clean_png, "image/png")}
        form_data = {
            "capture_method": "file_upload",
            "evidence_type": "milestone_evidence",
            "milestone_index": 0,
            "asset_url": "https://figma.com/file/authentic-artisan-design"
        }
        res = client.post(f"/api/projects/{self.digital_project_id}/evidence", data=form_data, files=files)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        
        # Verify status is verified with high confidence and no fraud flags
        self.assertEqual(data["status"], "verified")
        self.assertGreaterEqual(data["ai_confidence_score"], 90)
        self.assertEqual(len(data.get("fraud_flags", [])), 0)
        self.assertIn("AI Watermark Audit: PASSED", data["ai_analysis_notes"])

    def test_05_digital_deliverable_screen_reproduction_is_strictly_flagged(self):
        """Even for digital projects, photographing a phone or monitor screen MUST be flagged as spoofing."""
        sample_path = "backend/uploads/1ae6c10b-aef5-420c-9ca2-03f9bb009587_live_capture_1793562649806_angle1.jpg"
        if not os.path.exists(sample_path):
            sample_path = "uploads/1ae6c10b-aef5-420c-9ca2-03f9bb009587_live_capture_1793562649806_angle1.jpg"
        
        self.assertTrue(os.path.exists(sample_path), f"Sample file not found at {sample_path}")
        with open(sample_path, "rb") as f:
            phone_photo_bytes = f.read()

        # Create a new logo redesign digital project
        logo_proj = client.post("/api/projects/init", json={
            "title": "Logo redesign",
            "industry_type": "digital art",
            "description": "Brand logo vector refresh and visual identity guidelines.",
            "total_price": 300.0,
            "deadline": "2026-11-20",
            "buyer_email": "client.brand@example.com"
        }).json()
        p_id = logo_proj["project_id"]

        client.post(f"/api/projects/{p_id}/finalize-draft", json={
            "contract_terms": "Digital logo redesign agreement.",
            "evidence_requirements": "Presentation deck containing 3 unique vector logo concept boards.",
            "milestones": [
                {
                    "id": 1,
                    "title": "Creative Brief Alignment & Moodboard",
                    "description": "Initial concepts and vector sketches.",
                    "proof_required": "Presentation deck containing 3 unique vector logo concept boards.",
                    "price_allocation": 150.0,
                    "status": "pending"
                }
            ]
        })

        # Submit the photographed screen capture
        files = {"file": ("live_capture_screen.jpg", phone_photo_bytes, "image/jpeg")}
        form_data = {
            "capture_method": "file_upload",
            "evidence_type": "milestone_evidence",
            "milestone_index": 0
        }
        res = client.post(f"/api/projects/{p_id}/evidence", data=form_data, files=files)
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()

        # Strict Security Assertions: Screen re-photographs MUST NEVER PASS verification
        self.assertEqual(data["status"], "possible_mismatch")
        self.assertLessEqual(data["ai_confidence_score"], 20)
        self.assertIn("Moiré wavy distortion pattern detected (rainbow screen interference)", data["fraud_flags"])
        self.assertIn("Visible screen bezel / phone display frame detected", data["fraud_flags"])
        self.assertIn("SPOOFING & SCREEN RE-PHOTOGRAPH DETECTED", data["ai_analysis_notes"])
        self.assertIn("HOLD ESCROW RELEASE", data["ai_analysis_notes"])

    def test_06_reconcile_legacy_flagged_evidence(self):
        """Reconciliation utility updates existing erroneous verified records to possible_mismatch."""
        sample_path = "backend/uploads/1ae6c10b-aef5-420c-9ca2-03f9bb009587_live_capture_1793562649806_angle1.jpg"
        if not os.path.exists(sample_path):
            sample_path = "uploads/1ae6c10b-aef5-420c-9ca2-03f9bb009587_live_capture_1793562649806_angle1.jpg"
        
        with database.SessionLocal() as db:
            proj = db.query(models.Project).first()
            legacy_ev = models.Evidence(
                project_id=proj.id,
                uploader_id=1,
                capture_method="file_upload",
                evidence_type="milestone_evidence",
                milestone_index=0,
                file_path=f"/{sample_path.replace('backend/', '')}",
                file_hash="test_legacy_hash_spoof_reconcile",
                original_filename="screen_photo.jpg",
                mime_type="image/jpeg",
                file_size=1000,
                status=models.EvidenceStatus.VERIFIED,
                ai_confidence_score=96,
                fraud_flags=[]
            )
            db.add(legacy_ev)
            db.commit()
            db.refresh(legacy_ev)

            # Run reconciliation
            main.reconcile_evidence_record_if_flagged(legacy_ev, proj, db)
            db.refresh(legacy_ev)

            self.assertEqual(legacy_ev.status, models.EvidenceStatus.POSSIBLE_MISMATCH)
            self.assertEqual(legacy_ev.ai_confidence_score, 15)
            self.assertTrue(len(legacy_ev.fraud_flags) >= 2)
            self.assertIn("SPOOFING & SCREEN RE-PHOTOGRAPH DETECTED", legacy_ev.ai_analysis_notes)

            # Cleanup
            db.delete(legacy_ev)
            db.commit()

if __name__ == "__main__":
    unittest.main()
