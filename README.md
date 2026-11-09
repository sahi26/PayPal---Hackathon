# ProofFlow 🛡️ (formerly ProofLens)
> **Intelligent Milestone Escrow & AI Forensic Verification Engine**  
> *Engineered for the PayPal Hackathon 2026*

ProofFlow is an enterprise-grade escrow and milestone fulfillment platform designed for high-value contractor agreements, custom artisan fabrication (bespoke carpentry, fine jewelry, architectural renovation), and digital agency deliverables. ProofFlow bridges **PayPal Escrow Checkout & Milestone Disbursements** with **Zero-Dependency Anti-Spoofing Computer Vision**, **Google Gemini Multimodal Vision**, and **Generative AI Watermark Forensics**.

---

## 📑 Table of Contents
- [Executive Overview](#-executive-overview)
- [System Architecture](#-system-architecture)
- [Key Features & Pillars](#-key-features--pillars)
  - [1. Enterprise Authentication & Identity Security](#1-enterprise-authentication--identity-security)
  - [2. PayPal Escrow & Multi-Capture Disbursement Engine](#2-paypal-escrow--multi-capture-disbursement-engine)
  - [3. Zero-Dependency Anti-Spoofing Computer Vision](#3-zero-dependency-anti-spoofing-computer-vision)
  - [4. Generative AI Watermark & Provenance Forensics](#4-generative-ai-watermark--provenance-forensics)
  - [5. Gemini Multimodal Verification & AI Legal Assistant](#5-gemini-multimodal-verification--ai-legal-assistant)
  - [6. Sequential Milestone Enforcement & Resubmission Flow](#6-sequential-milestone-enforcement--resubmission-flow)
  - [7. Multi-Tier Dispute Desk & Dynamic Warranty Protection](#7-multi-tier-dispute-desk--dynamic-warranty-protection)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Installation & Quick Start](#-installation--quick-start)
  - [1. Backend Setup (FastAPI)](#1-backend-setup-fastapi)
  - [2. Frontend Setup (Angular)](#2-frontend-setup-angular)
- [Environment Configuration & Production Readiness](#-environment-configuration--production-readiness)
- [End-to-End Platform Flow](#-end-to-end-platform-flow)
- [Recent Hardening & Architecture Remediation](#-recent-hardening--architecture-remediation)
- [Running Automated Tests](#-running-automated-tests)
  - [Backend Test Suite (24/24 Modules, 76/76 Tests Passing)](#backend-test-suite-2424-modules-7676-tests-passing)
  - [Frontend Test Suite (Node.js Test Runner)](#frontend-test-suite-nodejs-test-runner)
- [Security & Secrets Hygiene](#-security--secrets-hygiene)
- [License & Acknowledgements](#-license--acknowledgements)

---

## 🌟 Executive Overview
In modern high-trust contracting, payment disputes occur when deliverables cannot be verified reliably. Contractors face arbitrary payment delays and unilateral chargebacks, while buyers face fraudulent submissions—such as photos taken of phone screens, recycled internet assets, unverified locations, or unauthorized synthetic AI generations passed off as handmade craft or custom digital design.

**ProofFlow resolves this impasse with cryptographic escrow gates:**
1. **Financial Security via PayPal**: Escrow funds are secured upfront using PayPal Orders (`intent: AUTHORIZE`). Funds are released on a strictly milestone-by-milestone basis via PayPal Payments Captures (`final_capture = False` for intermediate stages, `final_capture = True` for the conclusion).
2. **Anti-Spoofing CV Engine**: Zero-dependency Python computer vision analyzes camera captures for high-frequency Moiré wave interference patterns, rainbow subpixel chromatic shifts, and visible phone/monitor bezels to guarantee evidence was never a re-photographed screen.
3. **AI Watermark Forensics**: Digital deliverables are inspected for synthetic generative signatures, including Google SynthID, OpenAI DALL-E, Midjourney, Stable Diffusion, and Adobe Firefly metadata.
4. **Physical & Digital Domain Awareness**: Physical milestones verify EXIF GPS geofences and hardware-bound camera timestamps; digital milestones audit repository commits, URLs, and file streams.
5. **Sequential Milestone Protection**: Milestones must be completed in order. Milestone $N+1$ cannot receive submissions until Milestone $N$ is verified and approved.
6. **Multi-Tier Dispute Resolution**: Escrowed funds are protected by a 3-tier escalation desk: Tier 1 bilateral negotiation, Tier 2 programmatic AI mediation, and Tier 3 human arbitration synchronized with PayPal Disputes API.
7. **Production-Hardened Security**: Bcrypt (12 rounds) password hashing, persistent JWT (HS256) bearer token authentication, email verification lifecycle, and strict PostgreSQL enforcement for live deployments.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    subgraph ClientApp ["Frontend (Angular Standalone)"]
        UI["Corporate Responsive Dashboard"]
        Cam["Hardware-Bound Live Camera"]
        Drop["Authentic Deliverable Dropzone"]
        Rev["AI Scope Revision & Dispute Room"]
        AuthInt["JWT Auth Interceptor & Runtime Config"]
    end

    subgraph APIGateway ["Backend (FastAPI)"]
        Router["FastAPI REST Router (/api/*)"]
        AuthSvc["Auth Service (Bcrypt 12 + JWT HS256)"]
        EmailSvc["Email Service (SMTP / Verification)"]
        CVEngine["Anti-Spoofing CV Engine (Moiré & Bezel)"]
        WMEngine["AI Watermark Scanner (SynthID / DALL-E)"]
        GeminiSvc["Google Gemini Multimodal AI Service"]
        PayPalSvc["PayPal REST Client (OAuth2 / Orders / Captures)"]
    end

    subgraph Storage ["Database & Storage"]
        DB[("PostgreSQL (Prod) / SQLite (Dev)")]
        Ledger["Immutable Audit Trail & Ledger"]
        Uploads["SHA-256 Hashed Evidence Store"]
    end

    subgraph External ["External Services"]
        PP["PayPal REST API (Sandbox / Live)"]
        GenAI["Google Gemini API (1.5 / 2.0 / Flash)"]
        SMTPRelay["Production SMTP Email Gateway"]
    end

    UI --> AuthInt
    AuthInt --> Router
    Cam --> Router
    Drop --> Router
    Rev --> Router

    Router --> AuthSvc
    Router --> EmailSvc
    Router --> CVEngine
    Router --> WMEngine
    Router --> GeminiSvc
    Router --> PayPalSvc
    Router --> DB
    Router --> Ledger
    Router --> Uploads

    EmailSvc -.-> SMTPRelay
    GeminiSvc -.-> GenAI
    PayPalSvc -.-> PP
```

---

## ⚡ Key Features & Pillars

### 1. Enterprise Authentication & Identity Security
- **Bcrypt Password Hashing**: Passwords hashed with 12 work factor salt rounds (`bcrypt.gensalt(rounds=12)`).
- **Password Complexity Validation**: Enforces minimum 12 characters with required uppercase, lowercase, numbers, and special characters.
- **JWT HS256 Session Tokens**: Cryptographically signed access tokens with user claims (`user_id`, `role`, `email`, `email_verified`).
- **Email Verification Lifecycle**: Generates cryptographic SHA-256 token hashes, expiration timestamps, and handles `/api/auth/verify-email` and `/api/auth/resend-verification`.
- **Role-Based Access Control**: Strict buyer vs. seller perspective separation, verified across all escrow operations and dispute rooms.

### 2. PayPal Escrow & Multi-Capture Disbursement Engine
- **Upfront Escrow Hold**: Places a 29-day authorization hold on the client's PayPal account (`POST /v2/checkout/orders` with `intent: AUTHORIZE`).
- **Sequential Multi-Capture**: Milestones disburse funds independently (`POST /v2/payments/authorizations/{id}/capture`). Intermediate milestones specify `final_capture = False`, reserving remaining funds for subsequent milestones.
- **Deferred Retainage Protection**: Configurable retainage hold (e.g. 10%) withheld until final milestone signoff or warranty period conclusion.
- **Unilateral & Mutual Voiding**: Buyers can unilaterally void escrow if a seller ghosts before work commences; mutual consent releases authorization holds instantly via `POST /v2/payments/authorizations/{id}/void`.
- **Authorization Re-authorization**: Built-in support for extending 29-day authorization windows (`POST /v2/payments/authorizations/{id}/reauthorize`).
- **Automated Milestone Invoicing**: Generates and finalizes compliant invoices via PayPal Invoicing API upon milestone capture.
- **Webhook Synchronization**: Validates and processes PayPal webhook events (`PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, `CUSTOMER.DISPUTE.CREATED`).

### 3. Zero-Dependency Anti-Spoofing Computer Vision
- **Moiré Interference Detection**: Fast Fourier Transform (FFT) and high-frequency gradient oscillation math identify pixel grid interference caused by photographing another monitor or phone screen.
- **Rainbow Chromatic Dispersion**: Analyzes subpixel RGB spatial dispersion patterns that only occur on backlit electronic displays.
- **Bezel & Frame Edge Detection**: Scans image borders for monitor frames, smartphone bezels, and handheld screen reflections.
- **Tamper Quarantine**: Submissions flagged with screen spoofing drop to $\le 20\%$ confidence, locking escrow disbursement until genuine, live direct proof is supplied.

### 4. Generative AI Watermark & Provenance Forensics
- **Deep Signature Stream Inspection**: Audits binary file streams for embedded AI generator metadata tags (`SynthID`, `deepmind_watermark`, `dall-e`, `midjourney`, `parameters\x00`, `stablediffusion`, `firefly`).
- **Visual Generative Badge Scanning**: Inspects corner regions for DALL-E multi-color swatches, Midjourney watermark stamps, or AI generator logos.
- **Authentic Craftsmanship Guarantee**: Flags synthetic digital submissions passed off as handmade artisan work or bespoke digital illustration.

### 5. Gemini Multimodal Verification & AI Legal Assistant
- **AI Legal Milestone Drafting**: Google Gemini converts conversational project descriptions into structured, legally binding milestones with quantifiable verification criteria.
- **Multimodal Visual Audit**: Gemini evaluates uploaded proof against milestone specifications, comparing physical features, dimensions, material quality, and completion percentages.
- **AI Scope Addenda Generator**: When project scope evolves, Gemini drafts formal Version $N+1$ Addenda, updates deadlines, and computes incremental PayPal funding links.

### 6. Sequential Milestone Enforcement & Resubmission Flow
- **Strict Execution Order**: Milestone $N+1$ is strictly locked until Milestone $N$ has been verified, approved, and partially captured.
- **Buyer Feedback & Resubmission**: Buyers can reject unsatisfactory proof with specific, actionable critique. The milestone shifts to `awaiting_resubmission` without resetting the entire project.
- **Immutable Audit Trail**: All previous evidence submissions, rejection reasons, and timestamped forensic reports remain preserved.

### 7. Multi-Tier Dispute Desk & Dynamic Warranty Protection
- **Tier 1 — Direct Negotiation**: In-app negotiation room allows buyer and seller to exchange counter-proposals and adjust terms amicably.
- **Tier 2 — Programmatic AI Mediation**: Gemini evaluates historical milestone evidence, agreement terms, and dispute claims to suggest an objective compromise.
- **Tier 3 — PayPal Dispute Escalation**: Formal escalation synchronizes case data with PayPal Customer Disputes API (`/v1/customer/disputes`), locking contested escrow funds pending resolution.
- **Post-Completion Warranty Period**: Dynamic warranty hold (e.g. 7–30 days) safeguards buyers against latent defects before final project closure.

---

## 🛠️ Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Angular (v19/v20 Standalone Components), TypeScript, RxJS, HTML5 Canvas Live Camera, CSS3 / SCSS (Corporate PayPal Navy Palette) |
| **Backend** | Python 3.9+, FastAPI, Uvicorn, Pydantic v2, HTTPX, SQLAlchemy |
| **Authentication** | Bcrypt (12 salt rounds), PyJWT (HS256 tokens), Email verification tokens |
| **Database** | PostgreSQL (Production Mandatory); SQLite (Local isolated development only) |
| **AI & Vision** | Google Gemini Multimodal Vision API (`gemini-2.0-flash`, `gemini-1.5-flash`), Custom Zero-Dependency Python CV Engine (Moiré FFT & Bezel Math) |
| **Payments** | PayPal REST API v2 (Orders v2 Authorize, Payments v2 Captures & Voids, Invoicing v2, Disputes v1, Webhooks) |
| **Testing** | Python `unittest` discovery runner, Node.js native test runner (`node --test`) |

---

## 📂 Project Structure

```
ProofFlow/
├── backend/
│   ├── main.py                     # Primary FastAPI application & REST endpoints
│   ├── auth_service.py             # Bcrypt hashing (12 rounds) & JWT HS256 auth
│   ├── email_service.py            # SMTP email verification & notification service
│   ├── ai_service.py               # Gemini prompt orchestration & addendum generator
│   ├── database.py                 # SQLAlchemy engine, session factory & migration guards
│   ├── models.py                   # Relational database models (User, Project, Agreement, Evidence)
│   ├── paypal_service.py           # PayPal OAuth2, Orders Authorize, Captures, Voids, Invoicing
│   ├── requirements.txt            # Python dependencies
│   ├── .env.example                # Sanitized backend environment template
│   └── test_*.py                   # 24 automated unit & integration test modules
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── auth.interceptor.ts      # Automatic JWT Bearer token attachment
│   │   │   ├── runtime-config.mjs       # Environment-aware API origin resolver & sanitization
│   │   │   ├── runtime-config.test.mjs  # Automated frontend unit test suite
│   │   │   ├── buyer-dashboard/         # Buyer escrow contracts & payment metrics
│   │   │   ├── seller-dashboard/        # Seller project overview & active milestones
│   │   │   ├── buyer-wizard/            # 3-step project setup & AI contract generator
│   │   │   ├── milestone-fulfillment/   # Milestone timeline, live camera capture, & certificate UI
│   │   │   ├── negotiation-room/        # Agreement review, scope change revision desk, & chat
│   │   │   ├── dispute-room/            # 3-Tier dispute desk & AI mediation interface
│   │   │   └── login/                   # Login, registration & email verification UI
│   │   ├── index.html
│   │   ├── main.ts
│   │   └── styles.css                   # PayPal Corporate Navy design system
│   ├── angular.json
│   ├── package.json
│   └── tsconfig.json
├── uploads/                        # Hashed evidence storage (gitignored, kept via .gitkeep)
├── .gitignore                      # Security exclusions (secrets, venv, databases, node_modules)
├── .env.example                    # Root environment configuration guide
└── README.md                       # Comprehensive platform documentation
```

---

## 📋 Prerequisites
Before running ProofFlow, ensure you have:
- **Node.js**: `v18.x` or `v20.x`
- **npm**: `v9.x` or higher
- **Python**: `v3.9` to `v3.12`
- **PayPal Developer Account**: Sign up at [developer.paypal.com](https://developer.paypal.com/) to obtain Sandbox Client ID & Secret.
- **Google Gemini API Key**: Obtain a key from [Google AI Studio](https://aistudio.google.com/).
- **PostgreSQL**: Required for staging/production deployments.

---

## 🚀 Installation & Quick Start

### 1. Backend Setup (FastAPI)

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create and activate a Python virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Configure your environment variables:
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` with your PayPal Sandbox credentials, Gemini API key, and JWT secret.*

5. Start the backend server:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```
   - **Interactive API Docs (Swagger UI)**: [http://localhost:8000/docs](http://localhost:8000/docs)
   - **Health & DB Verification Endpoint**: [http://localhost:8000/api/health](http://localhost:8000/api/health)

---

### 2. Frontend Setup (Angular)

1. Open a new terminal and navigate to the frontend directory:
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

## 🔐 Environment Configuration & Production Readiness

### Production Environment Invariants
Production deployments (`APP_ENV=production`) enforce strict operational rules:
- **Database Selection**: A reachable PostgreSQL `DATABASE_URL` is mandatory. The application will refuse to start if SQLite is configured in production.
- **Fail-Fast Migrations**: `run_migrations()` raises a `RuntimeError` immediately upon encountering schema anomalies rather than failing silently.
- **PayPal Real Endpoints**: Enforces HTTPS `PAYPAL_API_BASE=https://api-m.paypal.com`. All simulated/fake payment fallbacks are completely disabled in production.
- **Security Tokens**: `JWT_SECRET_KEY` and `ADMIN_API_TOKEN` must be at least 32 characters in length.
- **Email Delivery**: Authenticated SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`) with STARTTLS/SSL is required for real user email verification.

### Key Environment Variables
```ini
# Core Environment
APP_ENV=development              # Set to 'production' for live deployments
DATABASE_URL=sqlite:///./test.db # Use postgresql://user:pass@host/db in production
USE_LOCAL_DB=true                # Strictly ignored when APP_ENV=production

# Security & Authentication
JWT_SECRET_KEY=change_me_to_at_least_32_characters_random_secret
ADMIN_API_TOKEN=change_me_to_at_least_32_characters_admin_token
JWT_EXPIRATION_MINUTES=1440

# PayPal REST API
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_client_secret
PAYPAL_WEBHOOK_ID=your_registered_webhook_id
PAYPAL_API_BASE=https://api-m.sandbox.paypal.com

# Google Gemini AI
GEMINI_API_KEY=your_gemini_api_key

# Email Verification (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@example.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_EMAIL=noreply@proofflow.io
SMTP_USE_TLS=true
```

---

## 🔄 End-to-End Platform Flow

The complete project lifecycle from user registration to final escrow release follows this sequence:

```mermaid
sequenceDiagram
    autonumber
    actor Buyer as Client / Buyer
    actor Seller as Contractor / Seller
    participant Web as ProofFlow UI
    participant API as FastAPI Backend
    participant Auth as Auth & Email Service
    participant AI as Gemini & CV Engine
    participant PP as PayPal REST API

    Note over Buyer,Auth: Phase 1: Authentication & Identity
    Buyer->>Web: Register Account (Email, Password)
    Web->>API: POST /api/auth/register
    API->>Auth: Bcrypt Hash (12 rounds) & Generate Verification Token
    Auth-->>Buyer: Send Verification Email
    Buyer->>Web: Click Verification Link
    Web->>API: POST /api/auth/verify-email
    API-->>Web: Email Verified; Issue JWT Access Token

    Note over Buyer,Seller: Phase 2: Project Initiation & Negotiation
    Buyer->>Web: Create Escrow Project (Title, Milestones, Budget, Domain)
    Web->>API: POST /api/projects/init
    API->>AI: Gemini Drafts Structured Milestones & Criteria
    API-->>Web: Return Project with Invite Token
    Buyer->>Seller: Share Project Invite Link
    Seller->>Web: Review Terms & Enter Negotiation Room
    opt Terms Counter-Proposal
        Seller->>Web: Propose Revised Budget / Timeline
        Web->>API: POST /api/projects/{id}/negotiate
        Buyer->>Web: Accept Counter-Proposal
    end
    Seller->>Web: Accept Agreement (Version 1.0)
    Web->>API: POST /api/projects/{id}/accept
    API->>PP: Create PayPal Escrow Order (intent: AUTHORIZE)
    PP-->>API: Return Checkout Approval URL

    Note over Buyer,PP: Phase 3: PayPal Escrow Authorization
    Buyer->>PP: Authorize Total Project Budget Escrow Hold
    PP-->>Web: Escrow Approved (Token / Order ID)
    Web->>API: POST /api/escrow/confirm-authorization
    API->>PP: Confirm 29-Day Authorization Hold Locked
    API-->>Web: Project Status: ACTIVE (Escrow Protection Locked)

    Note over Seller,AI: Phase 4: Sequential Milestone Fulfillment
    Seller->>Web: Capture Hardware Camera Proof or Upload Artifact
    Web->>API: POST /api/projects/{id}/evidence
    API->>AI: Execute Anti-Spoofing (Moiré, Bezel) + AI Watermark Scan (SynthID) + Gemini Multimodal Audit
    alt Forensic Anomaly Flagged
        AI-->>API: Confidence <= 20% (Spoofing / AI Artifacts Detected)
        API-->>Web: Status: POSSIBLE_MISMATCH (Escrow Locked)
        Web-->>Seller: Prompt: Recapture Live Unaltered Evidence
    else Authentic Deliverable
        AI-->>API: Confidence >= 90% (Verified Authentic)
        API-->>Web: Status: VERIFIED (Awaiting Buyer Review)
    end

    Note over Buyer,PP: Phase 5: Buyer Review & Milestone Capture
    alt Deliverable Rejected with Critique
        Buyer->>Web: Reject Milestone with Actionable Feedback
        Web->>API: POST /api/milestones/{id}/reject
        API-->>Web: Milestone status: awaiting_resubmission
        Seller->>Web: Address Feedback & Resubmit Proof
    else Deliverable Approved
        Buyer->>Web: Approve Milestone
        Web->>API: POST /api/milestones/{id}/approve
        API->>PP: Capture Milestone Amount (final_capture = False)
        PP-->>API: Disbursement Completed & Balance Updated
        API->>PP: Generate Compliant Milestone Invoice
        API-->>Web: Milestone Paid, Retainage Computed, Next Milestone Unlocked!
    end

    Note over Buyer,Seller: Phase 6: Mid-Project Addenda & Disputes
    opt Scope Revision Request
        Buyer->>Web: Request Scope Addendum (Timeline / Budget delta)
        Web->>API: POST /api/projects/{id}/scope-change
        API->>AI: Gemini drafts Addendum Version N+1
        API->>PP: Generate Delta PayPal Checkout Link
        Buyer->>PP: Fund Supplementary Escrow
    end
    opt Dispute Escalation
        Buyer->>Web: File Dispute
        Web->>API: POST /api/projects/{id}/disputes
        Note over API,AI: Tier 1: Negotiation -> Tier 2: AI Mediation -> Tier 3: PayPal Dispute API
    end

    Note over Buyer,PP: Phase 7: Final Completion & Retainage Release
    Buyer->>Web: Approve Final Milestone
    Web->>API: POST /api/milestones/{final_id}/approve (final_capture = True)
    API->>PP: Capture Remaining Retainage Hold
    API-->>Web: Project COMPLETED, Dynamic Warranty Period Activated
```

---

## 🛡️ Recent Hardening & Architecture Remediation

In the most recent update, ProofFlow underwent a complete production readiness overhaul:

1. **Authentication Overhaul**:
   - Replaced prototype authentication with industry-standard **Bcrypt (12 rounds)** and **JWT HS256** access tokens.
   - Added user email verification with cryptographically secure token hashes (`backend/auth_service.py` & `backend/email_service.py`).
2. **Database Integrity & Fail-Fast Migrations**:
   - `backend/database.py` enforces PostgreSQL in production mode (`APP_ENV=production`).
   - Schema migrations fail-fast with explicit `RuntimeError` rather than logging silent warnings.
3. **PayPal Gateway Protection**:
   - Eliminated all fake mock success responses from production codepaths in `backend/paypal_service.py`.
   - Enforced HTTPS live API endpoints and live credential validation.
   - Isolated hermetic test stubs strictly to offline unit testing (`APP_ENV=test`).
4. **Backend Test Suite Restoration**:
   - Resolved database cross-contamination across tests by eliminating destructive global `drop_all()` teardowns.
   - Added an HTTP middleware database session bridge in `main.py` allowing test fixtures using `app.dependency_overrides` to inspect shared test memory sessions.
   - Fixed multi-capture sequential tracking, retainage hold math, and async event loop recreation.
   - **Result**: All 24 backend test modules and all 76 unit/integration tests now pass 100% cleanly.
5. **Frontend Runtime Verification**:
   - Built environment-aware runtime configuration (`runtime-config.mjs`) and JWT Bearer interceptor (`auth.interceptor.ts`).
   - Added automated frontend tests using Node.js test runner (`runtime-config.test.mjs`), validating origin resolution and secure token handling.

---

## 🧪 Running Automated Tests

### Backend Test Suite (24/24 Modules, 76/76 Tests Passing)

The entire backend test suite runs cleanly in isolated hermetic test mode:

```bash
cd backend
USE_LOCAL_DB=true \
APP_ENV=test \
ALLOW_INSECURE_TEST_AUTH=1 \
ALLOW_SIMULATED_WEBHOOKS=1 \
ALLOW_SIMULATED_PAYPAL_FAILURES=1 \
PYTHONPATH=. \
SKIP_GEMINI_NETWORK=1 \
./venv/bin/python -m unittest discover -s . -p 'test_*.py'
```

#### Test Coverage Highlights:
- **`test_defect_2_1_auth_hash.py`**: Validates Bcrypt 12-round hashing, JWT claims, and authentication security.
- **`test_defect_2_2_escrow_checkout.py`**: Verifies PayPal Orders v2 `AUTHORIZE` escrow hold lifecycle.
- **`test_defect_2_3_multi_capture.py`**: Verifies milestone-based partial captures with `final_capture = False`.
- **`test_anti_spoofing_engine.py`**: Verifies Moiré FFT math, LCD subpixel dispersion, and bezel detection.
- **`test_ai_watermark_forensics.py`**: Verifies SynthID, DALL-E, and generative AI signature detection.
- **`test_dispute_workflow.py`**: Verifies 3-tier dispute escalation (Negotiation, AI mediation, PayPal dispute).
- **`test_scope_changes.py`**: Verifies Gemini addenda drafting, deadline adjustments, and delta funding.
- **`test_ghosting_and_unilateral_void.py`**: Verifies unilateral buyer void for inactive contractors.
- **`test_location_tracking.py`**: Verifies EXIF GPS geofence matching and digital exemption logic.
- **`test_reauthorize_and_funds_at_risk.py`**: Verifies PayPal 29-day authorization renewal.

### Frontend Test Suite (Node.js Test Runner)

Run the automated frontend test suite:

```bash
cd frontend
npm test
```

*Runs 6 automated unit tests validating API base URL resolution, trailing slash trimming, HTTPS protocol security, stored user token parsing, and third-party credential leakage protection.*

Verify TypeScript type compilation:
```bash
cd frontend
npx tsc --noEmit
```

---

## 🔒 Security & Secrets Hygiene

1. **Zero Secret Leakage**: `.gitignore` strictly prevents `.env`, `*.db`, and uploaded user assets from entering git history.
2. **Backend-Only PayPal Secret**: PayPal client secrets and access tokens are strictly managed by FastAPI; the frontend never receives payment credentials.
3. **Cryptographic Asset Integrity**: All uploaded evidence artifacts are digested with SHA-256 upon ingestion and recorded in an immutable ledger.
4. **Secure Headers & CORS**: FastAPI and Angular runtime configs sanitize API base URLs, enforcing HTTPS in production.

---

## 👥 License & Acknowledgements
- **Engineered by**: ProofFlow Engineering Team
- **Competition**: PayPal Hackathon 2026
- **License**: [MIT License](LICENSE)
