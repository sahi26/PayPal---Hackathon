import os
import sys
import io
import tempfile
if hasattr(sys.stdout, "encoding") and sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass
import unittest
from unittest.mock import MagicMock, patch
import json

try:
    import ai_service
    import main as main_mod
except ImportError:
    import backend.ai_service as ai_service
    import backend.main as main_mod

class TestAIModelUpgrade(unittest.TestCase):
    def test_model_constants(self):
        # Verify primary and fallback models
        self.assertEqual(ai_service.PRIMARY_GEMINI_MODEL, "gemini-4-argon")
        self.assertEqual(ai_service.FALLBACK_GEMINI_MODEL, "gemini-3.8-flash")
        self.assertEqual(ai_service.DEFAULT_GEMINI_MODELS[:2], ["gemini-4-argon", "gemini-3.8-flash"])
        self.assertEqual(ai_service.get_candidate_models()[:2], ["gemini-4-argon", "gemini-3.8-flash"])

        self.assertEqual(main_mod.PRIMARY_GEMINI_MODEL, "gemini-4-argon")
        self.assertEqual(main_mod.FALLBACK_GEMINI_MODEL, "gemini-3.8-flash")
        self.assertEqual(main_mod.DEFAULT_GEMINI_MODELS[:2], ["gemini-4-argon", "gemini-3.8-flash"])
        self.assertEqual(main_mod.get_candidate_models()[:2], ["gemini-4-argon", "gemini-3.8-flash"])

    def test_no_outdated_models_in_constants(self):
        outdated = ["gemini-1.5-flash", "gemini-1.5-flash-8b", "gemini-1.5-pro", "gemini-2.0-flash"]
        for old in outdated:
            self.assertNotIn(old, ai_service.DEFAULT_GEMINI_MODELS)
            self.assertNotIn(old, main_mod.DEFAULT_GEMINI_MODELS)

    @patch.dict(os.environ, {"GEMINI_API_KEY": "fake_key_for_test"})
    @patch("google.generativeai.GenerativeModel")
    def test_interactive_draft_uses_gemini_4_argon(self, mock_gen_model_cls):
        mock_instance = MagicMock()
        mock_response = MagicMock()
        mock_response.text = json.dumps({
            "ai_response": "What is the expected resolution?",
            "project_domain": "digital",
            "is_renovation": True,
            "ready_to_finalize": False,
            "milestones": []
        })
        mock_instance.generate_content.return_value = mock_response
        mock_gen_model_cls.return_value = mock_instance

        project = MagicMock()
        project.title = "Website Redesign"
        project.industry_type = "web development"
        project.total_price = 1000.0
        project.deadline = "2026-12-01"
        project.description = "Full overhaul"
        project.created_at = None

        result = ai_service.generate_interactive_draft(
            project=project,
            messages=[],
            new_message="Need it responsive"
        )

        # Verify GenerativeModel was called with gemini-4-argon as primary
        mock_gen_model_cls.assert_called_with(
            model_name="gemini-4-argon",
            generation_config={"response_mime_type": "application/json"}
        )
        self.assertIn("ai_response", result)

    @patch.dict(os.environ, {"GEMINI_API_KEY": "fake_key_for_test"})
    @patch("google.generativeai.GenerativeModel")
    def test_anti_spoofing_passes_bytes_and_gemini_4_argon(self, mock_gen_model_cls):
        mock_instance = MagicMock()
        mock_response = MagicMock()
        mock_response.text = json.dumps({
            "matches_requirement": True,
            "confidence_score": 98,
            "fraud_flags": [],
            "notes": "Genuine physical surface verified without screen reflections or Moire patterns.",
            "scope_compliance": "Completed as per specification.",
            "before_comparison": "Clear progression from baseline.",
            "recommendation": "Release funds"
        })
        mock_instance.generate_content.return_value = mock_response
        mock_gen_model_cls.return_value = mock_instance

        project = MagicMock()
        project.title = "Custom Oak Table"
        project.industry_type = "carpentry"
        project.description = "Oak dining table"

        milestone = {
            "title": "Surface Sanding",
            "description": "Progressive sanding up to 220 grit",
            "proof_required": "High-def photo showing surface finish"
        }

        # Create temporary dummy image file
        test_img_path = os.path.join(tempfile.gettempdir(), "test_milestone_img.jpg")
        with open(test_img_path, "wb") as f:
            f.write(b"\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xFF\xDB\x00C\x00")

        try:
            res = main_mod.run_ai_evidence_comparison(
                project=project,
                milestone=milestone,
                milestone_index=0,
                milestone_file_path=test_img_path,
                before_evidence_item=None
            )
            # Verify primary model call
            mock_gen_model_cls.assert_called_with(
                model_name="gemini-4-argon",
                generation_config={"response_mime_type": "application/json"}
            )
            # Verify contents passed to generate_content include prompt and image bytes
            contents = mock_instance.generate_content.call_args[0][0]
            self.assertIn("Moiré patterns", contents[0])
            self.assertEqual(contents[1]["mime_type"], "image/jpeg")
            self.assertTrue(len(contents[1]["data"]) > 0)
            self.assertEqual(res["status"], "verified")
            self.assertEqual(res["confidence_score"], 98)
        finally:
            if os.path.exists(test_img_path):
                os.remove(test_img_path)

    def test_moire_reflection_and_scope_mismatch_detection(self):
        # Test real computer vision spoofing detection on screen photo with moire reflection
        project = MagicMock()
        project.title = "custom oak dining table"
        project.industry_type = "carpentry"
        project.description = "Custom oak dining table fabricated from lumber stock"

        milestone = {
            "title": "White Oak Lumber Selection & Dimensioning",
            "description": "Select oak lumber boards and perform test mortise/tenon joinery",
            "proof_required": "Photos of dimensioned timber boards and test mortise/tenon joinery with digital scale check."
        }

        # Inspect the crop with moire and bezel reflections
        crop_path = os.path.join(tempfile.gettempdir(), "evidence_crop.bmp")
        if os.path.exists(crop_path):
            res = main_mod.run_ai_evidence_comparison(
                project=project,
                milestone=milestone,
                milestone_index=0,
                milestone_file_path=crop_path,
                before_evidence_item=None
            )
            self.assertEqual(res["status"], "possible_mismatch")
            self.assertLessEqual(res["confidence_score"], 25)
            self.assertTrue(len(res["fraud_flags"]) > 0)
            self.assertTrue(any("Moiré" in f or "bezel" in f for f in res["fraud_flags"]))
            self.assertIn("Anti-Spoofing Audit: FAILED", res["analysis_notes"])
            self.assertIn("HOLD ESCROW RELEASE", res["analysis_notes"])

if __name__ == "__main__":
    unittest.main()
