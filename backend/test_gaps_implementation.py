import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch, AsyncMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

import database
import models
import main

# Test database
TEST_DB_URL = "sqlite:///./test_gaps.db"
test_engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

def override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()

main.app.dependency_overrides[database.get_db] = override_get_db
main.SessionLocal = TestSessionLocal
client = TestClient(main.app)

MOCK_AI_CLASSIFICATION = {
    "dispute_classification": "technical_defect",
    "validity_flag": "Requires expert review",
    "confidence_score": 85,
    "discrepancy_analysis": "Bevel measurements indicate tolerance discrepancy against specifications.",
    "dossier_summary": "ProofLens Chronological Dossier: Classified as technical_defect with Requires expert review validity.",
    "evidence_audit_findings": "2 evidence submissions secured with SHA-256 cryptographic hashes.",
    "recommended_adjudication": "Hold escrow release pending resolution of expert inspection findings."
}

class TestGapsImplementation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        models.Base.metadata.create_all(bind=test_engine)

    @classmethod
    def tearDownClass(cls):
        models.Base.metadata.drop_all(bind=test_engine)
        if os.path.exists("./test_gaps.db"):
            os.remove("./test_gaps.db")

    def setUp(self):
        self.db = TestSessionLocal()
        # Clean tables
        self.db.query(models.DisputeChatHistory).delete()
        self.db.query(models.Dossier).delete()
        self.db.query(models.DisputeRecord).delete()
        self.db.query(models.Evidence).delete()
        self.db.query(models.Payment).delete()
        self.db.query(models.Agreement).delete()
        self.db.query(models.Notification).delete()
        self.db.query(models.Project).delete()
        self.db.query(models.User).delete()
        self.db.commit()

        # Seed buyer and contractor
        self.buyer = models.User(email="buyer@test.com", password_hash="pw", full_name="Buyer", role_type="buyer")
        self.seller = models.User(email="seller@test.com", password_hash="pw", full_name="Seller", role_type="seller")
        self.db.add_all([self.buyer, self.seller])
        self.db.commit()
        self.db.refresh(self.buyer)
        self.db.refresh(self.seller)

    def tearDown(self):
        self.db.close()

    # =========================================================================
    # GAP 1: "Ghosting Seller" Inactivity Timeout Rule & Unilateral Void Override
    # =========================================================================

    def test_ghosting_seller_unilateral_void(self):
        """
        Verify that:
        1. When contractor is active within 48h, buyer CANNOT unilaterally void without seller consent.
        2. When contractor is inactive for >48h, buyer CAN unilaterally void the authorization hold.
        3. void_escrow_status becomes 'VOIDED_GHOSTING_TIMEOUT' and remaining funds are tracked.
        """
        # Active project with seller assigned
        project = models.Project(
            title="Custom Hardwood Table",
            industry_type="Carpentry",
            total_price=500.0,
            status=models.ProjectStatus.ACTIVE,
            buyer_id=self.buyer.id,
            seller_id=self.seller.id,
            captured_amount=150.0,
            void_escrow_status="NONE",
            created_at=datetime.utcnow() - timedelta(hours=10) # 10h ago (<48h)
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        payment = models.Payment(
            project_id=project.id,
            amount=500.0,
            currency="USD",
            status=models.PaymentStatus.PARTIALLY_CAPTURED,
            authorization_id="AUTH-TEST-GHOST-1"
        )
        self.db.add(payment)
        self.db.commit()

        # 1. Attempt unilateral void within 48h -> Should be blocked (400)
        res_blocked = client.post(f"/api/escrow/{project.id}/void", json={"note": "I want to cancel"})
        self.assertEqual(res_blocked.status_code, 400)
        self.assertIn("Mutual consent required", res_blocked.json()["detail"])

        # 2. Simulate contractor inactivity: project created 60 hours ago with 0 contractor activity
        project.created_at = datetime.utcnow() - timedelta(hours=60)
        self.db.commit()

        # Verify ghosting check directly
        is_ghosting, reason = main.check_contractor_ghosting(project, self.db)
        self.assertTrue(is_ghosting)
        self.assertIn("48h", reason)

        # 3. Buyer executes unilateral void -> Should succeed
        with patch("paypal_service.void_authorization", new_callable=AsyncMock) as mock_void:
            mock_void.return_value = {"status": "VOIDED", "id": "AUTH-TEST-GHOST-1"}
            res_void = client.post(f"/api/escrow/{project.id}/void", json={"note": "Contractor vanished"})
            self.assertEqual(res_void.status_code, 200)

        # 4. Verify DB state
        self.db.refresh(project)
        self.assertEqual(project.void_escrow_status, "VOIDED_GHOSTING_TIMEOUT")
        self.assertEqual(project.voided_amount, 350.0) # 500 - 150 captured
        self.assertEqual(project.status, models.ProjectStatus.PARTIALLY_COMPLETED_CANCELED)

    # =========================================================================
    # GAP 2: Automated 20-Day Tier 1 Expiration Scheduler
    # =========================================================================

    @patch("main.classify_dispute_with_ai", return_value=MOCK_AI_CLASSIFICATION)
    def test_auto_escalate_matured_tier1_disputes(self, mock_classify):
        """
        Verify that disputes in INTERNAL_NEGOTIATION sitting for > 20 days:
        1. Are picked up by auto_escalate_matured_tier1_disputes.
        2. Compile the ProofLens Dossier.
        3. Push evidence to PayPal Disputes API.
        4. Promote dispute status to ESCALATED_PROGRAMMATIC (Tier 2).
        5. Log audit trail message in DisputeChatHistory.
        """
        project = models.Project(
            title="Mobile Application UI",
            industry_type="Software",
            total_price=1000.0,
            status=models.ProjectStatus.ACTIVE,
            buyer_id=self.buyer.id,
            seller_id=self.seller.id
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        # Create agreement and milestone
        agreement = models.Agreement(
            project_id=project.id,
            milestones=[{"title": "M1 Screens", "price_allocation": 500, "status": "approved"}],
            status="ACTIVE"
        )
        self.db.add(agreement)
        self.db.commit()

        # Dispute created 22 days ago in Tier 1: INTERNAL_NEGOTIATION
        old_dispute = models.DisputeRecord(
            project_id=project.id,
            dispute_id="PP-D-MATURED-999",
            reason="Unresolved scope disagreement over responsiveness",
            disputed_by="buyer",
            status=models.DisputeStatus.INTERNAL_NEGOTIATION,
            created_at=datetime.utcnow() - timedelta(days=22)
        )
        self.db.add(old_dispute)
        self.db.commit()

        with patch("paypal_service.provide_dispute_evidence", new_callable=AsyncMock) as mock_paypal_evidence:
            mock_paypal_evidence.return_value = {"status": "EVIDENCE_SUBMITTED", "dispute_id": "PP-D-MATURED-999"}
            
            # Trigger scheduler endpoint
            res = client.post("/api/disputes/process-matured?max_days=20")
            self.assertEqual(res.status_code, 200)
            data = res.json()
            self.assertEqual(data["status"], "success")
            self.assertEqual(data["processed_count"], 1)

        # Verify DB updates
        self.db.refresh(old_dispute)
        self.assertEqual(old_dispute.status, models.DisputeStatus.ESCALATED_PROGRAMMATIC)
        self.assertTrue(old_dispute.pushed_to_paypal)
        self.assertIsNotNone(old_dispute.compiled_dossier)

        # Verify audit chat message
        audit_log = self.db.query(models.DisputeChatHistory).filter(
            models.DisputeChatHistory.dispute_id == old_dispute.id
        ).first()
        self.assertIsNotNone(audit_log)
        self.assertIn("20-day internal negotiation window", audit_log.message)

    # =========================================================================
    # GAP 3: Inbound PayPal Webhook Synchronizer for Claims & Disputes
    # =========================================================================

    def test_inbound_paypal_webhooks(self):
        """
        Verify that inbound PayPal webhooks correctly trigger state transitions:
        1. CUSTOMER.DISPUTE.CREATED -> Creates dispute, pauses project (DISPUTED).
        2. CUSTOMER.DISPUTE.UPDATED (stage CLAIM) -> Escalates to Tier 3 human review (ESCALATED_HUMAN).
        3. CUSTOMER.DISPUTE.RESOLVED -> Resolves dispute and unlocks project (ACTIVE).
        4. PAYMENT.AUTHORIZATION.VOIDED -> Marks payment VOIDED and project CANCELLED.
        """
        project = models.Project(
            title="E-Commerce API Integration",
            industry_type="Software",
            total_price=600.0,
            status=models.ProjectStatus.ACTIVE,
            buyer_id=self.buyer.id,
            seller_id=self.seller.id,
            captured_amount=200.0
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        payment = models.Payment(
            project_id=project.id,
            amount=600.0,
            currency="USD",
            status=models.PaymentStatus.PARTIALLY_CAPTURED,
            authorization_id="AUTH-WEBHOOK-TEST"
        )
        self.db.add(payment)
        self.db.commit()

        # 1. Event: CUSTOMER.DISPUTE.CREATED
        dispute_created_event = {
            "event_type": "CUSTOMER.DISPUTE.CREATED",
            "resource": {
                "dispute_id": "PP-D-WEBHOOK-123",
                "custom_id": f"project_{project.id}",
                "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED"
            }
        }
        res_created = client.post("/api/paypal/webhook/simulate", json=dispute_created_event)
        self.assertEqual(res_created.status_code, 200)

        self.db.refresh(project)
        self.assertEqual(project.status, models.ProjectStatus.DISPUTED)

        disp = self.db.query(models.DisputeRecord).filter(
            models.DisputeRecord.project_id == project.id
        ).first()
        self.assertIsNotNone(disp)
        self.assertEqual(disp.dispute_id, "PP-D-WEBHOOK-123")
        self.assertEqual(disp.status, models.DisputeStatus.INTERNAL_NEGOTIATION)

        # 2. Event: CUSTOMER.DISPUTE.UPDATED (Escalated to Claim)
        claim_event = {
            "event_type": "CUSTOMER.DISPUTE.UPDATED",
            "resource": {
                "dispute_id": "PP-D-WEBHOOK-123",
                "custom_id": f"project_{project.id}",
                "dispute_life_cycle_stage": "CLAIM"
            }
        }
        res_claim = client.post("/api/paypal/webhook/simulate", json=claim_event)
        self.assertEqual(res_claim.status_code, 200)

        self.db.refresh(disp)
        self.assertEqual(disp.status, models.DisputeStatus.ESCALATED_HUMAN)

        # 3. Event: CUSTOMER.DISPUTE.RESOLVED
        resolved_event = {
            "event_type": "CUSTOMER.DISPUTE.RESOLVED",
            "resource": {
                "dispute_id": "PP-D-WEBHOOK-123",
                "custom_id": f"project_{project.id}",
                "dispute_outcome": {
                    "outcome_code": "RESOLVED_SELLER_FAVOUR"
                }
            }
        }
        res_resolved = client.post("/api/paypal/webhook/simulate", json=resolved_event)
        self.assertEqual(res_resolved.status_code, 200)

        self.db.refresh(disp)
        self.assertEqual(disp.status, models.DisputeStatus.RESOLVED)
        self.assertEqual(disp.resolution_type, "RESOLVED_SELLER_FAVOUR")

        self.db.refresh(project)
        self.assertEqual(project.status, models.ProjectStatus.ACTIVE)

        # 4. Event: PAYMENT.AUTHORIZATION.VOIDED
        void_event = {
            "event_type": "PAYMENT.AUTHORIZATION.VOIDED",
            "resource": {
                "id": "AUTH-WEBHOOK-TEST"
            }
        }
        res_void = client.post("/api/paypal/webhook/simulate", json=void_event)
        self.assertEqual(res_void.status_code, 200)

        self.db.refresh(payment)
        self.assertEqual(payment.status, models.PaymentStatus.VOIDED)

        self.db.refresh(project)
        self.assertEqual(project.voided_amount, 400.0) # 600 - 200 captured
        self.assertEqual(project.status, models.ProjectStatus.PARTIALLY_COMPLETED_CANCELED)

if __name__ == "__main__":
    unittest.main()
