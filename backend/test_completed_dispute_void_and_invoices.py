import asyncio
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import database
import models
from main import app, get_db, process_matured_warranty_payouts


SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class TestCompletedDisputeVoidAndInvoices(unittest.TestCase):
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
        self.db.query(models.DisputeChatHistory).delete()
        self.db.query(models.DisputeRecord).delete()
        self.db.query(models.Invoice).delete()
        self.db.query(models.Notification).delete()
        self.db.query(models.Evidence).delete()
        self.db.query(models.Payment).delete()
        self.db.query(models.Agreement).delete()
        self.db.query(models.Project).delete()
        self.db.query(models.User).delete()
        self.db.commit()

        self.buyer = models.User(
            email="buyer_completed_suite@example.com",
            password_hash="hash",
            full_name="Completed Buyer",
            role_type="buyer",
        )
        self.seller = models.User(
            email="seller_completed_suite@example.com",
            password_hash="hash",
            full_name="Completed Seller",
            role_type="seller",
        )
        self.db.add_all([self.buyer, self.seller])
        self.db.commit()
        self.db.refresh(self.buyer)
        self.db.refresh(self.seller)

    def tearDown(self):
        self.db.close()

    def _create_project(
        self,
        *,
        status=models.ProjectStatus.COMPLETED,
        agreement_status="COMPLETED",
        total_price=300.0,
        captured_amount=300.0,
        milestones=None,
        lock_in_type="NONE",
        lock_in_amount=0.0,
        warranty_days=0,
        warranty_end_date=None,
        warranty_payout_status=None,
    ):
        if milestones is None:
            milestones = [
                {
                    "id": "m1",
                    "title": "Design Concept",
                    "description": "Concept phase",
                    "price_allocation": 150.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-M1-001",
                },
                {
                    "id": "m2",
                    "title": "Final Delivery",
                    "description": "Final files",
                    "price_allocation": 150.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-M2-002",
                },
            ]

        project = models.Project(
            title="Brand Logo & Identity Suite",
            industry_type="Digital Art",
            description="Complete vector identity system",
            total_price=total_price,
            captured_amount=captured_amount,
            voided_amount=0.0,
            status=status,
            buyer_id=self.buyer.id,
            seller_id=self.seller.id,
            void_escrow_status="SELLER_AGREED",
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        agreement = models.Agreement(
            project_id=project.id,
            version=1,
            status=agreement_status,
            milestones=milestones,
            lock_in_type=lock_in_type,
            lock_in_amount=lock_in_amount,
            lock_in_days=warranty_days,
            warranty_days=warranty_days,
            warranty_end_date=warranty_end_date,
            warranty_payout_status=warranty_payout_status,
        )
        self.db.add(agreement)
        self.db.commit()
        self.db.refresh(agreement)
        return project, agreement

    def test_completed_and_captured_project_rejects_void_and_cancel(self):
        project, _ = self._create_project(
            status=models.ProjectStatus.COMPLETED,
            agreement_status="COMPLETED",
            total_price=300.0,
            captured_amount=300.0,
        )
        payment = models.Payment(
            project_id=project.id,
            paypal_order_id="ORDER-DONE-1",
            authorization_id="AUTH-DONE-1",
            amount=300.0,
            currency="USD",
            status=models.PaymentStatus.CAPTURED,
            capture_id="CAP-M2-002",
        )
        self.db.add(payment)
        self.db.commit()

        res_req = self.client.post(f"/api/escrow/{project.id}/void-request", json={"reason": "Too late"})
        self.assertEqual(res_req.status_code, 400)
        self.assertIn("completed and captured", res_req.json()["detail"].lower())

        res_resp = self.client.post(
            f"/api/escrow/{project.id}/void-request/respond",
            json={"agree": True, "note": "Agree"},
        )
        self.assertEqual(res_resp.status_code, 400)
        self.assertIn("completed and captured", res_resp.json()["detail"].lower())

        res_void = self.client.post(f"/api/escrow/{project.id}/void", json={"note": "Cancel completed"})
        self.assertEqual(res_void.status_code, 400)
        self.assertIn("completed and captured", res_void.json()["detail"].lower())

        res_cancel = self.client.post(f"/api/projects/{project.id}/cancel", json={"note": "Cancel completed"})
        self.assertEqual(res_cancel.status_code, 400)
        self.assertIn("completed and captured", res_cancel.json()["detail"].lower())

    def test_cancelled_project_rejects_void_and_cancel(self):
        project, _ = self._create_project(
            status=models.ProjectStatus.PARTIALLY_COMPLETED_CANCELED,
            agreement_status="CANCELLED",
            total_price=300.0,
            captured_amount=150.0,
        )

        res_req = self.client.post(f"/api/escrow/{project.id}/void-request", json={"reason": "Retry"})
        self.assertEqual(res_req.status_code, 400)
        self.assertIn("cancelled", res_req.json()["detail"].lower())

        res_cancel = self.client.post(f"/api/projects/{project.id}/cancel", json={"note": "Retry"})
        self.assertEqual(res_cancel.status_code, 400)
        self.assertIn("cancelled", res_cancel.json()["detail"].lower())

    def test_dispute_on_completed_and_warranty_projects_restores_original_status(self):
        # 1. Completed project: open dispute -> DISPUTED -> resolve -> COMPLETED
        completed_proj, _ = self._create_project(
            status=models.ProjectStatus.COMPLETED,
            agreement_status="COMPLETED",
        )
        open_res = self.client.post(
            f"/api/disputes/{completed_proj.id}/open",
            json={"reason": "Post-delivery file issue", "disputed_by": "buyer"},
        )
        self.assertEqual(open_res.status_code, 200, open_res.text)
        self.assertEqual(open_res.json()["project_status"], "disputed")

        resolve_res = self.client.post(
            f"/api/disputes/{completed_proj.id}/resolve",
            json={"resolution_type": "MUTUAL_SETTLEMENT", "notes": "Updated files delivered"},
        )
        self.assertEqual(resolve_res.status_code, 200, resolve_res.text)
        self.assertEqual(resolve_res.json()["project_status"], "completed")

        self.db.expire_all()
        refreshed_completed = self.db.query(models.Project).filter(models.Project.id == completed_proj.id).first()
        self.assertEqual(refreshed_completed.status, models.ProjectStatus.COMPLETED)
        self.assertEqual(refreshed_completed.agreement.status, "COMPLETED")

        # 2. Warranty period project: open dispute -> DISPUTED -> resolve -> WARRANTY_PERIOD
        warranty_proj, _ = self._create_project(
            status=models.ProjectStatus.WARRANTY_PERIOD,
            agreement_status="WARRANTY_PERIOD",
            captured_amount=150.0,
            lock_in_type="FINAL_MILESTONE",
            lock_in_amount=150.0,
            warranty_days=14,
            warranty_end_date=datetime.now(timezone.utc) + timedelta(days=7),
            warranty_payout_status="PENDING",
            milestones=[
                {
                    "id": "m1",
                    "title": "Rough-In",
                    "price_allocation": 150.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-W1",
                },
                {
                    "id": "m2",
                    "title": "Final Install",
                    "price_allocation": 150.0,
                    "status": "approved",
                    "is_paid": False,
                    "retainage_held": True,
                },
            ],
        )
        w_open = self.client.post(
            f"/api/disputes/{warranty_proj.id}/open",
            json={"reason": "Cabinet hinge adjustment needed", "disputed_by": "buyer"},
        )
        self.assertEqual(w_open.status_code, 200, w_open.text)
        w_resolve = self.client.post(
            f"/api/disputes/{warranty_proj.id}/resolve",
            json={"resolution_type": "MUTUAL_SETTLEMENT", "notes": "Hinge repaired"},
        )
        self.assertEqual(w_resolve.status_code, 200, w_resolve.text)
        self.assertEqual(w_resolve.json()["project_status"], models.ProjectStatus.WARRANTY_PERIOD.value)

        # 3. Webhook CUSTOMER.DISPUTE.RESOLVED also restores COMPLETED
        webhook_open = self.client.post(
            "/api/webhooks/paypal",
            json={
                "event_type": "CUSTOMER.DISPUTE.CREATED",
                "resource": {
                    "dispute_id": f"PP-COMPLETE-{completed_proj.id}",
                    "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
                    "custom_id": f"project_{completed_proj.id}",
                },
            },
            headers={"x-simulate-webhook": "true"},
        )
        self.assertEqual(webhook_open.status_code, 200, webhook_open.text)

        webhook_resolved = self.client.post(
            "/api/webhooks/paypal",
            json={
                "event_type": "CUSTOMER.DISPUTE.RESOLVED",
                "resource": {
                    "dispute_id": f"PP-COMPLETE-{completed_proj.id}",
                    "custom_id": f"project_{completed_proj.id}",
                    "dispute_outcome": {"outcome_code": "RESOLVED_SELLER_FAVOUR"},
                },
            },
            headers={"x-simulate-webhook": "true"},
        )
        self.assertEqual(webhook_resolved.status_code, 200, webhook_resolved.text)

        self.db.expire_all()
        after_webhook = self.db.query(models.Project).filter(models.Project.id == completed_proj.id).first()
        self.assertEqual(after_webhook.status, models.ProjectStatus.COMPLETED)

    @patch("paypal_service.create_and_finalize_milestone_invoice", new_callable=AsyncMock)
    @patch("paypal_service.capture_payment", new_callable=AsyncMock)
    def test_warranty_early_release_and_matured_payout_generate_final_invoices(
        self, mock_capture, mock_invoice
    ):
        # Part A: Early Release
        proj1, _ = self._create_project(
            status=models.ProjectStatus.WARRANTY_PERIOD,
            agreement_status="WARRANTY_PERIOD",
            total_price=300.0,
            captured_amount=150.0,
            lock_in_type="FINAL_MILESTONE",
            lock_in_amount=150.0,
            warranty_days=14,
            warranty_end_date=datetime.now(timezone.utc) + timedelta(days=10),
            warranty_payout_status="PENDING",
            milestones=[
                {
                    "id": "m1",
                    "title": "Phase 1",
                    "price_allocation": 150.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-M1-EARLY",
                },
                {
                    "id": "m2",
                    "title": "Phase 2 Final",
                    "price_allocation": 150.0,
                    "status": "approved",
                    "is_paid": False,
                    "retainage_held": True,
                },
            ],
        )
        pay1 = models.Payment(
            project_id=proj1.id,
            paypal_order_id="ORD-EARLY-1",
            authorization_id="AUTH-EARLY-1",
            amount=300.0,
            currency="USD",
            status=models.PaymentStatus.PARTIALLY_CAPTURED,
        )
        inv1_m0 = models.Invoice(
            project_id=proj1.id,
            milestone_index=0,
            paypal_invoice_id="INV2-M0-EARLY",
            invoice_number="INV-0001",
            invoice_url="https://www.sandbox.paypal.com/invoice/p/#INV2-M0-EARLY",
            amount=150.0,
            currency="USD",
            status="PAID",
            paypal_capture_id="CAP-M1-EARLY",
        )
        self.db.add_all([pay1, inv1_m0])
        self.db.commit()

        mock_capture.return_value = {"id": "CAP-WARRANTY-FINAL-1", "status": "COMPLETED"}
        mock_invoice.return_value = {
            "paypal_invoice_id": "INV2-M1-EARLY",
            "invoice_number": "INV-0002",
            "invoice_url": "https://www.sandbox.paypal.com/invoice/p/#INV2-M1-EARLY",
            "status": "PAID",
            "amount": 150.0,
            "currency": "USD",
            "paypal_capture_id": "CAP-WARRANTY-FINAL-1",
        }

        rel_res = self.client.post(f"/api/projects/{proj1.id}/warranty/early-release")
        self.assertEqual(rel_res.status_code, 200, rel_res.text)
        rel_data = rel_res.json()
        self.assertIsNotNone(rel_data.get("invoice"))
        self.assertEqual(rel_data["invoice"]["invoice_number"], "INV-0002")

        list_res = self.client.get(f"/api/projects/{proj1.id}/invoices")
        self.assertEqual(list_res.status_code, 200)
        list_data = list_res.json()
        self.assertEqual(list_data["total_invoices"], 2)
        self.assertEqual([i["milestone_index"] for i in list_data["invoices"]], [0, 1])

        # Part B: Matured Automated Payout
        proj2, _ = self._create_project(
            status=models.ProjectStatus.WARRANTY_PERIOD,
            agreement_status="WARRANTY_PERIOD",
            total_price=400.0,
            captured_amount=200.0,
            lock_in_type="FINAL_MILESTONE",
            lock_in_amount=200.0,
            warranty_days=14,
            warranty_end_date=datetime.now(timezone.utc) - timedelta(hours=2),
            warranty_payout_status="PENDING",
            milestones=[
                {
                    "id": "m1",
                    "title": "Step 1",
                    "price_allocation": 200.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-MAT-1",
                },
                {
                    "id": "m2",
                    "title": "Step 2 Final",
                    "price_allocation": 200.0,
                    "status": "approved",
                    "is_paid": False,
                    "retainage_held": True,
                },
            ],
        )
        pay2 = models.Payment(
            project_id=proj2.id,
            paypal_order_id="ORD-MAT-1",
            authorization_id="AUTH-MAT-1",
            amount=400.0,
            currency="USD",
            status=models.PaymentStatus.PARTIALLY_CAPTURED,
        )
        self.db.add(pay2)
        self.db.commit()

        mock_capture.return_value = {"id": "CAP-MATURED-FINAL-2", "status": "COMPLETED"}
        mock_invoice.return_value = {
            "paypal_invoice_id": "INV2-M1-MAT",
            "invoice_number": "INV-MAT-002",
            "invoice_url": "https://www.sandbox.paypal.com/invoice/p/#INV2-M1-MAT",
            "status": "PAID",
            "amount": 200.0,
            "currency": "USD",
            "paypal_capture_id": "CAP-MATURED-FINAL-2",
        }

        matured_results = asyncio.run(process_matured_warranty_payouts(self.db))
        proj2_result = next((r for r in matured_results if r["project_id"] == proj2.id), None)
        self.assertIsNotNone(proj2_result)
        self.assertEqual(proj2_result["invoice"]["invoice_number"], "INV-MAT-002")

        saved_inv = (
            self.db.query(models.Invoice)
            .filter(models.Invoice.project_id == proj2.id, models.Invoice.milestone_index == 1)
            .first()
        )
        self.assertIsNotNone(saved_inv)
        self.assertEqual(saved_inv.invoice_number, "INV-MAT-002")

    @patch("paypal_service.create_and_finalize_milestone_invoice", new_callable=AsyncMock)
    def test_invoices_endpoint_deduplicates_backfills_and_falls_back_gracefully(self, mock_invoice):
        # Case 1: M0 has duplicate DB rows, M1 is paid with capture ID but missing from models.Invoice
        proj, _ = self._create_project(
            status=models.ProjectStatus.COMPLETED,
            agreement_status="COMPLETED",
            total_price=300.0,
            captured_amount=300.0,
            milestones=[
                {
                    "title": "Wireframes",
                    "description": "Initial wireframes",
                    "price_allocation": 150.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-M0",
                },
                {
                    "title": "Final UI Kit",
                    "description": "Completed kit",
                    "price_allocation": 150.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-M1",
                },
            ],
        )
        old_dup = models.Invoice(
            project_id=proj.id,
            milestone_index=0,
            paypal_invoice_id="INV2-M0-OLD",
            invoice_number="INV-0010-OLD",
            invoice_url="https://www.sandbox.paypal.com/invoice/p/#INV2-M0-OLD",
            amount=150.0,
            currency="USD",
            status="PAID",
            paypal_capture_id="CAP-M0",
        )
        newest_m0 = models.Invoice(
            project_id=proj.id,
            milestone_index=0,
            paypal_invoice_id="INV2-M0-NEW",
            invoice_number="INV-0010-NEW",
            invoice_url="https://www.sandbox.paypal.com/invoice/p/#INV2-M0-NEW",
            amount=150.0,
            currency="USD",
            status="PAID",
            paypal_capture_id="CAP-M0",
        )
        self.db.add_all([old_dup, newest_m0])
        self.db.commit()

        mock_invoice.return_value = {
            "paypal_invoice_id": "INV2-M1-HEALED",
            "invoice_number": "INV-0011-HEALED",
            "invoice_url": "https://www.sandbox.paypal.com/invoice/p/#INV2-M1-HEALED",
            "status": "PAID",
            "amount": 150.0,
            "currency": "USD",
            "paypal_capture_id": "CAP-M1",
        }

        res_heal = self.client.get(f"/api/projects/{proj.id}/invoices")
        self.assertEqual(res_heal.status_code, 200, res_heal.text)
        data_heal = res_heal.json()
        self.assertEqual(data_heal["total_invoices"], 2)
        self.assertEqual([i["milestone_index"] for i in data_heal["invoices"]], [0, 1])
        self.assertEqual(data_heal["invoices"][0]["invoice_number"], "INV-0010-NEW")
        self.assertEqual(data_heal["invoices"][1]["invoice_number"], "INV-0011-HEALED")
        self.assertFalse(data_heal["invoices"][1]["needs_paypal_sync"])

        # Case 2: PayPal Invoicing v2 API fails -> list_project_invoices returns settled fallback receipt
        proj_fail, _ = self._create_project(
            status=models.ProjectStatus.ACTIVE,
            agreement_status="ACTIVE",
            total_price=400.0,
            captured_amount=250.0,
            milestones=[
                {
                    "title": "Milestone 1",
                    "description": "Paid with DB invoice",
                    "price_allocation": 150.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-OK-1",
                },
                {
                    "title": "Milestone 2",
                    "description": "Paid capture, PayPal invoice API offline",
                    "price_allocation": 100.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-OFFLINE-2",
                },
                {
                    "title": "Milestone 3",
                    "description": "Unpaid milestone",
                    "price_allocation": 150.0,
                    "status": "pending",
                    "is_paid": False,
                },
            ],
        )
        db_inv_m0 = models.Invoice(
            project_id=proj_fail.id,
            milestone_index=0,
            paypal_invoice_id="INV2-OK-1",
            invoice_number="INV-OK-001",
            invoice_url="https://www.sandbox.paypal.com/invoice/p/#INV2-OK-1",
            amount=150.0,
            currency="USD",
            status="PAID",
            paypal_capture_id="CAP-OK-1",
        )
        self.db.add(db_inv_m0)
        self.db.commit()

        mock_invoice.side_effect = HTTPException(status_code=502, detail="PayPal Invoicing temporarily down")

        res_fallback = self.client.get(f"/api/projects/{proj_fail.id}/invoices")
        self.assertEqual(res_fallback.status_code, 200, res_fallback.text)
        data_fb = res_fallback.json()
        self.assertEqual(data_fb["total_invoices"], 2)
        self.assertEqual([i["milestone_index"] for i in data_fb["invoices"]], [0, 1])

        m1_fb = data_fb["invoices"][1]
        self.assertEqual(m1_fb["status"], "PAID")
        self.assertTrue(m1_fb["needs_paypal_sync"])
        self.assertIsNone(m1_fb["invoice_url"])
        self.assertEqual(m1_fb["paypal_capture_id"], "CAP-OFFLINE-2")
        self.assertEqual(m1_fb["invoice_number"], f"INV-{proj_fail.id}-M2")

        # Unpaid Milestone 3 must still return 404 when queried individually
        unpaid_res = self.client.get(f"/api/projects/{proj_fail.id}/milestones/2/invoice")
        self.assertEqual(unpaid_res.status_code, 404)

        # Single-milestone endpoint must also auto-backfill when PayPal succeeds and DB row is missing
        proj_single, _ = self._create_project(
            status=models.ProjectStatus.COMPLETED,
            agreement_status="COMPLETED",
            total_price=200.0,
            captured_amount=200.0,
            milestones=[
                {
                    "title": "Single Paid Milestone",
                    "description": "Paid without DB invoice row",
                    "price_allocation": 200.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-SINGLE-01",
                }
            ],
        )
        mock_invoice.side_effect = None
        mock_invoice.return_value = {
            "paypal_invoice_id": "INV2-SINGLE-01",
            "invoice_number": "INV-SINGLE-01",
            "invoice_url": "https://www.sandbox.paypal.com/invoice/p/#INV2-SINGLE-01",
            "status": "PAID",
            "amount": 200.0,
            "currency": "USD",
            "paypal_capture_id": "CAP-SINGLE-01",
        }
        single_res = self.client.get(f"/api/projects/{proj_single.id}/milestones/0/invoice")
        self.assertEqual(single_res.status_code, 200, single_res.text)
        self.assertEqual(single_res.json()["invoice_number"], "INV-SINGLE-01")
        self.assertEqual(single_res.json()["milestone_index"], 0)


if __name__ == "__main__":
    unittest.main()
