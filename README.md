# ProofLens 🛡️
> **Intelligent Milestone Escrow & AI Forensic Verification Engine**  
> *Developed for the PayPal Hackathon*

ProofLens is an enterprise-grade escrow and milestone fulfillment platform designed for high-value contractor agreements, custom artisan fabrication (bespoke carpentry, fine jewelry, renovation), and digital agency deliverables. ProofLens bridges **PayPal Escrow Checkout & Milestone Disbursements** with **Zero-Dependency Anti-Spoofing Computer Vision**, **Google Gemini Multimodal Vision**, and **Generative AI Watermark Forensics**.

---

## 📑 Table of Contents
- [Executive Overview](#-executive-overview)
- [System Architecture](#-system-architecture)
- [Key Features](#-key-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Installation & Quick Start](#-installation--quick-start)
  - [1. Backend Setup (FastAPI)](#1-backend-setup-fastapi)
  - [2. Frontend Setup (Angular)](#2-frontend-setup-angular)
- [Environment Configuration & Security](#-environment-configuration--security)
- [End-to-End Platform Workflow](#-end-to-end-platform-workflow)
  - [Phase 1: Agreement Initiation & AI Legal Drafting](#phase-1-agreement-initiation--ai-legal-drafting)
  - [Phase 2: PayPal Escrow Funding](#phase-2-paypal-escrow-funding)
  - [Phase 3: Milestone Fulfillment & Forensic Screening](#phase-3-milestone-fulfillment--forensic-screening)
  - [Phase 4: Buyer Review & Fund Release](#phase-4-buyer-review--fund-release)
  - [Phase 5: Mid-Project Scope Changes & Addenda](#phase-5-mid-project-scope-changes--addenda)
- [Running Automated Tests](#-running-automated-tests)
- [Security & Secrets Hygiene](#-security--secrets-hygiene)

---

## 🌟 Executive Overview
In modern high-trust contracting, payment disputes occur when deliverables cannot be verified reliably. Contractors are vulnerable to arbitrary payment holds, while buyers risk fraudulent submissions—such as photographs of phone screens, recycled internet images, or unauthorized synthetic AI generations passed off as handmade craft or custom digital design.

**ProofLens resolves this impasse with cryptographic escrow gates:**
1. **Financial Security**: Escrow funds are deposited into PayPal Orders. Funds are disbursed on a strictly milestone-by-milestone basis.
2. **Anti-Spoofing Engine**: Zero-dependency computer vision analyzes camera captures for high-frequency Moiré wave interference patterns, rainbow subpixel chromatic shifts, and visible phone/monitor bezels to ensure evidence is never a re-photographed screen.
3. **AI Watermark Forensics**: Digital deliverables are inspected for synthetic generative signatures, including Google SynthID, OpenAI DALL-E, Midjourney, Stable Diffusion, and Adobe Firefly metadata.
4. **Sequential Milestone Protection**: Milestones must be completed in order. Milestone $N+1$ cannot receive submissions until Milestone $N$ is verified and approved.
5. **AI Scope Revision Desk**: When project requirements evolve, buyer and seller negotiate adjustments inside the revision room. Google Gemini drafts a formal Version $N+1$ Addendum, updates deadlines, and generates PayPal checkout delta links for supplemental escrow funding.

---

## 🏛️ System Architecture

```mermaid
graph TD
    subgraph Client Application [Frontend - Angular]
        UI[Corporate Responsive Dashboard]
        Cam[Hardware-Enforced Live Camera]
        Drop[Authentic Digital Deliverable Dropzone]
        Rev[AI Scope Revision Desk]
    end

    subgraph API Gateway [Backend - FastAPI]
        Router[FastAPI REST API]
        CVEngine[Anti-Spoofing CV Engine]
        WMEngine[AI Watermark Scanner]
        Gemini[Google Gemini Multimodal AI]
        PayPalSvc[PayPal REST SDK Client]
    end

    subgraph Data & Storage
        DB[(PostgreSQL / SQLite Fallback)]
        Ledger[Immutable SHA-256 Audit Ledger]
    end

    subgraph External FinTech & AI
        PP[PayPal Sandbox REST API]
        GenAI[Google AI Studio / Gemini Vision]
    end

    UI --> Router
    Cam --> Router
    Drop --> Router
    Rev --> Router

    Router --> CVEngine
    Router --> WMEngine
    Router --> Gemini
    Router --> PayPalSvc
    Router --> DB
    Router --> Ledger

    CVEngine -.->|Moiré & Bezel Check| Router
    WMEngine -.->|SynthID / DALL-E Scan| Router
    Gemini -.-> GenAI
    PayPalSvc -.-> PP
```

---

## ⚡ Key Features

### 1. PayPal Sandbox Escrow Integration
- **OAuth2 Authentication**: Secure server-to-server client credential token exchange with PayPal.
- **Milestone Checkout Orders**: Generates authenticated PayPal checkout links for agreement budgets.
- **Disbursement Authorization**: Approving a verified milestone triggers automated PayPal capture and escrow disbursement.
- **Supplemental Escrow**: When a scope revision adds extra cost, a delta checkout link is generated so the buyer can fund the addition before work begins.

### 2. Zero-Dependency Computer Vision Anti-Spoofing
- **Moiré Interference Detection**: Calculates gradient zero-crossing oscillations to catch pixel grid interference caused by pointing a camera at another monitor or smartphone screen.
- **Rainbow Chromatic Dispersion**: Identifies subpixel LCD dispersion patterns that only occur on backlit electronic displays.
- **Bezel & Display Frame Detection**: Scans image perimeters for monitor borders, smartphone frames, and handheld bezel reflections.
- **Automatic Escrow Hold**: If spoofing is flagged, confidence drops to $\le 20\%$ (`15%`), escrow release is locked, and the contractor is prompted to recapture genuine direct proof.

### 3. Digital Asset Integrity & AI Watermark Audit
- **Deep Signature Inspection**: Scans file streams for embedded generative AI metadata tags (`SynthID`, `deepmind_watermark`, `dall-e`, `midjourney`, `parameters\x00`, `stablediffusion`, `firefly`).
- **Visual Generative Badge Scanning**: Inspects corner regions for telltale DALL-E multi-color swatches or AI generator stamps.
- **Original Craftsmanship Guarantee**: Flags synthetic images and locks payment until authentic, human-crafted source files (e.g., layered PSD, SVG, AI, vector exports) are supplied.

### 4. Sequential Milestone Enforcement
- Milestone progress is strictly ordered. Milestone 2 cannot receive proof until Milestone 1 is approved by the client.
- Prevents unfinished phases from receiving premature payments.

### 5. Mid-Project Scope Changes & Addenda
- Either party can request revisions (extra timeline days and additional budget).
- Gemini automatically drafts a formal legal Addendum, appending supplementary milestones.
- Milestone deadlines dynamically recalculate across the entire dashboard and agreement timeline.

### 6. Buyer Rejection & Resubmission Flow
- Clients can reject submitted evidence with actionable written feedback.
- Status shifts to `action_required`, notifying the contractor and opening the dedicated Resubmission Desk.
- Previous rejection reasons remain preserved in the audit log for complete transparency.

---

## 🛠️ Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Angular (v19/v20 Standalone Components), TypeScript, RxJS, HTML5 Canvas Live Camera, CSS3 (PayPal Navy Corporate Palette) |
| **Backend** | Python 3.9+, FastAPI, Uvicorn, Pydantic, HTTPX, SQLAlchemy, Python-Multipart |
| **Database** | PostgreSQL (Render/Supabase) with automatic SQLite local fallback (`sql_app.db`) |
| **AI & Vision** | Google Gemini Multimodal Vision API (`gemini-4-argon`, `gemini-3.8-flash`), Custom Zero-Dependency Python CV Engine (Moiré & Bezel Math) |
| **Payments** | PayPal REST API v2 (Sandbox Escrow, Orders Checkout, OAuth2) |

---

## 📂 Project Structure

```
ProofFlow/
├── backend/
│   ├── main.py                     # Primary FastAPI application & REST endpoints
│   ├── ai_service.py               # Gemini prompt orchestration & addendum generator
│   ├── database.py                 # SQLAlchemy engine, session factory & schema migrations
│   ├── models.py                   # Relational database models (Project, Agreement, Evidence, ScopeChange)
│   ├── paypal_service.py           # PayPal OAuth2, Orders creation, checkout, & capture
│   ├── requirements.txt            # Python dependencies
│   ├── .env.example                # Sanitized backend environment template
│   └── test_*.py                   # Automated test suites (Watermarks, Anti-Spoofing, Scope Changes)
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── milestone-fulfillment/   # Milestone timeline, live camera capture, & certificate UI
│   │   │   ├── negotiation-room/        # Agreement review, scope change revision desk, & topbar
│   │   │   ├── project-dashboard/       # Active escrow contracts overview & metrics
│   │   │   ├── project-wizard/          # 3-step project setup & AI contract draft generator
│   │   │   └── live-camera/             # Hardware-bound camera capture component
│   │   ├── index.html
│   │   ├── main.ts
│   │   └── styles.css                   # Corporate PayPal Navy design system
│   ├── angular.json
│   ├── package.json
│   └── tsconfig.json
├── uploads/                        # Evidence directory (gitignored, kept via .gitkeep)
├── .gitignore                      # Comprehensive security rules (secrets, venv, node_modules)
├── .env.example                    # Root environment configuration guide
└── README.md                       # Platform documentation
```

---

## 📋 Prerequisites
Before running ProofLens, ensure you have:
- **Node.js**: `v18.x` or `v20.x`
- **npm**: `v9.x` or higher
- **Python**: `v3.9` or higher
- **PayPal Developer Account**: Sign up at [developer.paypal.com](https://developer.paypal.com/) to get sandbox credentials.
- **Google Gemini API Key**: Obtain a key from [Google AI Studio](https://aistudio.google.com/).

---

## 🚀 Installation & Quick Start

### 1. Backend Setup (FastAPI)

1. Open your terminal and navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create and activate a Python virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   # On Windows: venv\Scripts\activate
   ```

3. Install required packages:
   ```bash
   pip install -r requirements.txt
   ```

4. Configure your environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your PayPal and Gemini credentials (see [Environment Configuration](#-environment-configuration--security)).

5. Start the backend server:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
   - API Docs (Swagger): [http://localhost:8000/docs](http://localhost:8000/docs)
   - Health Check: [http://localhost:8000/api/health](http://localhost:8000/api/health)

---

### 2. Frontend Setup (Angular)

1. Open a new terminal window and navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install npm dependencies:
   ```bash
   npm install
   ```

3. Launch the Angular development server:
   ```bash
   npm start
   # or: npx ng serve --port 4200
   ```

4. Open your browser and navigate to:
   ```
   http://localhost:4200
   ```

---

## 🔐 Environment Configuration & Security

The backend requires environment variables defined in `backend/.env`. A sanitized template is provided in `backend/.env.example`:

```env
# Database Configuration (PostgreSQL or local SQLite fallback)
# If omitted or unreachable, ProofLens automatically uses local SQLite (sqlite:///./sql_app.db)
DATABASE_URL=postgresql://your_db_user:your_db_password@your_db_host:5432/prooflens_db

# Server Configuration
PORT=8000
HOST=0.0.0.0
FRONTEND_URL=http://localhost:4200

# PayPal REST & Identity API Configuration (Sandbox)
# Obtain from https://developer.paypal.com/dashboard/applications/sandbox
PAYPAL_CLIENT_ID=your_paypal_sandbox_client_id_here
PAYPAL_CLIENT_SECRET=your_paypal_sandbox_client_secret_here
PAYPAL_REDIRECT_URI=http://localhost:4200

# Google Gemini API Key (Multimodal Vision & Contract Addenda)
# Obtain from https://aistudio.google.com/
GEMINI_API_KEY=your_google_gemini_api_key_here
```

> **Security Note**: All `.env` files are strictly excluded via `.gitignore`. Never commit API keys or production secrets to source control.

---

## 🔄 End-to-End Platform Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Buyer as Client / Buyer
    actor Contractor as Contractor / Seller
    participant Web as ProofLens UI
    participant API as FastAPI Backend
    participant AI as Anti-Spoofing & Gemini AI
    participant PP as PayPal Sandbox

    Note over Buyer,Contractor: Phase 1: Agreement Initiation
    Buyer->>Web: Create Escrow Project (Title, Scope, Deadlines, Domain)
    Web->>API: POST /api/projects/init
    API->>AI: Draft Structured Legal Milestones
    AI-->>API: Milestones & Verification Criteria
    API-->>Web: Active Draft Agreement (Version 1.0)

    Note over Buyer,PP: Phase 2: Escrow Funding
    Buyer->>Web: Authorize PayPal Escrow Deposit
    Web->>API: POST /api/projects/{id}/paypal/create-order
    API->>PP: Create PayPal Checkout Order
    PP-->>API: Checkout Order Link
    API-->>Web: Launch PayPal Modal
    Buyer->>PP: Authorize $ Escrow Deposit
    PP-->>API: Escrow Funds Locked (STATUS: APPROVED)

    Note over Contractor,AI: Phase 3: Milestone Fulfillment & Forensic Audit
    Contractor->>Web: Live Camera Capture / Upload Clean Deliverable
    Web->>API: POST /api/projects/{id}/evidence
    API->>AI: Run Moiré Anti-Spoofing & AI Watermark Inspection
    alt Screen Spoofing / AI Watermark Detected
        AI-->>API: FAILED (Confidence <= 20%, Flags: Moiré/Bezel/SynthID)
        API-->>Web: Status: POSSIBLE_MISMATCH (Escrow Locked)
        Web-->>Contractor: Alert: Recapture Live Proof / Upload Clean Deliverable
    else Genuine Authentic Deliverable
        AI-->>API: PASSED (Confidence >= 95%, Clean)
        API-->>Web: Status: VERIFIED (Awaiting Buyer Review)
    end

    Note over Buyer,PP: Phase 4: Buyer Review & Fund Release
    alt Buyer Requests Resubmission
        Buyer->>Web: Reject Evidence with Feedback
        Web->>API: POST /api/milestones/{id}/reject
        API-->>Web: Milestone reset to 'awaiting_resubmission'
    else Buyer Approves Deliverable
        Buyer->>Web: Approve Milestone
        Web->>API: POST /api/milestones/{id}/approve
        API->>PP: Capture & Disburse Milestone Escrow Amount
        PP-->>API: Payout Executed
        API-->>Web: Funds Disbursed to Contractor; Milestone N+1 Unlocked
    end
```

---

## 🧪 Running Automated Tests

ProofLens includes test suites covering anti-spoofing detection, digital AI watermark interception, sequential milestone gates, and scope change revisions.

Run all backend unit tests:
```bash
cd backend
SKIP_GEMINI_NETWORK=1 ./venv/bin/python -m unittest discover -s . -p "test_*.py"
```

Verify frontend TypeScript compilation with zero errors:
```bash
cd frontend
npx tsc --noEmit
```

### Key Test Suites:
- `test_digital_ai_watermark.py`: Verifies SynthID/DALL-E detection and ensures photographed screens are strictly flagged on digital deliverables.
- `test_ai_model_upgrade.py`: Verifies zero-dependency Moiré pattern recognition and screen bezel detection.
- `test_rejection_flow.py`: Verifies buyer rejection feedback loops and sequential milestone locks.
- `test_scope_changes.py`: Verifies Gemini Addendum drafting and deadline adjustment logic.

---

## 🔒 Security & Secrets Hygiene

1. **No Sensitive Data Committed**: `.gitignore` prevents `.env`, `sql_app.db`, `prooflens.db`, and `uploads/*` media files from entering git history.
2. **Deterministic Cryptographic Verification**: Every media submission is hashed using SHA-256 upon ingestion to establish an immutable audit trail.
3. **Fail-Closed Escrow Design**: If an AI verification service is unreachable or flags suspicious indicators, the payout defaults to `HOLD ESCROW RELEASE`. Escrow funds cannot be released without passing forensic gates or manual dispute arbitration.
4. **PayPal Basic Auth Protection**: PayPal client secrets are maintained exclusively on the FastAPI backend; the Angular frontend only ever receives ephemeral transaction tokens.

---

## 👥 Contributors & Acknowledgements
- **Author**: ProofLens Engineering Team
- **Hackathon**: PayPal Hackathon 2026
- **License**: MIT License
