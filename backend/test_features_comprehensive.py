import os
import sys

# Ensure backend path is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from datetime import datetime, date, timedelta
from fastapi.testclient import TestClient

import main
from main import app, determine_requires_baseline_evidence, calculate_milestone_deadlines, apply_negotiated_deadlines
from database import SessionLocal
import models

# Disable Gemini key during automated tests to test instant fallback without network delays
main.os.environ["GEMINI_API_KEY"] = ""

client = TestClient(app)

def test_ai_classification_logic():
    print("\n--- Test 1: Baseline Evidence Classification Logic ---")
    # Asset modifications should require baseline evidence
    assert determine_requires_baseline_evidence("Master Bathroom Renovation", "home renovation", "drywall patch and painting") == True
    assert determine_requires_baseline_evidence("Kitchen Plumbing Repair", "plumbing", "fix sink leak and replace pipes") == True
    assert determine_requires_baseline_evidence("Dining Chair Restoration & Re-upholstery", "furniture repair", "repair broken leg and re-varnish") == True
    
    # Scratch crafts should not require baseline evidence
    assert determine_requires_baseline_evidence("Custom Silver Ring from Scratch", "jewelry", "cast brand new sterling silver ring from raw molten metal") == False
    assert determine_requires_baseline_evidence("Walnut Dining Table Built from Raw Timber", "woodworking", "fabricate table from scratch using rough-sawn lumber") == False
    print("✅ Asset modification vs Built from scratch logic verified")

def test_milestone_deadlines_from_start():
    print("\n--- Test 2: Milestone Deadlines from the Very Start ---")
    target_dl = (date.today() + timedelta(days=14)).strftime("%Y-%m-%d")
    deadlines = calculate_milestone_deadlines(target_dl, num_milestones=3)
    assert len(deadlines) == 3
    assert all(isinstance(d, str) and len(d) == 10 for d in deadlines)
    assert deadlines[0] < deadlines[1] <= deadlines[2]
    print(f"✅ Generated sequential intermediate deadlines from start: {deadlines}")

def test_milestone_deadline_negotiation():
    print("\n--- Test 3: Negotiating Milestone Deadlines ---")
    initial_deadlines = [(date.today() + timedelta(days=5)).strftime("%Y-%m-%d"),
                         (date.today() + timedelta(days=10)).strftime("%Y-%m-%d"),
                         (date.today() + timedelta(days=15)).strftime("%Y-%m-%d")]
    milestones = [
        {"title": "M1 Prep", "price_allocation": 100.0, "proof_required": "photos", "deadline": initial_deadlines[0]},
        {"title": "M2 Plumbing", "price_allocation": 100.0, "proof_required": "video", "deadline": initial_deadlines[1]},
        {"title": "M3 Painting", "price_allocation": 100.0, "proof_required": "photos", "deadline": initial_deadlines[2]}
    ]
    target_dl = (date.today() + timedelta(days=15)).strftime("%Y-%m-%d")
    
    # 3.1: Seller asks "wat are the milestone deadlines", Buyer says "set deadlines for each milestone"
    # The deadlines MUST CHANGE after negotiation!
    updated_ms, changed = apply_negotiated_deadlines(
        milestones,
        seller_request="wat are the milestone deadlines",
        buyer_response="set deadlines for each milestone",
        project_deadline=target_dl
    )
    assert changed == True
    assert all(m.get("deadline") for m in updated_ms)
    # Verify that the deadlines actually changed from initial
    assert updated_ms[0]["deadline"] != initial_deadlines[0]
    print(f"✅ 'set deadlines for each milestone' changed deadlines: {initial_deadlines} -> {[m['deadline'] for m in updated_ms]}")
    
    # 3.2: User says: "push milestone 2 to Nov 15"
    updated_ms2, changed2 = apply_negotiated_deadlines(
        updated_ms,
        seller_request="can we push milestone 2 to Nov 15?",
        buyer_response="sure, milestone 2 Nov 15 approved",
        project_deadline=target_dl
    )
    assert changed2 == True
    assert updated_ms2[1]["deadline"] == "2026-11-15"
    print(f"✅ Explicit date negotiation applied to Milestone 2: {updated_ms2[1]['deadline']}")

    # 3.3: User says: "extend by 1 week"
    m1_before = updated_ms2[0]["deadline"]
    updated_ms3, changed3 = apply_negotiated_deadlines(
        updated_ms2,
        seller_request="need more time",
        buyer_response="extend by 1 week",
        project_deadline=target_dl
    )
    assert changed3 == True
    d_before = datetime.strptime(m1_before, "%Y-%m-%d").date()
    d_after = datetime.strptime(updated_ms3[0]["deadline"], "%Y-%m-%d").date()
    assert (d_after - d_before).days == 7
    print(f"✅ Relative extension applied: M1 extended by 7 days to {updated_ms3[0]['deadline']}")

    # 3.4: Full End-to-End API test for regenerate-agreement
    db = SessionLocal()
    proj = models.Project(
        title="Bathroom Renovation Test",
        industry_type="home renovation",
        description="Demo renovation",
        total_price=600.0,
        deadline=(date.today() + timedelta(days=14)).strftime("%Y-%m-%d"),
        status=models.ProjectStatus.NEGOTIATING
    )
    db.add(proj)
    db.commit()
    db.refresh(proj)

    agr = models.Agreement(
        project_id=proj.id,
        milestones=milestones,
        latest_seller_message="wat are the milestone deadlines",
        version=1
    )
    db.add(agr)
    db.commit()
    db.refresh(agr)

    regen_res = client.post(f"/api/projects/{proj.id}/regenerate-agreement", json={
        "buyer_response": "set deadlines for each milestone"
    })
    assert regen_res.status_code == 200
    regen_data = regen_res.json()
    new_milestones = regen_data["milestones"]
    assert new_milestones[0]["deadline"] != initial_deadlines[0]
    assert "Milestone delivery deadlines updated" in regen_data["summary_of_changes"]
    assert "Target Due Date:" in regen_data["contract_terms"]
    print("✅ POST /api/projects/{id}/regenerate-agreement successfully changed milestone deadlines and updated terms!")
    db.close()

