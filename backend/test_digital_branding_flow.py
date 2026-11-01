import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
import main
main.os.environ["GEMINI_API_KEY"] = ""
main.GEMINI_API_KEY = ""

from main import app

client = TestClient(app)

def test_digital_branding_project():
    print("--- 1. Testing Project Initialization for Brand Logo Redesign ---")
    payload = {
        "title": "Brand logo redesign",
        "industry_type": "Graphic Design & Branding",
        "description": "Revamp existing brand logo, modernize vector marks, and provide typography style guide.",
        "total_price": 250.0,
        "deadline": "2026-11-20",
        "buyer_email": "buyer@testbrand.com"
    }
    res = client.post("/api/projects/init", json=payload)
    assert res.status_code == 200, res.text
    data = res.json()
    project_id = data["project_id"]
    domain = data.get("project_domain")
    print(f"Project ID: {project_id}, Domain: {domain}")
    assert domain == "digital", f"Expected 'digital', got {domain}"

    print("\n--- 2. Testing AI Draft Chat Persona & Gating ---")
    chat_payload = {
        "user_message": f"Project created: {payload['title']} ({payload['industry_type']}) with budget ${payload['total_price']}. Scope: {payload['description']}"
    }
    chat_res = client.post(f"/api/projects/{project_id}/draft-chat", json=chat_payload)
    assert chat_res.status_code == 200, chat_res.text
    chat_data = chat_res.json()
    print("AI Response:", chat_data["ai_response_text"][:160], "...")
    print("Requires Baseline Evidence:", chat_data.get("requires_baseline_evidence"))
    print("Domain:", chat_data.get("project_domain"))

    assert chat_data.get("requires_baseline_evidence") is True
    assert chat_data.get("project_domain") == "digital"
    # Ensure it's not asking for software tech stack / lead software architect
    assert "software architect" not in chat_data["ai_response_text"].lower()
    assert "tech stack" not in chat_data["ai_response_text"].lower()
    assert ("graphic designer" in chat_data["ai_response_text"].lower() or "brand" in chat_data["ai_response_text"].lower() or "logo" in chat_data["ai_response_text"].lower())

    print("\n--- 3. Testing Turn 2 to Complete Milestones ---")
    turn2_payload = {
        "user_message": "Our current logo is attached. We want modern flat minimalist vector assets (SVG/AI/PNG), color palette in CMYK/RGB, and typography guide delivered within 2 weeks."
    }
    t2_res = client.post(f"/api/projects/{project_id}/draft-chat", json=turn2_payload)
    assert t2_res.status_code == 200, t2_res.text
    t2_data = t2_res.json()
    assert t2_data["status"] == "complete"
    assert len(t2_data["milestones"]) >= 3
    print(f"Generated {len(t2_data['milestones'])} graphic design milestones:")
    for m in t2_data["milestones"]:
        print(f"  - {m['title']} (${m['price_allocation']})")

    print("\n--- 4. Testing Mandatory Baseline Gating (Exemption Blocked) ---")
    exempt_res = client.post(f"/api/projects/{project_id}/declare-before-exemption", json={})
    assert exempt_res.status_code == 400
    print("Exemption blocked as expected:", exempt_res.json()["detail"])

    print("\n--- 5. Testing Digital Asset Baseline Upload ---")
    # Digital projects accept capture_method='file_upload' with PNG/PDF and asset_url
    fake_png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4\x00\x00\x00\nIDATx\x9cc`\x00\x00\x00\x02\x00\x01H\xaf\xa4q\x00\x00\x00\x00IEND\xaeB`\x82"
    files = {
        "file": ("existing_logo.png", fake_png, "image/png")
    }
    form_data = {
        "capture_method": "file_upload",
        "evidence_type": "before_evidence",
        "asset_url": "https://mybrand.com/current-logo"
    }
    up_res = client.post(f"/api/projects/{project_id}/evidence", data=form_data, files=files)
    assert up_res.status_code == 200, up_res.text
    up_data = up_res.json()
    print("Evidence Uploaded:", up_data)
    assert up_data["status"] == "verified"
    assert up_data.get("asset_url") == "https://mybrand.com/current-logo"
    # Ensure physical screen rephotographing flags are bypassed
    assert len(up_data.get("fraud_flags", [])) == 0

    print("\n--- 6. Testing Finalize Draft with Baseline Evidence Secured ---")
    fin_payload = {
        "contract_terms": "Milestone-based contract for brand redesign",
        "evidence_requirements": "Logos, vector files, and style guide",
        "milestones": t2_data["milestones"]
    }
    fin_res = client.post(f"/api/projects/{project_id}/finalize-draft", json=fin_payload)
    assert fin_res.status_code == 200, fin_res.text
    fin_data = fin_res.json()
    print("Draft Finalized successfully! Invite Token:", fin_data["invite_token"])
    print("Invite URL:", fin_data["invite_url"])

    print("\n🎉 ALL DIGITAL BRANDING TESTS PASSED PERFECTLY! 🎉")

if __name__ == "__main__":
    test_digital_branding_project()
