import unittest
from unittest.mock import patch
import os
import io
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models
from database import Base
from main import app, get_db, calculate_gps_distance_meters, verify_physical_evidence_location

TEST_SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    TEST_SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class TestLocationTracking(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["GEMINI_API_KEY"] = ""
        Base.metadata.create_all(bind=engine)

    @classmethod
    def tearDownClass(cls):
        Base.metadata.drop_all(bind=engine)

    def setUp(self):
        self.db = TestingSessionLocal()
        def override_get_db():
            try:
                yield self.db
            finally:
                pass
        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

    def tearDown(self):
        self.db.rollback()
        self.db.close()
        app.dependency_overrides.clear()

    def test_haversine_distance_computation(self):
        # Exact same point: 0 meters
        loc1 = "37.774929,-122.419416"
        self.assertAlmostEqual(calculate_gps_distance_meters(loc1, loc1), 0.0, places=1)

        # Null or invalid input returns None
        self.assertIsNone(calculate_gps_distance_meters(None, loc1))
        self.assertIsNone(calculate_gps_distance_meters("invalid", loc1))

        # Approx 111 meters North (0.001 deg latitude difference)
        loc2 = "37.775929,-122.419416"
        dist = calculate_gps_distance_meters(loc1, loc2)
        self.assertIsNotNone(dist)
        self.assertGreater(dist, 105.0)
        self.assertLess(dist, 115.0)

        # Approx 1.11 km North
        loc3 = "37.784929,-122.419416"
        dist_km = calculate_gps_distance_meters(loc1, loc3)
        self.assertIsNotNone(dist_km)
        self.assertGreater(dist_km, 1100.0)
        self.assertLess(dist_km, 1120.0)

    def test_verify_physical_evidence_location_onsite(self):
        project = models.Project(
            title="Kitchen Remodel & Cabinet Refinishing",
            industry_type="Home Renovation",
            description="Full kitchen renovation including tile backsplash and cabinetry",
            total_price=5000.0,
            project_domain="physical",
            is_renovation=True,
            requires_baseline_evidence=True
        )
        buyer_before_ev = models.Evidence(
            evidence_type="before_evidence",
            location="37.774929,-122.419416"
        )
        # Contractor capture 40 meters away (well within 250m tolerance)
        contractor_loc = "37.775200,-122.419416"
        res = verify_physical_evidence_location(project, contractor_loc, buyer_before_ev)
        self.assertEqual(res["status"], "verified")
        self.assertFalse(res["is_mismatch"])
        self.assertEqual(len(res["flags"]), 0)
        self.assertIn("On-site live capture", res["note"])
        self.assertLess(res["distance_meters"], 50)

    def test_verify_physical_evidence_location_offsite_mismatch(self):
        project = models.Project(
            title="Master Bathroom Renovation",
            industry_type="Home Renovation",
            description="Complete tile re-grouting and walk-in shower installation",
            total_price=3500.0,
            project_domain="physical",
            is_renovation=True,
            requires_baseline_evidence=True
        )
        buyer_before_ev = models.Evidence(
            evidence_type="before_evidence",
            location="37.774929,-122.419416"
        )
        # Contractor capture 1.5 km away (outside 250m radius)
        contractor_loc = "37.788500,-122.419416"
        res = verify_physical_evidence_location(project, contractor_loc, buyer_before_ev)
        self.assertEqual(res["status"], "mismatch")
        self.assertTrue(res["is_mismatch"])
        self.assertEqual(len(res["flags"]), 1)
        self.assertIn("Geographic Proximity Mismatch", res["flags"][0])
        self.assertIn("OFF-SITE CAPTURE DETECTED", res["note"])
        self.assertGreater(res["distance_meters"], 1400)

    def test_verify_physical_evidence_missing_gps(self):
        project = models.Project(
            title="Living Room Hardwood Flooring",
            industry_type="Home Renovation",
            description="Installing solid oak hardwood floors",
            total_price=4200.0,
            project_domain="physical",
            is_renovation=True,
            requires_baseline_evidence=True
        )
        buyer_before_ev = models.Evidence(
            evidence_type="before_evidence",
            location="37.774929,-122.419416"
        )
        # Contractor does not submit location
        res = verify_physical_evidence_location(project, None, buyer_before_ev)
        self.assertEqual(res["status"], "missing_contractor_gps")
        self.assertTrue(res["is_mismatch"])
        self.assertIn("GPS Location Missing", res["flags"][0])

    def test_verify_digital_project_exempt(self):
        project = models.Project(
            title="Brand logo redesign",
            industry_type="Digital Art",
            description="Vector logo redesign",
            total_price=300.0,
            project_domain="digital"
        )
        res = verify_physical_evidence_location(project, "37.774929,-122.419416", None)
        self.assertEqual(res["status"], "exempt_digital")
        self.assertFalse(res["is_mismatch"])

    def test_evidence_batch_api_with_onsite_and_offsite_gps(self):
        buyer = models.User(email="buyer_geo@example.com", password_hash="pw", full_name="Buyer Geo", role_type="buyer")
        seller = models.User(email="seller_geo@example.com", password_hash="pw", full_name="Seller Geo", role_type="seller")
        self.db.add_all([buyer, seller])
        self.db.commit()

        project = models.Project(
            buyer_id=buyer.id,
            seller_id=seller.id,
            title="Basement Waterproofing & Finish",
            industry_type="Home Renovation",
            description="Subfloor waterproofing and wall insulation",
            total_price=6000.0,
            project_domain="physical",
            is_renovation=True,
            requires_baseline_evidence=True
        )
        self.db.add(project)
        self.db.commit()

        # Buyer registers baseline before-evidence
        baseline_file = io.BytesIO(b"fake_baseline_photo_bytes")
        baseline_file.name = "basement_before.jpg"
        buyer_gps = "37.774929,-122.419416"
        resp_base = self.client.post(
            f"/api/projects/{project.id}/evidence-batch",
            data={
                "capture_method": "live_camera",
                "evidence_type": "before_evidence",
                "location": buyer_gps
            },
            files=[("files", ("basement_before.jpg", baseline_file, "image/jpeg"))]
        )
        self.assertEqual(resp_base.status_code, 200)
        self.assertEqual(resp_base.json()["total_uploaded"], 1)

        # Seller submits milestone evidence with on-site GPS (25m away)
        onsite_gps = "37.775100,-122.419416"
        proof_file_1 = io.BytesIO(b"fake_milestone_photo_bytes_1")
        proof_file_1.name = "waterproof_seal.jpg"
        resp_onsite = self.client.post(
            f"/api/projects/{project.id}/evidence-batch",
            data={
                "capture_method": "live_camera",
                "evidence_type": "milestone_evidence",
                "milestone_index": 0,
                "location": onsite_gps
            },
            files=[("files", ("waterproof_seal.jpg", proof_file_1, "image/jpeg"))]
        )
        self.assertEqual(resp_onsite.status_code, 200)
        onsite_data = resp_onsite.json()
        self.assertEqual(onsite_data["overall_status"], "verified")
        self.assertFalse(onsite_data["has_fraud_flags"])

        # Seller submits another frame from 3.2 km away (off-site mismatch)
        offsite_gps = "37.804000,-122.419416"
        proof_file_2 = io.BytesIO(b"fake_milestone_photo_bytes_2")
        proof_file_2.name = "subfloor_remote.jpg"
        resp_offsite = self.client.post(
            f"/api/projects/{project.id}/evidence-batch",
            data={
                "capture_method": "live_camera",
                "evidence_type": "milestone_evidence",
                "milestone_index": 0,
                "location": offsite_gps
            },
            files=[("files", ("subfloor_remote.jpg", proof_file_2, "image/jpeg"))]
        )
        self.assertEqual(resp_offsite.status_code, 200)
        offsite_data = resp_offsite.json()
        self.assertEqual(offsite_data["overall_status"], "possible_mismatch")
        self.assertTrue(offsite_data["has_fraud_flags"])
        self.assertTrue(any("Geographic Proximity Mismatch" in f for f in offsite_data["fraud_flags"]))

if __name__ == "__main__":
    unittest.main()
