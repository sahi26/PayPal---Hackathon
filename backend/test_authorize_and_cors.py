import os
import sys
import uuid
import unittest
from unittest.mock import patch, AsyncMock
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import main
import auth_service
import models
from database import SessionLocal


VERCEL_ORIGIN = "https://pay-pal-hackathon-phi.vercel.app"
VERCEL_PREVIEW_ORIGIN = "https://pay-pal-hackathon-preview123.vercel.app"


class TestAuthorizeAndCorsHardening(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.client = TestClient(main.app, raise_server_exceptions=False)

    def tearDown(self):
        self.db.close()

    def _create_accepted_project(self, with_legacy_full_order: bool = False):
        uid = uuid.uuid4().hex[:8]
        buyer = models.User(
            email=f"cors_buyer_{uid}@test.com",
            password_hash=auth_service.hash_password("TestPass123!"),
            full_name=f"Buyer {uid}",
            role_type="buyer",
            email_verified=True,
        )
        seller = models.User(
            email=f"cors_seller_{uid}@test.com",
            password_hash=auth_service.hash_password("TestPass123!"),
            full_name=f"Seller {uid}",
            role_type="seller",
            email_verified=True,
        )
        self.db.add_all([buyer, seller])
        self.db.commit()
        self.db.refresh(buyer)
        self.db.refresh(seller)

        project = models.Project(
            buyer_id=buyer.id,
            seller_id=seller.id,
            client_email=seller.email,
            title=f"Custom Jewellery Necklace {uid} " + ("X" * 120),
            industry_type="Jewellery",
            description="Handcrafted 22k gold necklace",
            total_price=4000.0,
            status=models.ProjectStatus.ACCEPTED,
            project_domain="physical",
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        agreement = models.Agreement(
            project_id=project.id,
            status="ACCEPTED",
            is_accepted_by_client=1,
            version=1,
            milestones=[
                {
                    "title": "Design & Casting",
                    "description": "CAD and gold casting",
                    "price_allocation": 2000.0,
                    "status": "pending",
                    "proof_required": "Live photo",
                },
                {
                    "title": "Stone Setting & Final Finish",
                    "description": "Setting & polish",
                    "price_allocation": 2000.0,
                    "status": "pending",
                    "proof_required": "Live photo",
                },
            ],
        )
        self.db.add(agreement)
        if with_legacy_full_order:
            legacy_order_id = f"LEGACY-{uid.upper()}"
            self.db.add(models.Payment(
                project_id=project.id,
                milestone_index=None,
                paypal_order_id=legacy_order_id,
                amount=4000.0,
                currency="USD",
                status=models.PaymentStatus.CREATED,
            ))
            project.paypal_order_id = legacy_order_id
            project.paypal_approval_url = f"https://www.sandbox.paypal.com/checkoutnow?token={legacy_order_id}"
        self.db.commit()

        buyer_token = auth_service.create_access_token(buyer.id, buyer.email, "buyer")
        seller_token = auth_service.create_access_token(seller.id, seller.email, "seller")
        return project, buyer, seller, buyer_token, seller_token

    def test_cors_middleware_is_outermost_and_preflight_succeeds(self):
        # CORSMiddleware is appended after http middleware so build_middleware_stack wraps BaseHTTPMiddleware inside CORS.
        cors_indices = [i for i, m in enumerate(main.app.user_middleware) if m.cls is CORSMiddleware]
        http_indices = [i for i, m in enumerate(main.app.user_middleware) if m.cls is not CORSMiddleware]
        self.assertTrue(cors_indices, "CORSMiddleware must be registered")
        if http_indices:
            self.assertLess(max(cors_indices), min(http_indices), "CORSMiddleware must wrap http middleware")

        for origin in (VERCEL_ORIGIN, VERCEL_PREVIEW_ORIGIN):
            resp = self.client.options(
                "/api/payments/authorize",
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "authorization,content-type",
                },
            )
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.headers.get("access-control-allow-origin"), origin)

    def test_error_responses_preserve_cors_headers(self):
        project, buyer, _, buyer_token, _ = self._create_accepted_project()
        headers = {"Authorization": f"Bearer {buyer_token}", "Origin": VERCEL_ORIGIN}

        # 1) PayPal 502 error from authorize endpoint preserves CORS
        with patch.dict(os.environ, {"ALLOW_INSECURE_TEST_AUTH": "0"}), patch(
            "paypal_service.create_order_for_authorize",
            new=AsyncMock(side_effect=HTTPException(status_code=502, detail="PayPal timeout")),
        ):
            resp = self.client.post(
                "/api/payments/authorize",
                json={"project_id": project.id, "milestone_index": 0, "currency": "USD"},
                headers=headers,
            )
            self.assertEqual(resp.status_code, 502)
            self.assertEqual(resp.headers.get("access-control-allow-origin"), VERCEL_ORIGIN)

        # 2) Unexpected exception inside auth middleware still returns 500 JSON with CORS headers (never 0 undefined)
        with patch.dict(os.environ, {"ALLOW_INSECURE_TEST_AUTH": "0"}), patch(
            "auth_service.decode_access_token",
            side_effect=None,
            return_value={"sub": str(buyer.id)},
        ), patch.object(
            main, "_project_id_from_path", side_effect=RuntimeError("Simulated middleware failure")
        ):
            resp = self.client.post(
                "/api/payments/authorize",
                json={"project_id": project.id, "milestone_index": 0, "currency": "USD"},
                headers=headers,
            )
            self.assertEqual(resp.status_code, 500)
            self.assertEqual(resp.headers.get("access-control-allow-origin"), VERCEL_ORIGIN)
            self.assertIn("Internal server error", resp.json().get("detail", ""))

    def test_stale_created_order_expired_and_replaced_and_legacy_hidden(self):
        project, _, _, buyer_token, seller_token = self._create_accepted_project(with_legacy_full_order=True)
        uid = uuid.uuid4().hex[:6].upper()
        stale_order_id = f"STALE-{uid}"
        fresh_order_id_1 = f"FRESH1-{uid}"
        fresh_order_id_2 = f"FRESH2-{uid}"

        self.db.add(models.Payment(
            project_id=project.id,
            milestone_index=0,
            paypal_order_id=stale_order_id,
            amount=2000.0,
            currency="USD",
            status=models.PaymentStatus.CREATED,
        ))
        self.db.commit()

        # 1) When get_order_details returns 404 (502 HTTPException), stale order is EXPIRED and a new order is created
        buyer_headers = {"Authorization": f"Bearer {buyer_token}", "Origin": VERCEL_ORIGIN}
        with patch.dict(os.environ, {"ALLOW_INSECURE_TEST_AUTH": "0"}), patch(
            "paypal_service.get_order_details",
            new=AsyncMock(side_effect=HTTPException(status_code=502, detail="404 RESOURCE_NOT_FOUND")),
        ), patch(
            "paypal_service.create_order_for_authorize",
            new=AsyncMock(return_value={
                "id": fresh_order_id_1,
                "status": "CREATED",
                "links": [{"href": f"https://www.sandbox.paypal.com/checkoutnow?token={fresh_order_id_1}", "rel": "approve"}],
            }),
        ) as mock_create:
            resp = self.client.post(
                "/api/payments/authorize",
                json={"project_id": project.id, "milestone_index": 0, "currency": "USD"},
                headers=buyer_headers,
            )
            self.assertEqual(resp.status_code, 200, resp.text)
            self.assertEqual(resp.headers.get("access-control-allow-origin"), VERCEL_ORIGIN)
            self.assertEqual(resp.json()["paypal_order_id"], fresh_order_id_1)
            # PayPal Orders v2 description limit is 127 chars
            self.assertLessEqual(len(mock_create.call_args.kwargs["description"]), 127)

        self.db.expire_all()
        stale_row = self.db.query(models.Payment).filter(models.Payment.paypal_order_id == stale_order_id).first()
        self.assertEqual(stale_row.status, models.PaymentStatus.EXPIRED)

        # 2) When force_new=True, live CREATED order is also expired and replaced with a brand-new checkout order
        with patch.dict(os.environ, {"ALLOW_INSECURE_TEST_AUTH": "0"}), patch(
            "paypal_service.create_order_for_authorize",
            new=AsyncMock(return_value={
                "id": fresh_order_id_2,
                "status": "CREATED",
                "links": [{"href": f"https://www.sandbox.paypal.com/checkoutnow?token={fresh_order_id_2}", "rel": "approve"}],
            }),
        ):
            resp2 = self.client.post(
                "/api/payments/authorize",
                json={"project_id": project.id, "milestone_index": 0, "currency": "USD", "force_new": True},
                headers=buyer_headers,
            )
            self.assertEqual(resp2.status_code, 200, resp2.text)
            self.assertEqual(resp2.json()["paypal_order_id"], fresh_order_id_2)

        self.db.expire_all()
        first_fresh_row = self.db.query(models.Payment).filter(models.Payment.paypal_order_id == fresh_order_id_1).first()
        self.assertEqual(first_fresh_row.status, models.PaymentStatus.EXPIRED)

        # 3) Legacy project with ONLY milestone_index=None payment does not leak unusable approval_url in production
        legacy_proj, _, _, buyer_token_2, _ = self._create_accepted_project(with_legacy_full_order=True)
        with patch.dict(os.environ, {"ALLOW_INSECURE_TEST_AUTH": "0"}):
            proj_res = self.client.get(
                f"/api/projects/{legacy_proj.id}",
                headers={"Authorization": f"Bearer {buyer_token_2}", "Origin": VERCEL_ORIGIN},
            )
            self.assertEqual(proj_res.status_code, 200)
            self.assertIsNone(proj_res.json().get("paypal_approval_url"))

        # 4) Production accept does not create milestone_index=None full-project order
        project_unaccepted, _, _, _, seller_token_2 = self._create_accepted_project(with_legacy_full_order=False)
        project_unaccepted.status = models.ProjectStatus.SELLER_JOINED
        if project_unaccepted.agreement:
            project_unaccepted.agreement.is_accepted_by_client = 0
            project_unaccepted.agreement.status = "ACTIVE"
        self.db.commit()
        with patch.dict(os.environ, {"ALLOW_INSECURE_TEST_AUTH": "0"}):
            acc_res = self.client.post(
                f"/api/projects/{project_unaccepted.id}/accept",
                headers={"Authorization": f"Bearer {seller_token_2}", "Origin": VERCEL_ORIGIN},
            )
            self.assertEqual(acc_res.status_code, 200, acc_res.text)
            self.assertIsNone(acc_res.json().get("paypal_order_id"))
            self.assertIsNone(acc_res.json().get("approval_url"))


if __name__ == "__main__":
    unittest.main()
