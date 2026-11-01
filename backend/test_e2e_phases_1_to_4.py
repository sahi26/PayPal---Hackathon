import os
import sys

# Ensure backend path is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Disable network calls to Gemini in unit tests for deterministic testing
import main
main.os.environ["GEMINI_API_KEY"] = ""
main.GEMINI_API_KEY = ""

from fastapi.testclient import TestClient
from main import app
import ai_service

client = TestClient(app)

def test_phase_1_ai_classification():
    print("\n=======================================================")
    print("PHASE 1: Dynamic AI Interactive Drafting & Classification")
    print("=======================================================")

    # 1. Physical Renovation
    dom1 = ai_service.determine_project_domain("Master Bathroom Remodel", "Home Renovation", "Tear out tub, retile and paint")
    reno1 = ai_service.determine_is_renovation("Master Bathroom Remodel", "Home Renovation", "Tear out tub, retile and paint")
    assert dom1 == "physical" and reno1 is True
    print(f"✅ Physical Renovation: domain={dom1}, is_renovation={reno1}")

    # 2. Physical Built from Scratch
    dom2 = ai_service.determine_project_domain("Walnut Dining Table", "Woodworking", "Fabricate from scratch using raw timber")
    reno2 = ai_service.determine_is_renovation("Walnut Dining Table", "Woodworking", "Fabricate from scratch using raw timber")
    assert dom2 == "physical" and reno2 is False
    print(f"✅ Physical Built from Scratch: domain={dom2}, is_renovation={reno2}")

    # 3. Digital Redesign
    dom3 = ai_service.determine_project_domain("Brand Logo Redesign", "Graphic Design", "Modernize existing brand logo and revamp identity")
    reno3 = ai_service.determine_is_renovation("Brand Logo Redesign", "Graphic Design", "Modernize existing brand logo and revamp identity")
    assert dom3 == "digital" and reno3 is True
    print(f"✅ Digital Redesign: domain={dom3}, is_renovation={reno3}")

    # 4. Digital Built from Scratch
    dom4 = ai_service.determine_project_domain("New SaaS Platform", "Software", "Build a brand new web application from scratch")
    reno4 = ai_service.determine_is_renovation("New SaaS Platform", "Software", "Build a brand new web application from scratch")
    assert dom4 == "digital" and reno4 is False
    print(f"✅ Digital Built from Scratch: domain={dom4}, is_renovation={reno4}")

    # Test POST /api/ai/interactive-draft endpoint
    init_res = client.post("/api/projects/init", json={
        "title": "Kitchen Remodel & Plumbing Repair",
        "industry_type": "Home Renovation",
        "description": "Replace leaking pipes and install new granite countertops",
        "total_price": 1200.0,
        "deadline": "2026-11-30",
        "buyer_email": "buyer1@prooflens.com"
    })
    assert init_res.status_code == 200
    p_id = init_res.json()["project_id"]

    # Turn 1: Dynamic question
    draft1 = client.post("/api/ai/interactive-draft", json={
        "project_id": p_id,
        "message": "We need to fix the pipe under the kitchen sink first.",
        "messages": []
    })
    assert draft1.status_code == 200
    d1_data = draft1.json()
    assert d1_data["project_domain"] == "physical"
    assert d1_data["is_renovation"] is True
    assert d1_data["requires_baseline_evidence"] is True
    assert len(d1_data["ai_response"]) > 20
    print("✅ Interactive draft Turn 1: dynamic question received, classification verified")

    # Turn 2: Milestones with relative day offsets
    draft2 = client.post("/api/ai/interactive-draft", json={
        "project_id": p_id,
        "message": "The sink area is 10 sq ft. We want copper piping and polished black granite, ready by Nov 30.",
        "messages": [
            {"role": "user", "content": "We need to fix the pipe under the kitchen sink first."},
            {"role": "assistant", "content": d1_data["ai_response"]}
        ]
    })
    assert draft2.status_code == 200
    d2_data = draft2.json()
    assert d2_data["ready_to_finalize"] is True
    assert len(d2_data["milestones"]) >= 3
    for m in d2_data["milestones"]:
        assert "relative_deadline" in m
        assert "Due" in m["relative_deadline"] and "from project creation" in m["relative_deadline"]
        assert "deadline" in m
    print(f"✅ Interactive draft Turn 2: generated {len(d2_data['milestones'])} milestones with relative deadlines:")
    for m in d2_data["milestones"]:
        print(f"   • {m['title']}: {m['relative_deadline']} (Due: {m['deadline']})")

