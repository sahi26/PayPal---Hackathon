import asyncio
import base64
import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import auth_service
import database
import main
import models
import paypal_service
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

    @patch("paypal_service.generate_invoice_qr_code", new_callable=AsyncMock)
    @patch("paypal_service.record_invoice_payment", new_callable=AsyncMock)
    @patch("paypal_service.send_invoice", new_callable=AsyncMock)
    @patch("paypal_service.create_draft_invoice", new_callable=AsyncMock)
    @patch("paypal_service.get_invoicing_merchant_email", new_callable=AsyncMock)
    @patch("paypal_service.generate_invoice_number", new_callable=AsyncMock)
    @patch("paypal_service.has_network_connection", return_value=True)
    def test_sync_invoice_recovers_when_sequence_number_or_invoicer_email_fails(
        self,
        _mock_net,
        mock_gen_num,
        mock_merchant_email,
        mock_create_draft,
        mock_send,
        mock_record_pay,
        mock_qr,
    ):
        proj, _ = self._create_project(
            status=models.ProjectStatus.COMPLETED,
            agreement_status="COMPLETED",
            total_price=4000.0,
            captured_amount=4000.0,
            milestones=[
                {
                    "title": "Milestone 1",
                    "description": "Core Execution",
                    "price_allocation": 2000.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-M1-OK",
                },
                {
                    "title": "Milestone 2",
                    "description": "Final Quality Review",
                    "price_allocation": 2000.0,
                    "status": "approved",
                    "is_paid": True,
                    "paid_at": "2026-11-10T12:54:41Z",
                    "paypal_capture_id": "6L962102LU319562T",
                },
            ],
        )

        # Simulate PayPal sequence-number endpoint failing + first draft rejecting DUPLICATE/invoicer email
        mock_gen_num.side_effect = HTTPException(status_code=502, detail="PayPal could not generate an invoice number.")
        mock_merchant_email.return_value = None

        seen_payloads = []

        async def _create_draft_side_effect(payload):
            import copy

            seen_payloads.append(copy.deepcopy(payload))
            if len(seen_payloads) == 1:
                raise HTTPException(
                    status_code=502,
                    detail="PayPal invoice creation failed (422): UNPROCESSABLE_ENTITY: DUPLICATE_INVOICE_NUMBER: Invalid invoicer email"
                )
            return {"id": "INV2-LIVE-RECOVERED"}

        mock_create_draft.side_effect = _create_draft_side_effect
        mock_send.return_value = {"href": "https://www.sandbox.paypal.com/invoice/p/#INV2-LIVE-RECOVERED"}
        mock_record_pay.return_value = {"payment_id": "PAY-LIVE-REC", "confirmed": True}
        mock_qr.return_value = None

        sync_res = self.client.post(f"/api/projects/{proj.id}/milestones/1/generate-invoice")
        self.assertEqual(sync_res.status_code, 200, sync_res.text)
        inv = sync_res.json()["invoice"]
        self.assertEqual(inv["paypal_invoice_id"], "INV2-LIVE-RECOVERED")
        self.assertEqual(inv["invoice_url"], "https://www.sandbox.paypal.com/invoice/p/#INV2-LIVE-RECOVERED")
        self.assertTrue(inv["invoice_number"].startswith(f"PL-{proj.id}-M2-"))
        self.assertFalse(inv["needs_paypal_sync"])
        self.assertIn("2026-11-10T12:54:41", inv["paid_at"])
        self.assertEqual(len(seen_payloads), 2)
        self.assertNotIn("email_address", seen_payloads[1].get("invoicer", {}))

    def test_generate_invoice_timeout_returns_504_with_cors_headers(self):
        import os
        import auth_service
        from main import _ensure_milestone_invoice

        proj, agreement = self._create_project(
            status=models.ProjectStatus.COMPLETED,
            agreement_status="COMPLETED",
            total_price=4000.0,
            captured_amount=4000.0,
            milestones=[
                {
                    "title": "Milestone 1",
                    "description": "Core Execution",
                    "price_allocation": 2000.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-T1",
                },
                {
                    "title": "Milestone 2",
                    "description": "Final Quality",
                    "price_allocation": 2000.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "6L962102LU319562T",
                },
            ],
        )

        # 1) Direct async timeout enforcement inside _ensure_milestone_invoice
        async def _stalled_paypal(*args, **kwargs):
            await asyncio.sleep(1.5)
            return {}

        with patch("paypal_service.create_and_finalize_milestone_invoice", side_effect=_stalled_paypal):
            inv_data, err_msg = asyncio.run(
                _ensure_milestone_invoice(
                    db=self.db,
                    project=proj,
                    agreement=agreement,
                    milestone_index=1,
                    capture_id="6L962102LU319562T",
                    timeout_seconds=0.05,
                )
            )
        self.assertIsNone(inv_data)
        self.assertIsNotNone(err_msg)
        self.assertIn("timed out", err_msg.lower())

        # 2) Endpoint POST .../generate-invoice returns 504 + CORS headers (not unheaded proxy timeout)
        buyer_token = auth_service.create_access_token(self.buyer.id, self.buyer.email, "buyer")
        vercel_origin = "https://pay-pal-hackathon-phi.vercel.app"
        with patch.dict(os.environ, {"ALLOW_INSECURE_TEST_AUTH": "0"}), patch(
            "paypal_service.create_and_finalize_milestone_invoice",
            new=AsyncMock(side_effect=asyncio.TimeoutError()),
        ):
            resp = self.client.post(
                f"/api/projects/{proj.id}/milestones/1/generate-invoice",
                headers={"Authorization": f"Bearer {buyer_token}", "Origin": vercel_origin},
            )
        self.assertEqual(resp.status_code, 504, resp.text)
        self.assertIn("timed out", resp.json()["detail"].lower())
        self.assertEqual(resp.headers.get("access-control-allow-origin"), vercel_origin)

    def test_concurrent_invoice_sync_is_single_flight_and_deduplicates_paypal_calls(self):
        import httpx

        proj, _ = self._create_project(
            status=models.ProjectStatus.COMPLETED,
            agreement_status="COMPLETED",
            total_price=4000.0,
            captured_amount=4000.0,
            milestones=[
                {
                    "title": "Milestone 1",
                    "description": "Core Execution",
                    "price_allocation": 2000.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-M1-DONE",
                },
                {
                    "title": "Milestone 2",
                    "description": "Final Quality",
                    "price_allocation": 2000.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "6L962102LU319562T",
                },
            ],
        )
        m0_inv = models.Invoice(
            project_id=proj.id,
            milestone_index=0,
            paypal_invoice_id="INV2-M0-LOCKED",
            invoice_number="0036",
            invoice_url="https://www.sandbox.paypal.com/invoice/p/#INV2-M0-LOCKED",
            amount=2000.0,
            currency="USD",
            status="PAID",
            paypal_capture_id="CAP-M1-DONE",
        )
        self.db.add(m0_inv)
        self.db.commit()

        call_count = 0

        async def _slow_once(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            await asyncio.sleep(0.15)
            return {
                "paypal_invoice_id": "INV2-SINGLE-FLIGHT-M1",
                "invoice_number": "PL-SF-001",
                "invoice_url": "https://www.sandbox.paypal.com/invoice/p/#INV2-SINGLE-FLIGHT-M1",
                "status": "PAID",
                "amount": 2000.0,
                "currency": "USD",
                "paypal_capture_id": "6L962102LU319562T",
                "payment_record_id": "PAY-SF-001",
                "qr_code_base64": None,
                "issued_at": "2026-11-10T13:30:00Z",
            }

        async def _run_concurrent():
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
                return await asyncio.gather(
                    ac.get(f"/api/projects/{proj.id}/invoices"),
                    ac.post(f"/api/projects/{proj.id}/milestones/1/generate-invoice", json={}),
                )

        with patch("paypal_service.create_and_finalize_milestone_invoice", side_effect=_slow_once):
            get_resp, post_resp = asyncio.run(_run_concurrent())

        self.assertEqual(get_resp.status_code, 200, get_resp.text)
        self.assertEqual(post_resp.status_code, 200, post_resp.text)
        self.assertEqual(call_count, 1, "Single-flight lock must deduplicate concurrent GET + POST invoice syncs")

        post_inv = post_resp.json()["invoice"]
        self.assertEqual(post_inv["paypal_invoice_id"], "INV2-SINGLE-FLIGHT-M1")
        self.assertEqual(post_inv["invoice_url"], "https://www.sandbox.paypal.com/invoice/p/#INV2-SINGLE-FLIGHT-M1")

        m1_rows = (
            self.db.query(models.Invoice)
            .filter(models.Invoice.project_id == proj.id, models.Invoice.milestone_index == 1)
            .all()
        )
        self.assertEqual(len(m1_rows), 1)

    def test_merchant_email_cache_and_sequence_cooldown_skip_redundant_roundtrips(self):
        import os
        import httpx

        recorded_requests = []
        RealAsyncClient = httpx.AsyncClient

        def _handler(request: httpx.Request) -> httpx.Response:
            path = request.url.path
            recorded_requests.append(path)
            if path.endswith("/v2/invoicing/generate-next-invoice-number"):
                return httpx.Response(500, json={"name": "INTERNAL_SERVER_ERROR", "message": "Sequence unavailable"})
            if path.endswith("/v1/identity/oauth2/userinfo"):
                return httpx.Response(200, json={"emails": [{"primary": True, "value": "merchant-cached@example.com"}]})
            if path.endswith("/v2/invoicing/invoices"):
                return httpx.Response(201, json={"id": "INV2-POOLED-001"})
            if path.endswith("/send"):
                return httpx.Response(202, json={"href": "https://www.sandbox.paypal.com/invoice/p/#INV2-POOLED-001"})
            if path.endswith("/payments"):
                return httpx.Response(200, json={"payment_id": "PAY-POOLED-001"})
            if path.endswith("/generate-qr-code"):
                return httpx.Response(404, json={"message": "skip"})
            return httpx.Response(404, json={"path": path})

        transport = httpx.MockTransport(_handler)

        def _mock_client_factory(*args, **kwargs):
            kwargs["transport"] = transport
            return RealAsyncClient(*args, **kwargs)

        prev_email_cache = (
            paypal_service._cached_merchant_email,
            paypal_service._merchant_email_cache_set,
            paypal_service._merchant_email_expires_at,
            paypal_service._seq_num_cooldown_until,
        )
        try:
            paypal_service._cached_merchant_email = None
            paypal_service._merchant_email_cache_set = False
            paypal_service._merchant_email_expires_at = None
            paypal_service._seq_num_cooldown_until = None

            with patch("paypal_service.APP_ENV", "development"), patch.dict(
                os.environ, {"PAYPAL_MERCHANT_EMAIL": ""}, clear=False
            ), patch(
                "paypal_service.get_paypal_headers",
                new=AsyncMock(return_value={"Authorization": "Bearer TEST", "Content-Type": "application/json"}),
            ), patch("paypal_service.httpx.AsyncClient", side_effect=_mock_client_factory):
                res1 = asyncio.run(
                    paypal_service.create_and_finalize_milestone_invoice(
                        project_id=93,
                        milestone_index=1,
                        milestone_title="Final Delivery",
                        milestone_description="Delivery",
                        amount=2000.0,
                        capture_id="6L962102LU319562T",
                        buyer_email="buyer@example.com",
                        seller_email="seller@example.com",
                    )
                )
                first_call_paths = list(recorded_requests)
                recorded_requests.clear()

                res2 = asyncio.run(
                    paypal_service.create_and_finalize_milestone_invoice(
                        project_id=93,
                        milestone_index=1,
                        milestone_title="Final Delivery",
                        milestone_description="Delivery",
                        amount=2000.0,
                        capture_id="6L962102LU319562T",
                        buyer_email="buyer@example.com",
                        seller_email="seller@example.com",
                    )
                )
                second_call_paths = list(recorded_requests)

            self.assertEqual(res1["seller_email"], "merchant-cached@example.com")
            self.assertEqual(res2["seller_email"], "merchant-cached@example.com")
            self.assertIn("/v2/invoicing/generate-next-invoice-number", first_call_paths)
            self.assertIn("/v1/identity/oauth2/userinfo", first_call_paths)
            # Second call skips both failing sequence generator and cached userinfo lookup
            self.assertNotIn("/v2/invoicing/generate-next-invoice-number", second_call_paths)
            self.assertNotIn("/v1/identity/oauth2/userinfo", second_call_paths)
            self.assertTrue(res2["invoice_number"].startswith("PL-93-M2-"))
        finally:
            (
                paypal_service._cached_merchant_email,
                paypal_service._merchant_email_cache_set,
                paypal_service._merchant_email_expires_at,
                paypal_service._seq_num_cooldown_until,
            ) = prev_email_cache

    def test_seller_and_buyer_can_sync_invoice_while_outsider_gets_404(self):
        proj, _ = self._create_project(
            status=models.ProjectStatus.COMPLETED,
            agreement_status="COMPLETED",
            total_price=4000.0,
            captured_amount=4000.0,
            milestones=[
                {
                    "title": "Milestone 1",
                    "description": "Core Execution",
                    "price_allocation": 2000.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-AUTH-M1",
                },
                {
                    "title": "Milestone 2",
                    "description": "Final Quality",
                    "price_allocation": 2000.0,
                    "status": "approved",
                    "is_paid": True,
                    "paypal_capture_id": "CAP-AUTH-M2",
                },
            ],
        )
        outsider = models.User(
            email="outsider_sync_suite@example.com",
            password_hash="hash",
            full_name="Outsider User",
            role_type="seller",
        )
        self.db.add(outsider)
        self.db.commit()
        self.db.refresh(outsider)

        seller_token = auth_service.create_access_token(self.seller.id, self.seller.email, "seller")
        buyer_token = auth_service.create_access_token(self.buyer.id, self.buyer.email, "buyer")
        outsider_token = auth_service.create_access_token(outsider.id, outsider.email, "seller")

        async def _mock_create_invoice(**kwargs):
            idx = kwargs["milestone_index"]
            return {
                "paypal_invoice_id": f"INV2-AUTH-M{idx}",
                "invoice_number": f"PL-AUTH-{idx}",
                "invoice_url": f"https://www.sandbox.paypal.com/invoice/p/#INV2-AUTH-M{idx}",
                "status": "PAID",
                "amount": kwargs["amount"],
                "currency": "USD",
                "paypal_capture_id": kwargs["capture_id"],
                "payment_record_id": f"PAY-AUTH-{idx}",
                "qr_code_base64": None,
                "issued_at": "2026-11-10T14:00:00Z",
            }

        with patch.dict(os.environ, {"ALLOW_INSECURE_TEST_AUTH": "0"}), patch(
            "paypal_service.create_and_finalize_milestone_invoice",
            side_effect=_mock_create_invoice,
        ):
            seller_resp = self.client.post(
                f"/api/projects/{proj.id}/milestones/0/generate-invoice",
                headers={"Authorization": f"Bearer {seller_token}"},
            )
            self.assertEqual(seller_resp.status_code, 200, seller_resp.text)
            self.assertEqual(seller_resp.json()["invoice"]["paypal_invoice_id"], "INV2-AUTH-M0")

            buyer_resp = self.client.post(
                f"/api/projects/{proj.id}/milestones/1/generate-invoice",
                headers={"Authorization": f"Bearer {buyer_token}"},
            )
            self.assertEqual(buyer_resp.status_code, 200, buyer_resp.text)
            self.assertEqual(buyer_resp.json()["invoice"]["paypal_invoice_id"], "INV2-AUTH-M1")

            outsider_resp = self.client.post(
                f"/api/projects/{proj.id}/milestones/0/generate-invoice",
                headers={"Authorization": f"Bearer {outsider_token}"},
            )
            self.assertEqual(outsider_resp.status_code, 404, outsider_resp.text)

    def test_paypal_oauth_login_profile_fallbacks_and_oidc_id_token(self):
        import httpx

        RealAsyncClient = httpx.AsyncClient
        mode = {"scenario": "oidc_fallback"}
        captured_get_headers = []

        def _make_jwt(claims: dict) -> str:
            header = base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).decode().rstrip("=")
            payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
            return f"{header}.{payload}.sig"

        def _oauth_handler(request: httpx.Request) -> httpx.Response:
            full_url = str(request.url)
            if request.method == "POST" and request.url.path.endswith("/v1/oauth2/token"):
                token_body = {
                    "access_token": "A21-SANDBOX-TOKEN",
                    "token_type": "Bearer",
                    "expires_in": 900,
                    "scope": "openid profile email",
                    "app_id": "APP-TEST-123",
                }
                if mode["scenario"] == "id_token_fallback":
                    token_body["id_token"] = _make_jwt(
                        {
                            "iss": "https://www.sandbox.paypal.com",
                            "aud": "APP-TEST-123",
                            "exp": str(int((datetime.now(timezone.utc) + timedelta(minutes=15)).timestamp())),
                            "email": "id_token_seller@example.com",
                            "email_verified": True,
                            "name": "ID Token Seller",
                        }
                    )
                return httpx.Response(200, json=token_body)

            if request.method == "GET":
                captured_get_headers.append(dict(request.headers))
                if mode["scenario"] == "oidc_fallback":
                    if "schema=paypalv1.1" in full_url:
                        return httpx.Response(
                            403,
                            json={"name": "NOT_AUTHORIZED", "message": "Legacy schema not enabled"},
                        )
                    if (
                        request.url.path.endswith("/v1/identity/openidconnect/userinfo")
                        and "schema=openid" in str(request.url.query)
                    ):
                        return httpx.Response(
                            200,
                            json={
                                "sub": "user-123",
                                "email": "oidc_buyer@example.com",
                                "email_verified": "true",
                                "given_name": "OIDC",
                                "family_name": "Buyer",
                            },
                        )
                elif mode["scenario"] == "token_userinfo_fallback":
                    if request.url.path.endswith("/v1/oauth2/token/userinfo") and "schema=openid" in str(request.url.query):
                        return httpx.Response(
                            200,
                            json={
                                "sub": "user-tok-456",
                                "email_address": "legacy_token_seller@example.com",
                                "verified_account": True,
                                "name": "Legacy Token Seller",
                            },
                        )
                    return httpx.Response(
                        400,
                        json={"error": "invalid_request", "error_description": "Unable to fetch details to serve the request"},
                    )
                elif mode["scenario"] == "sandbox_business_400":
                    if "oauth2/userinfo" in full_url:
                        return httpx.Response(
                            400,
                            headers={"PayPal-Debug-Id": "dbg-biz-400"},
                            json={"error": "invalid_request", "error_description": "Unable to fetch details to serve the request"},
                        )
                    return httpx.Response(404, json={"message": "Not found"})
                elif mode["scenario"] == "retry_without_content_type":
                    if (
                        request.url.path.endswith("/v1/identity/openidconnect/userinfo")
                        and "schema=openid" in str(request.url.query)
                    ):
                        if "content-type" not in request.headers:
                            return httpx.Response(
                                200,
                                json={
                                    "sub": "user-clean-get",
                                    "email": "header_retry_seller@example.com",
                                    "email_verified": True,
                                    "name": "Header Retry Seller",
                                },
                            )
                        return httpx.Response(400, json={"error": "invalid_request", "error_description": "Content-Type rejected on GET"})
                    return httpx.Response(404, json={"message": "Not found"})
                elif mode["scenario"] in {"id_token_fallback", "all_fail"}:
                    return httpx.Response(
                        403,
                        json={"error": "insufficient_scope", "error_description": "Insufficient scope for profile"},
                    )

            return httpx.Response(404, json={"message": f"Unexpected {request.method} {full_url}"})

        transport = httpx.MockTransport(_oauth_handler)

        def _mock_client_factory(*args, **kwargs):
            kwargs["transport"] = transport
            return RealAsyncClient(*args, **kwargs)

        with patch.object(main, "PAYPAL_CLIENT_ID", "test-pp-client"), patch.object(
            main, "PAYPAL_CLIENT_SECRET", "test-pp-secret"
        ), patch("main.httpx.AsyncClient", side_effect=_mock_client_factory):
            # 1) Legacy ?schema=paypalv1.1 returns 403 -> OIDC userinfo ?schema=openid succeeds
            mode["scenario"] = "oidc_fallback"
            res_oidc = self.client.post(
                "/api/auth/paypal-login",
                json={"code": "AUTH_CODE_1", "redirect_uri": "http://localhost:4200", "role": "buyer"},
            )
            self.assertEqual(res_oidc.status_code, 200, res_oidc.text)
            oidc_user = res_oidc.json()
            self.assertEqual(oidc_user["email"], "oidc_buyer@example.com")
            self.assertEqual(oidc_user["full_name"], "OIDC Buyer")
            self.assertEqual(oidc_user["role_type"], "buyer")
            self.assertTrue(oidc_user.get("access_token"))
            self.assertTrue(captured_get_headers)
            for hdrs in captured_get_headers:
                self.assertEqual(hdrs.get("content-type"), "application/json")

            # 2) Legacy /v1/oauth2/token/userinfo?schema=openid fallback + email_address field succeeds
            mode["scenario"] = "token_userinfo_fallback"
            res_legacy = self.client.post(
                "/api/auth/paypal-login",
                json={"code": "AUTH_CODE_LEGACY", "redirect_uri": "http://localhost:4200", "role": "seller"},
            )
            self.assertEqual(res_legacy.status_code, 200, res_legacy.text)
            legacy_user = res_legacy.json()
            self.assertEqual(legacy_user["email"], "legacy_token_seller@example.com")
            self.assertEqual(legacy_user["role_type"], "seller")

            # 3) All userinfo endpoints return 403 -> id_token JWT from /token response succeeds
            mode["scenario"] = "id_token_fallback"
            res_idtok = self.client.post(
                "/api/auth/paypal-login",
                json={"code": "AUTH_CODE_2", "redirect_uri": "http://localhost:4200", "role": "seller"},
            )
            self.assertEqual(res_idtok.status_code, 200, res_idtok.text)
            idtok_user = res_idtok.json()
            self.assertEqual(idtok_user["email"], "id_token_seller@example.com")
            self.assertEqual(idtok_user["full_name"], "ID Token Seller")
            self.assertEqual(idtok_user["role_type"], "seller")

            # 4) All fail and no id_token -> surfaces HTTP status & PayPal detail
            mode["scenario"] = "all_fail"
            res_fail = self.client.post(
                "/api/auth/paypal-login",
                json={"code": "AUTH_CODE_3", "redirect_uri": "http://localhost:4200", "role": "buyer"},
            )
            self.assertEqual(res_fail.status_code, 400, res_fail.text)
            self.assertIn("HTTP 403", res_fail.json()["detail"])
            self.assertIn("Insufficient scope for profile", res_fail.json()["detail"])

            # 5) Sandbox business account 400 ("Unable to fetch details to serve the request") is preserved over 404 fallbacks and includes actionable guidance
            mode["scenario"] = "sandbox_business_400"
            res_biz = self.client.post(
                "/api/auth/paypal-login",
                json={"code": "AUTH_CODE_BIZ", "redirect_uri": "http://localhost:4200", "role": "seller"},
            )
            self.assertEqual(res_biz.status_code, 400, res_biz.text)
            biz_detail = res_biz.json()["detail"]
            self.assertIn("HTTP 400", biz_detail)
            self.assertIn("Unable to fetch details to serve the request", biz_detail)
            self.assertIn("@personal.example.com", biz_detail)
            self.assertIn("[Diag: scope=openid profile email; id_token=missing;", biz_detail)
            self.assertIn("dbg-biz-400", biz_detail)

            # 6) 400 when Content-Type is rejected retries cleanly without Content-Type
            mode["scenario"] = "retry_without_content_type"
            res_clean_retry = self.client.post(
                "/api/auth/paypal-login",
                json={"code": "AUTH_CODE_CLEAN_RETRY", "redirect_uri": "http://localhost:4200", "role": "seller"},
            )
            self.assertEqual(res_clean_retry.status_code, 200, res_clean_retry.text)
            self.assertEqual(res_clean_retry.json()["email"], "header_retry_seller@example.com")

            # 7) /api/auth/paypal-config encodes redirect_uri cleanly
            cfg_res = self.client.get(
                "/api/auth/paypal-config",
                params={"redirect_uri": "https://pay-pal-hackathon-phi.vercel.app"},
            )
            self.assertEqual(cfg_res.status_code, 200, cfg_res.text)
            self.assertIn(
                "redirect_uri=https%3A%2F%2Fpay-pal-hackathon-phi.vercel.app",
                cfg_res.json()["oauth_url"],
            )
            self.assertIn(
                "prompt=login",
                cfg_res.json()["oauth_url"],
            )


if __name__ == "__main__":
    unittest.main()
