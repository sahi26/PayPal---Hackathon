import os
import unittest
from unittest.mock import patch, AsyncMock
from datetime import datetime
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import auth_service
import database
import models
from main import app, get_db

SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

MOCK_AI_CLASSIFICATION = {
    "dispute_classification": "technical_defect",
    "validity_flag": "Requires expert review",
    "confidence_score": 85,
    "discrepancy_analysis": "Bevel measurements indicate tolerance discrepancy against Section 1.0 specifications.",
    "dossier_summary": "ProofLens Chronological Dossier: Classified as technical_defect with Requires expert review validity.",
    "evidence_audit_findings": "2 evidence submissions secured with SHA-256 cryptographic hashes.",
    "recommended_adjudication": "Hold escrow release pending resolution of expert inspection findings."
}

class TestDisputeWorkflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        models.Base.metadata.create_all(bind=engine)
        database.run_migrations(engine)

        def override_get_db():
            db = TestingSessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()

    def setUp(self):
        self.db = TestingSessionLocal()
        self.buyer = models.User(
            email="buyer_dispute_test@example.com",
            password_hash="secret123",
            full_name="Dispute Buyer",
            role_type="buyer"
        )
        self.seller = models.User(
            email="seller_dispute_test@example.com",
            password_hash="secret123",
            full_name="Dispute Seller",
            role_type="seller"
        )
        self.db.add_all([self.buyer, self.seller])
        self.db.commit()

        self.project = models.Project(
            title="Custom Hardwood Dining Table",
            description="Handcrafted walnut table 8x4 ft with precision joinery",
            industry_type="Carpentry & Furniture",
            total_price=500.0,
            status=models.ProjectStatus.ACTIVE,
            buyer_id=self.buyer.id,
            seller_id=self.seller.id,
            created_at=datetime.utcnow()
        )
        self.db.add(self.project)
        self.db.commit()

        self.agreement = models.Agreement(
            project_id=self.project.id,
            version=1,
            status="ACTIVE",
            ai_generated_contract="Section 1.0 Scope: Walnut table must have smooth finish, bevel tolerances +/- 0.1 inch.",
            milestones=[
                {"title": "Milling & Lumber Selection", "price_allocation": 200.0, "status": "approved"},
                {"title": "Tabletop Assembly & Joinery", "price_allocation": 300.0, "status": "pending"}
            ]
        )
        self.db.add(self.agreement)
        self.db.commit()

        self.ev1 = models.Evidence(
            project_id=self.project.id,
            evidence_type="before_evidence",
            file_hash="a1b2c3d4e5f600001111222233334444555566667777888899990000aaaabbbb",
            file_path="/uploads/rough_walnut.jpg",
            server_receipt_timestamp=datetime.utcnow(),
            status="verified"
        )
        self.ev2 = models.Evidence(
            project_id=self.project.id,
            evidence_type="milestone_evidence",
            milestone_index=0,
            file_hash="b2c3d4e5f6a100001111222233334444555566667777888899990000ccccdddd",
            file_path="/uploads/planed_boards.jpg",
            server_receipt_timestamp=datetime.utcnow(),
            status="verified"
        )
        self.db.add_all([self.ev1, self.ev2])
        self.db.commit()

    def tearDown(self):
        self.db.query(models.Dossier).delete()
        self.db.query(models.DisputeChatHistory).delete()
        self.db.query(models.DisputeRecord).delete()
        self.db.query(models.ScopeChangeRequest).delete()
        self.db.query(models.Payment).delete()
        self.db.query(models.Evidence).delete()
        self.db.query(models.Agreement).delete()
        self.db.query(models.Project).delete()
        self.db.query(models.User).delete()
        self.db.commit()
        self.db.close()

    def _buyer_headers(self):
        token = auth_service.create_access_token(self.buyer.id, self.buyer.email, self.buyer.role_type)
        return {"Authorization": f"Bearer {token}"}

    def test_01_models_and_enums_exist(self):
        """Phase 1: Test DisputeStatus enum and model table relationships."""
        self.assertEqual(models.DisputeStatus.INTERNAL_NEGOTIATION.value, "INTERNAL_NEGOTIATION")
        self.assertEqual(models.DisputeStatus.ESCALATED_PROGRAMMATIC.value, "ESCALATED_PROGRAMMATIC")
        self.assertEqual(models.DisputeStatus.ESCALATED_HUMAN.value, "ESCALATED_HUMAN")
        self.assertEqual(models.DisputeStatus.RESOLVED.value, "RESOLVED")

        # Test aliases
        self.assertIs(models.Dispute, models.DisputeRecord)
        self.assertIs(models.ChatHistory, models.DisputeChatHistory)

    def test_02_open_dispute_tier_1_locks_timeline(self):
        """Phase 2: Opening dispute initiates Tier 1, locks timeline, and seeds chat."""
        resp = self.client.post(
            f"/api/disputes/{self.project.id}/open",
            json={
                "reason": "Top surface has uneven bevel and does not meet agreed 0.1 inch tolerance",
                "disputed_by": "buyer"
            }
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "INTERNAL_NEGOTIATION")
        self.assertEqual(data["tier"], 1)

        # Check project timeline locked
        self.db.expire_all()
        updated_proj = self.db.query(models.Project).filter(models.Project.id == self.project.id).first()
        self.assertEqual(updated_proj.status, models.ProjectStatus.DISPUTED)

        # Check dispute chat history seeded
        chat_msgs = self.db.query(models.DisputeChatHistory).filter(
            models.DisputeChatHistory.dispute_id == data["dispute_id"]
        ).all()
        self.assertGreaterEqual(len(chat_msgs), 2)
        self.assertTrue(any("Dispute Opened" in m.message for m in chat_msgs))
        self.assertTrue(any("gemini-4-argon" in (m.sender_name or "") or "ProofLens AI" in (m.sender_name or "") for m in chat_msgs))

    def test_03_dispute_chat_and_remedy_proposals(self):
        """Phase 2: Internal negotiation chat allows exchanging messages and remedy proposals."""
        open_resp = self.client.post(
            f"/api/disputes/{self.project.id}/open",
            json={"reason": "Dimensions mismatch", "disputed_by": "buyer"}
        )
        dispute_id = open_resp.json()["dispute_id"]

        # Seller sends a message proposing remedy
        msg_resp = self.client.post(
            f"/api/disputes/{self.project.id}/messages",
            json={
                "sender_role": "seller",
                "sender_name": "ProofLens Contractor",
                "message": "I can re-sand the tabletop bevel within 2 business days. Please grant a schedule extension.",
                "proposal_type": "propose_remedy"
            }
        )
        self.assertEqual(msg_resp.status_code, 200)
        self.assertEqual(msg_resp.json()["chat_item"]["proposal_type"], "propose_remedy")

        # Query active dispute endpoint
        active_resp = self.client.get(f"/api/disputes/{self.project.id}/active")
        self.assertEqual(active_resp.status_code, 200)
        active_data = active_resp.json()
        self.assertTrue(active_data["active"])
        self.assertEqual(active_data["tier"], 1)
        self.assertGreaterEqual(len(active_data["chat_history"]), 3)

    @patch("main.classify_dispute_with_ai", return_value=MOCK_AI_CLASSIFICATION)
    @patch("paypal_service.provide_dispute_evidence", new_callable=AsyncMock)
    def test_04_escalate_to_programmatic_tier_2(self, mock_provide_evidence, mock_classify):
        """Phase 3: Escalate compiles authoritative Dossier and pushes to PayPal Disputes API."""
        mock_provide_evidence.return_value = {
            "dispute_id": f"PP-D-{self.project.id}-TEST",
            "status": "EVIDENCE_SUBMITTED",
            "paypal_response": {"status": "SUCCESS"}
        }

        self.client.post(
            f"/api/disputes/{self.project.id}/open",
            json={"reason": "Bevel tolerance exceeded", "disputed_by": "buyer"}
        )

        escalate_resp = self.client.post(
            f"/api/disputes/{self.project.id}/escalate",
            json={"notes": "Internal talks failed to agree on tolerances. Submitting cryptographic evidence."}
        )
        self.assertEqual(escalate_resp.status_code, 200)
        data = escalate_resp.json()

        self.assertEqual(data["status"], "ESCALATED_PROGRAMMATIC")
        self.assertEqual(data["tier"], 2)
        self.assertTrue(data["pushed_to_paypal"])
        self.assertIn("evidence_dossier", data)

        # Verify Dossier record in database
        self.db.expire_all()
        dossier = self.db.query(models.Dossier).filter(models.Dossier.project_id == self.project.id).first()
        self.assertIsNotNone(dossier)
        self.assertTrue(dossier.dossier_id.startswith(f"DOSSIER-{self.project.id}"))

        # Verify dispute record updated
        dispute = self.db.query(models.DisputeRecord).filter(models.DisputeRecord.project_id == self.project.id).first()
        self.assertEqual(dispute.status, models.DisputeStatus.ESCALATED_PROGRAMMATIC)
        self.assertTrue(dispute.pushed_to_paypal)

    @patch("main.classify_dispute_with_ai", return_value=MOCK_AI_CLASSIFICATION)
    @patch("paypal_service.provide_dispute_evidence", new_callable=AsyncMock)
    @patch("paypal_service.escalate_dispute_to_claim", new_callable=AsyncMock)
    def test_05_escalate_to_human_tier_3(self, mock_escalate_claim, mock_provide_evidence, mock_classify):
        """Phase 4: Escalate to Claim initiates PayPal 20-day manual human review cycle."""
        mock_provide_evidence.return_value = {"status": "EVIDENCE_SUBMITTED"}
        mock_escalate_claim.return_value = {
            "dispute_id": f"PP-D-{self.project.id}-TEST",
            "claim_id": "CLAIM-HUMAN-REVIEW-9988",
            "status": "ESCALATED_HUMAN",
            "adjudication_cycle_days": 20
        }

        self.client.post(
            f"/api/disputes/{self.project.id}/open",
            json={"reason": "Bevel tolerance exceeded", "disputed_by": "buyer"}
        )
        self.client.post(f"/api/disputes/{self.project.id}/escalate", json={})

        human_resp = self.client.post(
            f"/api/disputes/{self.project.id}/escalate-to-human",
            json={"note": "Programmatic evidence not mutually accepted. Escalating to human PayPal adjudicator."}
        )
        self.assertEqual(human_resp.status_code, 200)
        data = human_resp.json()

        self.assertEqual(data["status"], "ESCALATED_HUMAN")
        self.assertEqual(data["tier"], 3)
        self.assertEqual(data["adjudication_cycle_days"], 20)
        self.assertEqual(data["claim_id"], "CLAIM-HUMAN-REVIEW-9988")

        # Verify dispute updated
        self.db.expire_all()
        dispute = self.db.query(models.DisputeRecord).filter(models.DisputeRecord.project_id == self.project.id).first()
        self.assertEqual(dispute.status, models.DisputeStatus.ESCALATED_HUMAN)
        self.assertIsNotNone(dispute.escalated_to_human_at)
        self.assertEqual(dispute.paypal_claim_id, "CLAIM-HUMAN-REVIEW-9988")

    def test_06_mutual_resolution_unlocks_timeline(self):
        """Phase 2: Mutual settlement marks dispute RESOLVED and unlocks project milestone timeline."""
        self.client.post(
            f"/api/disputes/{self.project.id}/open",
            json={"reason": "Minor finish blemish", "disputed_by": "buyer"}
        )
        # Verify locked
        self.db.expire_all()
        p = self.db.query(models.Project).filter(models.Project.id == self.project.id).first()
        self.assertEqual(p.status, models.ProjectStatus.DISPUTED)

        # Resolve mutually
        res_resp = self.client.post(
            f"/api/disputes/{self.project.id}/resolve",
            json={
                "resolution_type": "MUTUAL_SETTLEMENT",
                "notes": "Contractor provided touch-up kit and buyer accepted."
            }
        )
        self.assertEqual(res_resp.status_code, 200)
        self.assertEqual(res_resp.json()["status"], "RESOLVED")
        self.assertEqual(res_resp.json()["project_status"], "active")

        # Verify project unlocked back to ACTIVE
        self.db.expire_all()
        p_refreshed = self.db.query(models.Project).filter(models.Project.id == self.project.id).first()
        self.assertEqual(p_refreshed.status, models.ProjectStatus.ACTIVE)

    @patch("paypal_service.authorize_order", new_callable=AsyncMock)
    @patch("paypal_service.create_order_for_authorize", new_callable=AsyncMock)
    def test_07_resolve_via_scope_change_integration(self, mock_create_order, mock_auth_order):
        """Phase 2: Executing a formal Scope Change automatically closes and resolves active dispute."""
        mock_create_order.return_value = {
            "id": "ORDER-ADDENDUM-DISPUTE-TEST",
            "status": "CREATED",
            "links": [{"rel": "approve", "href": "https://sandbox.paypal.com/checkout"}]
        }
        mock_auth_order.return_value = {
            "id": "AUTH-SCOPE-CHANGE-RESOLVE-123",
            "status": "COMPLETED"
        }

        self.client.post(
            f"/api/disputes/{self.project.id}/open",
            json={"reason": "Need walnut tabletop darkened with espresso stain", "disputed_by": "buyer"}
        )

        # Seed Scope Change Request in NEGOTIATING state
        sc = models.ScopeChangeRequest(
            project_id=self.project.id,
            requested_by_id=self.buyer.id,
            description="Apply double coat espresso stain and matte seal",
            proposed_extra_cost=45.0,
            proposed_extra_days=2,
            status=models.ScopeChangeStatus.NEGOTIATING.value,
            proposed_milestones=[
                {"title": "Staining & Sealing", "price_allocation": 45.0, "status": "pending"}
            ]
        )
        self.db.add(sc)
        self.db.commit()

        # Accept scope change (Seller perspective)
        accept_resp = self.client.post(
            f"/api/projects/{self.project.id}/scope-change/accept",
            json={"role": "seller", "scope_change_id": sc.id}
        )
        self.assertEqual(accept_resp.status_code, 200)

        # Confirm escrow authorization for the addendum
        confirm_resp = self.client.post(
            f"/api/projects/{self.project.id}/scope-change/authorize-funds",
            json={
                "scope_change_id": sc.id,
                "paypal_order_id": "ORDER-ADDENDUM-DISPUTE-TEST"
            }
        )
        self.assertEqual(confirm_resp.status_code, 200)

        # Verify dispute was automatically resolved via SCOPE_CHANGE
        self.db.expire_all()
        dispute = self.db.query(models.DisputeRecord).filter(models.DisputeRecord.project_id == self.project.id).first()
        self.assertEqual(dispute.status, models.DisputeStatus.RESOLVED)
        self.assertEqual(dispute.resolution_type, "SCOPE_CHANGE")

        # Verify project timeline unlocked
        proj = self.db.query(models.Project).filter(models.Project.id == self.project.id).first()
        self.assertEqual(proj.status, models.ProjectStatus.ACTIVE)

    @patch("main.classify_dispute_with_ai", return_value=MOCK_AI_CLASSIFICATION)
    @patch("paypal_service.provide_dispute_evidence", new_callable=AsyncMock)
    @patch("paypal_service.escalate_dispute_to_claim", new_callable=AsyncMock)
    def test_08_escalate_after_resolved_dispute_to_tier_2_and_tier_3(self, mock_escalate_claim, mock_provide_evidence, mock_classify):
        """Resolved dispute can still be escalated directly to Tier 2 (Dossier) and Tier 3 (Human Claim), re-locking payouts."""
        mock_provide_evidence.return_value = {
            "dispute_id": f"PP-D-{self.project.id}-TEST",
            "status": "EVIDENCE_SUBMITTED",
            "paypal_response": {"status": "SUCCESS"}
        }
        mock_escalate_claim.return_value = {
            "dispute_id": f"PP-D-{self.project.id}-TEST",
            "claim_id": "CLAIM-POST-RESOLVED-555",
            "status": "ESCALATED_HUMAN",
            "adjudication_cycle_days": 20
        }

        open_resp = self.client.post(
            f"/api/disputes/{self.project.id}/open",
            json={"reason": "Initial bevel finish mismatch", "disputed_by": "buyer"}
        )
        self.assertEqual(open_resp.status_code, 200)

        resolve_resp = self.client.post(
            f"/api/disputes/{self.project.id}/resolve",
            json={"resolution_type": "MUTUAL_SETTLEMENT", "notes": "Contractor promised touch-up."}
        )
        self.assertEqual(resolve_resp.status_code, 200)
        self.assertEqual(resolve_resp.json()["status"], "RESOLVED")

        active_after_resolve = self.client.get(f"/api/disputes/{self.project.id}/active")
        self.assertEqual(active_after_resolve.status_code, 200)
        self.assertFalse(active_after_resolve.json()["active"])
        self.assertEqual(active_after_resolve.json()["tier"], 4)

        # Escalate resolved dispute directly to Tier 2 (Programmatic Dossier)
        esc_t2 = self.client.post(
            f"/api/disputes/{self.project.id}/escalate",
            json={"notes": "Agreed touch-up was never delivered."}
        )
        self.assertEqual(esc_t2.status_code, 200)
        esc_t2_data = esc_t2.json()
        self.assertEqual(esc_t2_data["status"], "ESCALATED_PROGRAMMATIC")
        self.assertEqual(esc_t2_data["tier"], 2)

        self.db.expire_all()
        proj = self.db.query(models.Project).filter(models.Project.id == self.project.id).first()
        self.assertEqual(proj.status, models.ProjectStatus.DISPUTED)
        disp = self.db.query(models.DisputeRecord).filter(models.DisputeRecord.project_id == self.project.id).first()
        self.assertEqual(disp.status, models.DisputeStatus.ESCALATED_PROGRAMMATIC)
        self.assertIsNone(disp.resolution_type)
        self.assertIsNone(disp.resolution_notes)

        # Resolve again after Tier 2, then escalate directly from RESOLVED to Tier 3 (Human Claim)
        resolve_again = self.client.post(
            f"/api/disputes/{self.project.id}/resolve",
            json={"resolution_type": "MUTUAL_SETTLEMENT", "notes": "Second settlement attempt"}
        )
        self.assertEqual(resolve_again.status_code, 200)

        esc_t3 = self.client.post(
            f"/api/disputes/{self.project.id}/escalate-to-human",
            json={"note": "Escalating resolved case to PayPal human adjudication."}
        )
        self.assertEqual(esc_t3.status_code, 200)
        esc_t3_data = esc_t3.json()
        self.assertEqual(esc_t3_data["status"], "ESCALATED_HUMAN")
        self.assertEqual(esc_t3_data["tier"], 3)
        self.assertEqual(esc_t3_data["claim_id"], "CLAIM-POST-RESOLVED-555")

        self.db.expire_all()
        proj_t3 = self.db.query(models.Project).filter(models.Project.id == self.project.id).first()
        self.assertEqual(proj_t3.status, models.ProjectStatus.DISPUTED)
        disp_t3 = self.db.query(models.DisputeRecord).filter(models.DisputeRecord.project_id == self.project.id).first()
        self.assertEqual(disp_t3.status, models.DisputeStatus.ESCALATED_HUMAN)
        self.assertIsNone(disp_t3.resolution_type)
        self.assertIsNone(disp_t3.resolution_notes)

        active_after_t3 = self.client.get(f"/api/disputes/{self.project.id}/active")
        self.assertTrue(active_after_t3.json()["active"])
        self.assertEqual(active_after_t3.json()["tier"], 3)
        self.assertTrue(
            any("Previously resolved dispute" in m["message"] for m in active_after_t3.json()["chat_history"])
        )

    def test_09_open_new_tier_1_dispute_after_resolved_dispute(self):
        """After resolving a dispute, opening a follow-up Tier 1 dispute creates a fresh active dispute and re-locks payouts."""
        first_open = self.client.post(
            f"/api/disputes/{self.project.id}/open",
            json={"reason": "Initial finish issue", "disputed_by": "buyer"}
        )
        self.assertEqual(first_open.status_code, 200)
        first_id = first_open.json()["dispute_id"]

        resolve_resp = self.client.post(
            f"/api/disputes/{self.project.id}/resolve",
            json={"resolution_type": "MUTUAL_SETTLEMENT", "notes": "Resolved first issue."}
        )
        self.assertEqual(resolve_resp.status_code, 200)

        second_open = self.client.post(
            f"/api/disputes/{self.project.id}/open",
            json={"reason": "Follow-up escalation: joinery cracked after resolution", "disputed_by": "buyer"}
        )
        self.assertEqual(second_open.status_code, 200)
        second_data = second_open.json()
        self.assertNotEqual(second_data["dispute_id"], first_id)
        self.assertEqual(second_data["status"], "INTERNAL_NEGOTIATION")
        self.assertEqual(second_data["tier"], 1)
        self.assertEqual(second_data["project_status"], "disputed")

        active_resp = self.client.get(f"/api/disputes/{self.project.id}/active")
        self.assertEqual(active_resp.status_code, 200)
        active_data = active_resp.json()
        self.assertTrue(active_data["active"])
        self.assertEqual(active_data["tier"], 1)
        self.assertEqual(active_data["dispute"]["id"], second_data["dispute_id"])
        self.assertEqual(active_data["dispute"]["reason"], "Follow-up escalation: joinery cracked after resolution")

        self.db.expire_all()
        first_record = self.db.query(models.DisputeRecord).filter(models.DisputeRecord.id == first_id).first()
        self.assertEqual(first_record.status, models.DisputeStatus.RESOLVED)

    @patch("main.classify_dispute_with_ai", return_value=MOCK_AI_CLASSIFICATION)
    def test_10_generate_dossier_in_tier_1_without_escalating(self, mock_classify):
        """In non-test mode, buyers/sellers can compile the Forensic Evidence Dossier Report on demand in Tier 1."""
        headers = self._buyer_headers()
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            open_resp = self.client.post(
                f"/api/disputes/{self.project.id}/open",
                json={"reason": "Corner joinery gap", "disputed_by": "buyer"},
                headers=headers,
            )
            self.assertEqual(open_resp.status_code, 200)

            gen_resp = self.client.post(
                f"/api/disputes/{self.project.id}/dossier/generate",
                json={},
                headers=headers,
            )
            self.assertEqual(gen_resp.status_code, 200, gen_resp.text)
            body = gen_resp.json()
            self.assertIn("dossier", body)
            self.assertEqual(body["dossier"]["paypal_sync_status"], "PROOFLENS_INTERNAL_READY")

            active_resp = self.client.get(f"/api/disputes/{self.project.id}/active", headers=headers)
            self.assertEqual(active_resp.status_code, 200)
            self.assertEqual(active_resp.json()["tier"], 1)
            self.assertTrue(active_resp.json()["dispute"]["has_dossier"])
            self.assertFalse(active_resp.json()["project"]["has_captured_payment"])

    @patch("main.classify_dispute_with_ai", return_value=MOCK_AI_CLASSIFICATION)
    def test_11_escalate_tier_2_and_tier_3_without_webhook_in_dev_env(self, mock_classify):
        """Non-test env must not fail with 409 when escalating to Tier 2 or Tier 3 without a PayPal webhook."""
        headers = self._buyer_headers()
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            self.client.post(
                f"/api/disputes/{self.project.id}/open",
                json={"reason": "Bevel out of tolerance", "disputed_by": "buyer"},
                headers=headers,
            )

            esc2 = self.client.post(
                f"/api/disputes/{self.project.id}/escalate",
                json={"notes": "Need forensic dossier report"},
                headers=headers,
            )
            self.assertEqual(esc2.status_code, 200, esc2.text)
            esc2_data = esc2.json()
            self.assertEqual(esc2_data["status"], "ESCALATED_PROGRAMMATIC")
            self.assertEqual(esc2_data["tier"], 2)
            self.assertFalse(esc2_data["pushed_to_paypal"])
            self.assertIsNone(esc2_data["paypal_dispute_id"])
            self.assertIn("evidence_dossier", esc2_data)
            self.assertEqual(esc2_data["evidence_dossier"]["paypal_sync_status"], "PROOFLENS_INTERNAL_READY")

            esc3 = self.client.post(
                f"/api/disputes/{self.project.id}/escalate-to-human",
                json={"note": "Request human review hold"},
                headers=headers,
            )
            self.assertEqual(esc3.status_code, 200, esc3.text)
            esc3_data = esc3.json()
            self.assertEqual(esc3_data["status"], "ESCALATED_HUMAN")
            self.assertEqual(esc3_data["tier"], 3)
            self.assertFalse(esc3_data["escalated_at_paypal"])
            self.assertIsNone(esc3_data["claim_id"])

    @patch("main.classify_dispute_with_ai", return_value=MOCK_AI_CLASSIFICATION)
    @patch("paypal_service.provide_dispute_evidence", new_callable=AsyncMock)
    @patch("paypal_service.list_disputes", new_callable=AsyncMock)
    def test_12_auto_discover_paypal_dispute_via_list_disputes(
        self, mock_list_disputes, mock_provide_evidence, mock_classify
    ):
        """Escalating in dev/sandbox discovers matching PayPal disputes from captured transactions automatically."""
        self.db.add(models.Payment(
            project_id=self.project.id,
            amount=200.0,
            capture_id="CAP-XYZ-999",
            authorization_id="AUTH-XYZ-111",
            status=models.PaymentStatus.CAPTURED,
        ))
        self.db.commit()

        mock_list_disputes.return_value = [
            {
                "dispute_id": "PP-D-REAL-777",
                "status": "OPEN",
                "disputed_transactions": [{"seller_transaction_id": "CAP-XYZ-999"}],
            }
        ]
        mock_provide_evidence.return_value = {"dispute_id": "PP-D-REAL-777", "status": "EVIDENCE_SUBMITTED"}

        headers = self._buyer_headers()
        with patch.dict(os.environ, {"APP_ENV": "development"}), \
             patch("paypal_service.PAYPAL_CLIENT_ID", "sandbox-client"), \
             patch("paypal_service.PAYPAL_CLIENT_SECRET", "sandbox-secret"):
            self.client.post(
                f"/api/disputes/{self.project.id}/open",
                json={"reason": "Captured milestone defect", "disputed_by": "buyer"},
                headers=headers,
            )
            esc = self.client.post(
                f"/api/disputes/{self.project.id}/escalate",
                json={},
                headers=headers,
            )
            self.assertEqual(esc.status_code, 200, esc.text)
            data = esc.json()
            self.assertEqual(data["paypal_dispute_id"], "PP-D-REAL-777")
            self.assertTrue(data["pushed_to_paypal"])
            self.assertEqual(data["sync_source"], "auto_discovered")
            mock_provide_evidence.assert_awaited()

    @patch("main.classify_dispute_with_ai", return_value=MOCK_AI_CLASSIFICATION)
    @patch("paypal_service.provide_dispute_evidence", new_callable=AsyncMock)
    @patch("paypal_service.get_dispute_details", new_callable=AsyncMock)
    def test_13_sync_paypal_explicit_links_and_pushes_existing_tier_2_dossier(
        self, mock_get_details, mock_provide_evidence, mock_classify
    ):
        """Linking a real PayPal Case ID via /sync-paypal pushes an existing Tier 2 dossier to PayPal."""
        mock_get_details.return_value = {"dispute_id": "PP-D-SYNC-888", "status": "WAITING_FOR_SELLER_RESPONSE"}
        mock_provide_evidence.return_value = {"dispute_id": "PP-D-SYNC-888", "status": "EVIDENCE_SUBMITTED"}

        headers = self._buyer_headers()
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            self.client.post(
                f"/api/disputes/{self.project.id}/open",
                json={"reason": "Joinery cracked", "disputed_by": "buyer"},
                headers=headers,
            )
            esc = self.client.post(
                f"/api/disputes/{self.project.id}/escalate",
                json={},
                headers=headers,
            )
            self.assertEqual(esc.status_code, 200)
            self.assertFalse(esc.json()["pushed_to_paypal"])

            sync_resp = self.client.post(
                f"/api/disputes/{self.project.id}/sync-paypal",
                json={"paypal_dispute_id": "PP-D-SYNC-888"},
                headers=headers,
            )
            self.assertEqual(sync_resp.status_code, 200, sync_resp.text)
            sync_data = sync_resp.json()
            self.assertTrue(sync_data["synced"])
            self.assertEqual(sync_data["paypal_dispute_id"], "PP-D-SYNC-888")
            self.assertTrue(sync_data["pushed_to_paypal"])
            mock_provide_evidence.assert_awaited()

    @patch("main.classify_dispute_with_ai", return_value=MOCK_AI_CLASSIFICATION)
    @patch("paypal_service.provide_dispute_evidence", new_callable=AsyncMock)
    def test_14_synthetic_placeholder_id_stripped_in_non_test_mode(self, mock_provide_evidence, mock_classify):
        """Legacy synthetic PP-D-{id}-XXXXXX IDs are never sent to PayPal API or returned in non-test env."""
        synth_id = f"PP-D-{self.project.id}-A1B2C3"
        disp = models.DisputeRecord(
            project_id=self.project.id,
            dispute_id=synth_id,
            reason="Legacy placeholder record",
            disputed_by="buyer",
            status=models.DisputeStatus.INTERNAL_NEGOTIATION,
        )
        self.db.add(disp)
        self.db.commit()

        headers = self._buyer_headers()
        with patch.dict(os.environ, {"APP_ENV": "development"}):
            active = self.client.get(f"/api/disputes/{self.project.id}/active", headers=headers)
            self.assertEqual(active.status_code, 200)
            self.assertIsNone(active.json()["dispute"]["dispute_id"])

            bad_sync = self.client.post(
                f"/api/disputes/{self.project.id}/sync-paypal",
                json={"paypal_dispute_id": synth_id},
                headers=headers,
            )
            self.assertEqual(bad_sync.status_code, 400)

            esc = self.client.post(
                f"/api/disputes/{self.project.id}/escalate",
                json={},
                headers=headers,
            )
            self.assertEqual(esc.status_code, 200)
            self.assertIsNone(esc.json()["paypal_dispute_id"])
            self.assertFalse(esc.json()["pushed_to_paypal"])
            mock_provide_evidence.assert_not_awaited()

if __name__ == "__main__":
    unittest.main()