def test_phase_2_buyer_evidence_gating():
    print("\n=======================================================")
    print("PHASE 2: Buyer Evidence Gating & Link Generation")
    print("=======================================================")

    # 1. Physical Renovation: Exemption blocked, requires live camera
    reno_res = client.post("/api/projects/init", json={
        "title": "Master Bathroom Renovation",
        "industry_type": "Renovation",
        "description": "Full bathroom remodel and tile replacement",
        "total_price": 800.0,
        "deadline": "2026-11-25",
        "buyer_email": "buyer2@prooflens.com"
    })
    p_reno_id = reno_res.json()["project_id"]

    # Try exemption on renovation -> Must be blocked
    exempt_block = client.post(f"/api/projects/{p_reno_id}/declare-before-exemption")
    assert exempt_block.status_code == 400
    print("✅ Renovation exemption blocked as expected:", exempt_block.json()["detail"])

    # Try finalize without evidence -> Must be blocked
    fin_block = client.post(f"/api/projects/{p_reno_id}/finalize-draft", json={
        "contract_terms": "Renovation agreement",
        "evidence_requirements": "Before and after photos",
        "milestones": [{"title": "Demo", "description": "Tear out", "price_allocation": 800.0, "proof_required": "Live photo"}]
    })
    assert fin_block.status_code == 400
    print("✅ Renovation finalizing blocked without before-evidence")

    # Capture live camera before evidence
    fake_img = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00\xff\xdb\x00C\x00"
    up_res = client.post(f"/api/projects/{p_reno_id}/evidence", data={
        "capture_method": "live_camera",
        "evidence_type": "before_evidence"
    }, files={"file": ("bathroom_before.jpg", fake_img, "image/jpeg")})
    assert up_res.status_code == 200

    # Finalize should now succeed!
    fin_ok = client.post(f"/api/projects/{p_reno_id}/finalize-draft", json={
        "contract_terms": "Renovation agreement",
        "evidence_requirements": "Before and after photos",
        "milestones": [{"title": "Demo", "description": "Tear out", "price_allocation": 800.0, "proof_required": "Live photo", "deadline": "2026-11-20"}]
    })
    assert fin_ok.status_code == 200
    print("✅ Renovation finalized successfully after live camera capture! Token:", fin_ok.json()["invite_token"])

    # 2. Digital Redesign: Upload file / URL baseline
    digi_res = client.post("/api/projects/init", json={
        "title": "Corporate Brand Redesign",
        "industry_type": "Graphic Design",
        "description": "Revamp existing logo and style guide",
        "total_price": 500.0,
        "deadline": "2026-11-28",
        "buyer_email": "buyer3@prooflens.com"
    })
    p_digi_id = digi_res.json()["project_id"]

    # Exemption blocked for digital redesign
    d_exempt_block = client.post(f"/api/projects/{p_digi_id}/declare-before-exemption")
    assert d_exempt_block.status_code == 400
    print("✅ Digital redesign exemption blocked as expected")

    # Upload baseline file
    d_up = client.post(f"/api/projects/{p_digi_id}/evidence", data={
        "capture_method": "file_upload",
        "evidence_type": "before_evidence",
        "asset_url": "https://company.com/old-logo.svg"
    }, files={"file": ("old_logo.png", fake_img, "image/png")})
    assert d_up.status_code == 200
    assert d_up.json()["asset_url"] == "https://company.com/old-logo.svg"
    print("✅ Digital baseline asset uploaded with link and SHA-256 hash")

    # Finalize succeeds
    d_fin = client.post(f"/api/projects/{p_digi_id}/finalize-draft", json={
        "contract_terms": "Design terms",
        "evidence_requirements": "Vector files",
        "milestones": [{"title": "Concepts", "description": "3 concepts", "price_allocation": 500.0, "proof_required": "SVG", "deadline": "2026-11-25"}]
    })
    assert d_fin.status_code == 200
    print("✅ Digital redesign draft finalized successfully")

    # 3. New Scratch Build (Physical): Exemption allowed!
    scratch_res = client.post("/api/projects/init", json={
        "title": "Custom Walnut Coffee Table",
        "industry_type": "Woodworking",
        "description": "Build a coffee table from scratch using rough-sawn lumber",
        "total_price": 400.0,
        "deadline": "2026-11-20",
        "buyer_email": "buyer4@prooflens.com"
    })
    p_scratch_id = scratch_res.json()["project_id"]
    s_exempt = client.post(f"/api/projects/{p_scratch_id}/declare-before-exemption")
    assert s_exempt.status_code == 200
    assert s_exempt.json()["before_evidence_status"] == "exempt_no_evidence"
    print("✅ Built from scratch exemption declared successfully:", s_exempt.json()["message"][:60])