def test_buyer_evidence_gating_api():
    print("\n--- Test 4: Buyer Evidence Gating Endpoints ---")
    # Create a renovation project
    init_res = client.post("/api/projects/init", json={
        "title": "Master Bathroom Renovation & Plumbing",
        "industry_type": "home renovation",
        "description": "Renovate bathroom walls, install vanity sink, and paint with moisture-resistant finish",
        "total_price": 500.0,
        "deadline": (date.today() + timedelta(days=14)).strftime("%Y-%m-%d"),
        "buyer_email": "renovation_buyer@test.com"
    })
    assert init_res.status_code == 200
    p_id = init_res.json()["project_id"]

    # Initial draft chat
    chat_res = client.post(f"/api/projects/{p_id}/draft-chat", json={"user_message": "All 4 walls need prep and ivory paint"})
    assert chat_res.status_code == 200
    data = chat_res.json()
    assert data["requires_baseline_evidence"] == True
    print(f"✅ draft-chat returned requires_baseline_evidence=True for project #{p_id}")

    # Verify project in DB has requires_baseline_evidence = True
    db = SessionLocal()
    proj = db.query(models.Project).filter(models.Project.id == p_id).first()
    assert proj.requires_baseline_evidence == True
    db.close()

    # Try declaring exemption on a project that requires baseline evidence
    exempt_res = client.post(f"/api/projects/{p_id}/declare-before-exemption")
    assert exempt_res.status_code == 400
    print(f"✅ Exemption successfully blocked with 400: '{exempt_res.json()['detail']}'")

    # Try finalizing draft without before evidence
    finalize_res = client.post(f"/api/projects/{p_id}/finalize-draft", json={
        "milestones": data.get("milestones", [])
    })
    assert finalize_res.status_code == 400
    print("✅ Finalizing draft without before-evidence blocked with 400")

def test_milestone_deadline_alerts_endpoint():
    print("\n--- Test 5: Milestone Deadline Approaching Alerts (Phase 4) ---")
    # Create active project with active milestone due tomorrow (within 48 hours)
    db = SessionLocal()
    tomorrow_str = (date.today() + timedelta(days=1)).strftime("%Y-%m-%d")
    
    test_proj = models.Project(
        title="Urgent Custom Cabinetry",
        industry_type="custom furniture",
        description="Cabinet assembly and delivery",
        total_price=800.0,
        deadline=tomorrow_str,
        status=models.ProjectStatus.ACCEPTED
    )
    db.add(test_proj)
    db.commit()
    db.refresh(test_proj)

    agreement = models.Agreement(
        project_id=test_proj.id,
        milestones=[
            {
                "title": "M1 Dimensioning & Milling",
                "description": "Mill oak lumber",
                "price_allocation": 300.0,
                "deadline": tomorrow_str,
                "proof_required": "Photos of dimensioned timber"
            },
            {
                "title": "M2 Final Assembly",
                "description": "Glue-up and finish",
                "price_allocation": 500.0,
                "deadline": (date.today() + timedelta(days=5)).strftime("%Y-%m-%d"),
                "proof_required": "Photos of completed cabinets"
            }
        ],
        version=1
    )
    db.add(agreement)
    db.commit()

    # Test alerts endpoint
    alert_res = client.get(f"/api/projects/{test_proj.id}/alerts")
    assert alert_res.status_code == 200
    alert_data = alert_res.json()
    assert alert_data["has_alert"] == True
    assert alert_data["alert_type"] == "deadline_approaching"
    assert "Warning: Milestone deadline is approaching on" in alert_data["message"]
    assert "Please capture your evidence and submit it for buyer review." in alert_data["message"]
    print(f"✅ GET /api/projects/{test_proj.id}/alerts returned active warning alert:")
    print(f"   Message: {alert_data['message']}")
    print(f"   Hours remaining: {alert_data['hours_remaining']}h")

    # Test contractor global alerts
    contractor_res = client.get("/api/contractor/active-alerts")
    assert contractor_res.status_code == 200
    alerts_list = contractor_res.json().get("alerts", [])
    assert any(a["project_id"] == test_proj.id for a in alerts_list)
    print(f"✅ GET /api/contractor/active-alerts returned {len(alerts_list)} active alerts across contractor projects")
    db.close()

if __name__ == "__main__":
    print("RUNNING PROOFFLOW COMPREHENSIVE INTEGRATION TESTS...")
    test_ai_classification_logic()
    test_milestone_deadlines_from_start()
    test_milestone_deadline_negotiation()
    test_buyer_evidence_gating_api()
    test_milestone_deadline_alerts_endpoint()
    print("\n🎉 ALL COMPREHENSIVE TESTS PASSED SUCCESSFULLY! 🎉\n")
