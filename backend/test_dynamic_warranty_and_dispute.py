import unittest
import os
import json
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from database import SessionLocal, engine, Base
import models
from main import app, get_db
import ai_service

class TestDynamicWarrantyAndDispute(unittest.TestCase):
    def setUp(self):
        models.Base.metadata.create_all(bind=engine)
        self.db = SessionLocal()
        self.client = TestClient(app)

    def tearDown(self):
        self.db.close()

    def test_dynamic_warranty_determination(self):
        # Physical project
        w_phys = ai_service.determine_warranty_days("Custom Oak Dining Table", "Carpentry", "Handcrafted solid oak dining table", "physical")
        self.assertEqual(w_phys, 14)

        # Digital simple asset (logo, branding)
        w_logo = ai_service.determine_warranty_days("Brand logo redesign", "Digital Art", "Vector brand identity and icon suite", "digital")
        self.assertEqual(w_logo, 0)
        w_website_redesign = ai_service.determine_warranty_days("Website redesign", "Web Design", "Refresh colors and typography", "digital")
        self.assertEqual(w_website_redesign, 0)
        w_website_creation = ai_service.determine_warranty_days("Website creation", "Web Design", "Build a new client website", "digital")
        self.assertEqual(w_website_creation, 7)

        # Digital complex software
        w_soft = ai_service.determine_warranty_days("FinTech Mobile Payment App", "Software Development", "React Native iOS and Android banking app", "digital")
        self.assertEqual(w_soft, 7)

    def test_final_milestone_approval_with_zero_warranty_days(self):
        # Create project with 0 warranty days
        project = models.Project(
            title="Logo Design Simple Payout",
            industry_type="Digital Art",
            description="Vector logo deliverable",
            total_price=300.0,
            project_domain="digital",
            status=models.ProjectStatus.ACTIVE,
            captured_amount=0.0
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        milestones = [
            {"title": "M1", "price_allocation": 150.0, "status": "approved"},
            {"title": "M2", "price_allocation": 150.0, "status": "pending"}
        ]
        agreement = models.Agreement(
            project_id=project.id,
            version=1,
            status="ACTIVE",
            milestones=milestones,
            lock_in_type="NONE",
            lock_in_amount=0.0,
            lock_in_days=0,
            warranty_days=0
        )
        self.db.add(agreement)
        self.db.commit()

        # Approve final milestone (index 1)
        res = self.client.post(f"/api/milestones/{project.id}_1/approve")
        self.assertEqual(res.status_code, 200)

        self.db.refresh(project)
        self.db.refresh(agreement)
        self.assertEqual(project.status, models.ProjectStatus.COMPLETED)
        self.assertEqual(agreement.status, "COMPLETED")
        self.assertEqual(agreement.warranty_days, 0)

    def test_final_milestone_approval_with_positive_warranty_days(self):
        # Create physical project with 14 warranty days
        project = models.Project(
            title="Kitchen Cabinet Installation",
            industry_type="Carpentry",
            description="Custom cabinetry installation",
            total_price=400.0,
            project_domain="physical",
            status=models.ProjectStatus.ACTIVE,
            captured_amount=0.0
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        milestones = [
            {"title": "M1", "price_allocation": 200.0, "status": "approved"},
            {"title": "M2", "price_allocation": 200.0, "status": "pending"}
        ]
        agreement = models.Agreement(
            project_id=project.id,
            version=1,
            status="ACTIVE",
            milestones=milestones,
            lock_in_type="FINAL_MILESTONE",
            lock_in_amount=200.0,
            lock_in_days=14,
            warranty_days=14
        )
        self.db.add(agreement)
        self.db.commit()

        # Approve final milestone (index 1)
        res = self.client.post(f"/api/milestones/{project.id}_1/approve")
        self.assertEqual(res.status_code, 200)

        self.db.refresh(project)
        self.db.refresh(agreement)
        self.assertEqual(project.status, models.ProjectStatus.WARRANTY_PERIOD)
        self.assertEqual(agreement.status, "WARRANTY_PERIOD")
        self.assertEqual(agreement.warranty_days, 14)
        self.assertIsNotNone(agreement.warranty_end_date)

    def test_dynamic_retainage_update_on_scope_addendum(self):
        # Project originally 3 milestones with FINAL_MILESTONE retainage of 90
        project = models.Project(
            title="Brand logo redesign",
            industry_type="Digital Art",
            description="Vector logo",
            total_price=300.0,
            project_domain="digital",
            status=models.ProjectStatus.ACTIVE
        )
        self.db.add(project)
        self.db.commit()
        self.db.refresh(project)

        ag1 = models.Agreement(
            project_id=project.id,
            version=1,
            status="ACTIVE",
            milestones=[
                {"title": "M1", "price_allocation": 90.0, "status": "approved"},
                {"title": "M2", "price_allocation": 120.0, "status": "approved"},
                {"title": "M3", "price_allocation": 90.0, "status": "approved"},
            ],
            lock_in_type="FINAL_MILESTONE",
            lock_in_amount=90.0,
            lock_in_days=14,
            warranty_days=14
        )
        self.db.add(ag1)
        self.db.commit()

        # Addendum adds Milestone 4 for $5.00
        ag2 = models.Agreement(
            project_id=project.id,
            version=2,
            status="ACTIVE",
            milestones=[
                {"title": "M1", "price_allocation": 90.0, "status": "approved"},
                {"title": "M2", "price_allocation": 120.0, "status": "approved"},
                {"title": "M3", "price_allocation": 90.0, "status": "approved"},
                {"title": "M4 Addendum", "price_allocation": 5.0, "status": "pending"},
            ],
            lock_in_type="FINAL_MILESTONE",
            lock_in_amount=5.0,
            lock_in_days=14,
            warranty_days=14
        )
        ag1.status = "SUPERSEDED"
        self.db.add(ag2)
        project.total_price = 305.0
        self.db.commit()

        # Fetch project by ID and verify retainage amount tracked to $5.00
        res = self.client.get(f"/api/projects/{project.id}")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["agreement"]["lock_in_amount"], 5.0)
        self.assertEqual(data["project"]["status"], "active")

if __name__ == "__main__":
    unittest.main()