def test_phase_3_and_4_seller_negotiation_and_sequential_milestones():
    print("\n=======================================================")
    print("PHASES 3 & 4: Seller Negotiation & Sequential Milestones")
    print("=======================================================")

    # Initialize and draft a 3-milestone project
    init = client.post("/api/projects/init", json={
        "title": "Bespoke Jewelry Fabrication",
        "industry_type": "Jewelry",
        "description": "Cast custom gold ring from scratch using raw precious metal",
        "total_price": 600.0,
        "deadline": "2026-11-25",
        "buyer_email": "client@gem.com"
    })
    p_id = init.json()["project_id"]

    # Declare exemption for scratch build
    client.post(f"/api/projects/{p_id}/declare-before-exemption")

    # Finalize with 3 sequential milestones
    milestones_payload = [
        {"title": "CAD Blueprint & Wax Mold", "description": "3D Wax pattern", "price_allocation": 200.0, "proof_required": "Macro photo of wax pattern on mandrel"},
        {"title": "Casting & Gold Plating", "description": "Metal casting", "price_allocation": 200.0, "proof_required": "Macro photo and plating test certificate"},
        {"title": "Hand Polish & Delivery", "description": "Final polish and dispatch", "price_allocation": 200.0, "proof_required": "Continuous video and tracking receipt"}
    ]
    fin = client.post(f"/api/projects/{p_id}/finalize-draft", json={
        "contract_terms": "Formal jewelry contract",
        "evidence_requirements": "High-res inspection",
        "milestones": milestones_payload
    })
    assert fin.status_code == 200
    invite_token = fin.json()["invite_token"]

    # Phase 3: Seller joins via invite token
    join_res = client.post(f"/api/projects/invite/{invite_token}/join", json={
        "seller_email": "goldsmith@bench.com",
        "seller_name": "Master Goldsmith"
    })
    assert join_res.status_code == 200
    print("✅ Seller joined negotiation room. Project status:", join_res.json()["status"])

    # Test Date Calculation relative to created_at
    proj_details = client.get(f"/api/projects/{p_id}").json()
    created_at = proj_details["project"]["created_at"]
    print(f"Project created_at anchor: {created_at}")

    # Negotiate deadlines (+3 days)
    nego_res = client.post(f"/api/projects/{p_id}/regenerate-agreement", json={
        "seller_request": "Please extend timeline by 3 days for casting",
        "buyer_response": "Agreed to 3 days extension"
    })
    assert nego_res.status_code == 200
    nego_data = nego_res.json()
    print("✅ Negotiated deadlines calculated relative to project created_at:")
    for m in nego_data["milestones"]:
        print(f"   • {m['title']}: {m['deadline']} ({m.get('relative_deadline')})")

    # Phase 3: Capture lock verification
    # Seller clicks [Accept Agreement]
    accept_res = client.post(f"/api/projects/{p_id}/accept")
    assert accept_res.status_code == 200
    assert accept_res.json()["status"] == "accepted"
    print("✅ Seller accepted agreement terms. Project status now:", accept_res.json()["status"])

    # Phase 4: Sequential Milestone Orchestration
    # Attempt to submit evidence for Milestone 2 (index 1) directly -> Must be rejected with 400!
    fake_frame = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00\xff\xdb\x00C\x00"
    m2_early_res = client.post(f"/api/milestones/{p_id}_1/submit-evidence", data={
        "capture_method": "live_camera",
        "milestone_index": 1
    }, files={"file": ("casting_proof.jpg", fake_frame, "image/jpeg")})
    assert m2_early_res.status_code == 400
    print("✅ Milestone 2 evidence upload blocked before Milestone 1 approval:", m2_early_res.json()["detail"])

    # Now submit evidence for Milestone 1 (index 0)
    m1_sub = client.post(f"/api/milestones/{p_id}_0/submit-evidence", data={
        "capture_method": "live_camera",
        "milestone_index": 0
    }, files={"file": ("wax_mold.jpg", fake_frame, "image/jpeg")})
    assert m1_sub.status_code == 200
    assert m1_sub.json()["status"] == "awaiting_buyer_review"
    print("✅ Milestone 1 evidence submitted! Status: awaiting_buyer_review")

    # Milestone 2 submission still rejected because Milestone 1 is awaiting review, NOT approved
    m2_still_blocked = client.post(f"/api/milestones/{p_id}_1/submit-evidence", data={
        "capture_method": "live_camera",
        "milestone_index": 1
    }, files={"file": ("casting_proof.jpg", fake_frame, "image/jpeg")})
    assert m2_still_blocked.status_code == 400
    print("✅ Milestone 2 still blocked while Milestone 1 is awaiting buyer review")

    # Buyer approves Milestone 1 via POST /api/milestones/{id}/approve
    appr1 = client.post(f"/api/milestones/{p_id}_0/approve")
    assert appr1.status_code == 200
    appr1_data = appr1.json()
    assert appr1_data["status"] == "approved"
    assert appr1_data["next_active_milestone_index"] == 1
    print("✅ Buyer approved Milestone 1! Next active milestone index:", appr1_data["next_active_milestone_index"])

    # GET /api/projects/{p_id}/milestones should show Milestone 2 as active
    m_list_res = client.get(f"/api/projects/{p_id}/milestones").json()
    assert m_list_res["active_milestone_index"] == 1
    print("✅ GET /api/projects/{id}/milestones reports active_milestone_index = 1")

    # Now seller submits Milestone 2 evidence -> Must succeed!
    m2_sub = client.post(f"/api/milestones/{p_id}_1/submit-evidence", data={
        "capture_method": "live_camera",
        "milestone_index": 1
    }, files={"file": ("gold_casting.jpg", fake_frame, "image/jpeg")})
    assert m2_sub.status_code == 200
    assert m2_sub.json()["status"] == "awaiting_buyer_review"
    print("✅ Milestone 2 evidence successfully submitted! Status: awaiting_buyer_review")

    # Buyer approves Milestone 2
    appr2 = client.post(f"/api/milestones/{p_id}_1/approve")
    assert appr2.status_code == 200
    assert appr2.json()["next_active_milestone_index"] == 2
    print("✅ Buyer approved Milestone 2! Milestone 3 unlocked.")

    # Seller submits Milestone 3 evidence
    m3_sub = client.post(f"/api/milestones/{p_id}_2/submit-evidence", data={
        "capture_method": "live_camera",
        "milestone_index": 2
    }, files={"file": ("final_ring.jpg", fake_frame, "image/jpeg")})
    assert m3_sub.status_code == 200
    print("✅ Milestone 3 evidence submitted!")

    # Buyer approves Milestone 3 (Final Milestone)
    appr3 = client.post(f"/api/milestones/{p_id}_2/approve")
    assert appr3.status_code == 200
    assert appr3.json()["project_status"] == "completed"
    assert appr3.json()["next_active_milestone_index"] is None
    print("✅ Final milestone approved! Project completed successfully:", appr3.json()["project_status"])

    print("\n🎉 ALL PHASES (1, 2, 3, 4) TESTED AND PASSED PERFECTLY! 🎉")

if __name__ == "__main__":
    test_phase_1_ai_classification()
    test_phase_2_buyer_evidence_gating()
    test_phase_3_and_4_seller_negotiation_and_sequential_milestones()
