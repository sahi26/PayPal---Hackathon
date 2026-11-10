import io
import os
import sys
import uuid
import unittest
import xml.etree.ElementTree as ET
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine, event, inspect, text

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import main

main.os.environ["GEMINI_API_KEY"] = ""
main.GEMINI_API_KEY = ""

from main import app, UPLOAD_DIR
from database import SessionLocal, run_migrations
import models


def _make_image_bytes(fmt: str = "PNG", color=(34, 139, 34)) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (64, 64), color=color)
    img.save(buf, format=fmt)
    return buf.getvalue()


class TestEvidenceDownloadPersistence(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.db = SessionLocal()
        self.created_disk_paths = []

    def tearDown(self):
        for p in self.created_disk_paths:
            try:
                if os.path.isfile(p):
                    os.remove(p)
            except Exception:
                pass
        self.db.close()

    def _create_funded_project(self, domain: str = "physical", title: str = "Oak Joinery Desk"):
        uid = uuid.uuid4().hex[:8]
        buyer = models.User(
            email=f"buyer_persist_{uid}@test.com",
            password_hash="test",
            full_name="Persist Buyer",
            role_type="buyer",
            email_verified=True,
        )
        seller = models.User(
            email=f"seller_persist_{uid}@test.com",
            password_hash="test",
            full_name="Persist Seller",
            role_type="seller",
            email_verified=True,
        )
        self.db.add_all([buyer, seller])
        self.db.commit()

        project = models.Project(
            buyer_id=buyer.id,
            seller_id=seller.id,
            title=title,
            industry_type="Digital Art" if domain == "digital" else "Carpentry",
            description="Test persistence",
            total_price=300.0,
            status=models.ProjectStatus.ACTIVE,
            project_domain=domain,
            paypal_authorization_id=f"AUTH-PERSIST-{uid}",
        )
        self.db.add(project)
        self.db.commit()

        agreement = models.Agreement(
            project_id=project.id,
            status="ACTIVE",
            version=1,
            milestones=[
                {
                    "title": "Milestone 1",
                    "description": "Primary deliverable",
                    "price_allocation": 300.0,
                    "proof_required": "Photos or high-res PNG showing completed work",
                    "status": "pending",
                }
            ],
        )
        payment = models.Payment(
            project_id=project.id,
            amount=300.0,
            paypal_order_id=f"ORD-PERSIST-{uid}",
            authorization_id=f"AUTH-PERSIST-{uid}",
            paypal_authorization_id=f"AUTH-PERSIST-{uid}",
            status=models.PaymentStatus.AUTHORIZED,
        )
        self.db.add_all([agreement, payment])
        self.db.commit()
        return project.id

    def test_uploaded_evidence_survives_ephemeral_disk_wipe_across_all_endpoints(self):
        phys_id = self._create_funded_project(domain="physical", title="Custom Gold & Diamond Ring")
        dig_id = self._create_funded_project(domain="digital", title="SaaS Logo & Brand Kit")

        cam_bytes = _make_image_bytes("JPEG", color=(180, 120, 40)) + uuid.uuid4().bytes
        res_batch = self.client.post(
            f"/api/projects/{phys_id}/evidence-batch",
            data={
                "capture_method": "live_camera",
                "evidence_type": "milestone_evidence",
                "milestone_index": "0",
            },
            files=[("files", ("live_capture_angle1.jpg", io.BytesIO(cam_bytes), "image/jpeg"))],
        )
        self.assertEqual(res_batch.status_code, 200, res_batch.text)
        batch_path = res_batch.json()["items"][0]["file_path"]
        batch_filename = batch_path.rsplit("/", 1)[-1]
        disk_batch_file = os.path.join(UPLOAD_DIR, batch_filename)
        self.created_disk_paths.append(disk_batch_file)
        self.assertTrue(os.path.isfile(disk_batch_file))

        # Digital upload with extensionless filename and legacy image/jpg MIME
        dig_bytes = _make_image_bytes("JPEG", color=(20, 90, 200)) + uuid.uuid4().bytes
        res_single = self.client.post(
            f"/api/projects/{dig_id}/evidence",
            data={
                "capture_method": "file_upload",
                "evidence_type": "milestone_evidence",
                "milestone_index": "0",
            },
            files={"file": ("blob", io.BytesIO(dig_bytes), "image/jpg")},
        )
        self.assertEqual(res_single.status_code, 200, res_single.text)
        single_path = res_single.json()["file_path"]
        self.assertTrue(single_path.endswith(".jpg"), single_path)
        single_filename = single_path.rsplit("/", 1)[-1]
        disk_single_file = os.path.join(UPLOAD_DIR, single_filename)
        self.created_disk_paths.append(disk_single_file)

        # Milestone alias upload endpoint
        ms_bytes = _make_image_bytes("PNG", color=(90, 40, 160)) + uuid.uuid4().bytes
        res_ms = self.client.post(
            f"/api/milestones/{dig_id}_0/submit-evidence",
            data={"capture_method": "file_upload"},
            files={"file": ("deliverable.png", io.BytesIO(ms_bytes), "image/png")},
        )
        self.assertEqual(res_ms.status_code, 200, res_ms.text)
        ms_path = res_ms.json()["file_path"]
        ms_filename = ms_path.rsplit("/", 1)[-1]
        disk_ms_file = os.path.join(UPLOAD_DIR, ms_filename)
        self.created_disk_paths.append(disk_ms_file)

        # Verify deferred column stays unloaded on normal metadata query
        ev_meta = (
            self.db.query(models.Evidence)
            .filter(models.Evidence.file_path == batch_path)
            .first()
        )
        self.assertIn("file_data", inspect(ev_meta).unloaded)

        # Simulate Render container deploy / ephemeral disk wipe
        for fpath in (disk_batch_file, disk_single_file, disk_ms_file):
            os.remove(fpath)
            self.assertFalse(os.path.isfile(fpath))

        # Downloads must restore the exact original bytes from PostgreSQL and re-warm disk
        for fname, expected_bytes, expected_mime in (
            (batch_filename, cam_bytes, "image/jpeg"),
            (single_filename, dig_bytes, "image/jpeg"),
            (ms_filename, ms_bytes, "image/png"),
        ):
            dl = self.client.get(f"/api/evidence/download/{fname}")
            self.assertEqual(dl.status_code, 200)
            self.assertEqual(dl.headers.get("content-type", "").split(";")[0], expected_mime)
            self.assertIn("inline", dl.headers.get("content-disposition", ""))
            self.assertEqual(dl.content, expected_bytes)
            self.assertTrue(os.path.isfile(os.path.join(UPLOAD_DIR, fname)))

    def test_legacy_missing_file_returns_valid_xml_svg_without_entity_errors(self):
        p_id = self._create_funded_project(
            domain="physical",
            title='AT&T <Gold & "Silver"> Ring & Co',
        )
        missing_name = f"legacy_missing_{uuid.uuid4().hex[:8]}.jpg"
        legacy_ev = models.Evidence(
            project_id=p_id,
            capture_method=models.CaptureMethod.LIVE_CAMERA,
            evidence_type="milestone_evidence",
            milestone_index=0,
            file_path=f"/uploads/{missing_name}",
            file_hash="a1b2c3d4e5f607089911223344556677",
            original_filename=missing_name,
            mime_type="image/jpeg",
            file_size=1234,
            ai_confidence_score=87,
        )
        self.db.add(legacy_ev)
        self.db.commit()

        dl = self.client.get(f"/api/evidence/download/{missing_name}")
        self.assertEqual(dl.status_code, 200)
        self.assertEqual(dl.headers.get("content-type", "").split(";")[0], "image/svg+xml")
        self.assertNotIn("&bull;", dl.text)
        self.assertIn("87% Match", dl.text)

        # Must parse strictly as valid XML (Safari/Chrome error "Entity 'bull' not defined" must not happen)
        parsed = ET.fromstring(dl.text)
        self.assertTrue(parsed.tag.endswith("svg"))

    def test_non_ascii_filename_and_prefix_variants_from_db_blob(self):
        p_id = self._create_funded_project(domain="digital", title="International Design Pack")
        fname = f"db_blob_{uuid.uuid4().hex[:8]}.png"
        png_bytes = _make_image_bytes("PNG", color=(12, 140, 210))
        self.created_disk_paths.append(os.path.join(UPLOAD_DIR, fname))

        ev = models.Evidence(
            project_id=p_id,
            capture_method=models.CaptureMethod.FILE_UPLOAD,
            evidence_type="milestone_evidence",
            milestone_index=0,
            file_path=f"backend/uploads/{fname}",
            file_data=png_bytes,
            file_hash=uuid.uuid4().hex,
            original_filename="résumé_mockup_🎨.png",
            mime_type="binary/octet-stream",
            file_size=len(png_bytes),
            ai_confidence_score=96,
        )
        self.db.add(ev)
        self.db.commit()

        dl = self.client.get(f"/api/evidence/download/{fname}")
        self.assertEqual(dl.status_code, 200)
        self.assertEqual(dl.headers.get("content-type", "").split(";")[0], "image/png")
        self.assertIn("inline", dl.headers.get("content-disposition", ""))
        self.assertIn("filename*=", dl.headers.get("content-disposition", ""))
        self.assertEqual(dl.content, png_bytes)

    def test_run_migrations_adds_file_data_column(self):
        temp_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        with temp_engine.connect() as conn:
            conn.execute(text("CREATE TABLE evidence (id INTEGER PRIMARY KEY, file_path VARCHAR);"))
            conn.commit()
        run_migrations(temp_engine)
        cols = [c["name"] for c in inspect(temp_engine).get_columns("evidence")]
        self.assertIn("file_data", cols)

    def test_run_migrations_postgres_file_data_isolated_from_optional_update_errors(self):
        temp_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        with temp_engine.connect() as conn:
            conn.execute(
                text(
                    "CREATE TABLE evidence ("
                    "id INTEGER PRIMARY KEY, "
                    "file_path VARCHAR, "
                    "file_hash VARCHAR, "
                    "status VARCHAR, "
                    "ai_confidence_score INTEGER, "
                    "fraud_flags TEXT, "
                    "ai_analysis_notes TEXT);"
                )
            )
            conn.execute(
                text("CREATE TABLE payments (id INTEGER PRIMARY KEY, authorization_id VARCHAR);")
            )
            conn.execute(
                text(
                    "INSERT INTO evidence (id, file_path, file_hash, status) "
                    "VALUES (1, '/uploads/test.jpg', 'cff83da41234', 'VERIFIED');"
                )
            )
            conn.execute(
                text(
                    "CREATE TRIGGER abort_enum_update BEFORE UPDATE ON evidence "
                    "BEGIN SELECT RAISE(ABORT, 'simulated invalid enum update'); END;"
                )
            )
            conn.commit()

        events_log = []
        observed_pg_ddl = []

        @event.listens_for(temp_engine, "before_cursor_execute", retval=True)
        def _intercept_sql(conn, cursor, statement, parameters, context, executemany):
            events_log.append(("sql", statement.strip()))
            if "ADD COLUMN IF NOT EXISTS file_data BYTEA" in statement:
                observed_pg_ddl.append(statement.strip())
                return statement.replace("IF NOT EXISTS ", "").replace("BYTEA", "BLOB"), parameters
            return statement, parameters

        @event.listens_for(temp_engine, "commit")
        def _on_commit(conn):
            events_log.append(("commit", ""))

        @event.listens_for(temp_engine, "rollback")
        def _on_rollback(conn):
            events_log.append(("rollback", ""))

        orig_dialect_name = temp_engine.dialect.name
        temp_engine.dialect.name = "postgresql"
        try:
            run_migrations(temp_engine)
        finally:
            temp_engine.dialect.name = orig_dialect_name

        self.assertEqual(
            observed_pg_ddl,
            ["ALTER TABLE evidence ADD COLUMN IF NOT EXISTS file_data BYTEA;"],
        )

        # Verify file_data DDL was committed BEFORE the failing UPDATE evidence ran,
        # and rollback cleared the failed optional UPDATE without starving later tables.
        ddl_idx = next(i for i, (kind, msg) in enumerate(events_log) if kind == "sql" and "file_data" in msg)
        update_idx = next(i for i, (kind, msg) in enumerate(events_log) if kind == "sql" and "UPDATE evidence" in msg)
        commit_between = any(kind == "commit" for kind, _ in events_log[ddl_idx + 1 : update_idx])
        rollback_after_update = any(kind == "rollback" for kind, _ in events_log[update_idx + 1 :])
        self.assertTrue(commit_between, f"Expected commit before UPDATE evidence: {events_log}")
        self.assertTrue(rollback_after_update, f"Expected rollback after failed UPDATE: {events_log}")

        evidence_cols = [c["name"] for c in inspect(temp_engine).get_columns("evidence")]
        payment_cols = [c["name"] for c in inspect(temp_engine).get_columns("payments")]
        self.assertIn("file_data", evidence_cols)
        self.assertIn("paypal_authorization_id", payment_cols)

    def test_run_migrations_fails_fast_if_file_data_still_missing(self):
        from unittest.mock import patch

        temp_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        with temp_engine.connect() as conn:
            conn.execute(text("CREATE TABLE evidence (id INTEGER PRIMARY KEY, file_path VARCHAR);"))
            conn.commit()

        class _FakeInspector:
            def __init__(self, real_insp):
                self._real = real_insp

            def get_table_names(self):
                return self._real.get_table_names()

            def get_columns(self, table_name):
                cols = self._real.get_columns(table_name)
                if table_name == "evidence":
                    return [c for c in cols if c["name"] != "file_data"]
                return cols

        real_inspect = inspect

        def _fake_inspect(subject):
            return _FakeInspector(real_inspect(subject))

        with patch("sqlalchemy.inspect", side_effect=_fake_inspect):
            with self.assertRaises(RuntimeError) as ctx:
                run_migrations(temp_engine)
        self.assertIn("file_data", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
