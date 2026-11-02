import enum
import datetime
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Float, Enum, JSON, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
try:
    from database import Base
except ImportError:
    from backend.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(100), nullable=False)
    role_type = Column(String(50), nullable=False) # 'maker' or 'customer' / 'buyer' or 'seller'
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ProjectStatus(str, enum.Enum):
    DRAFT = "draft"
    INVITE_SENT = "invite_sent"
    SELLER_JOINED = "seller_joined"
    NEGOTIATING = "negotiating"
    ACCEPTED = "accepted"
    ACTIVE = "active"
    IN_REVIEW = "in_review"
    WARRANTY_PERIOD = "WARRANTY_PERIOD"
    COMPLETED = "completed"
    DISPUTED = "disputed"
    REJECTED = "rejected"

class LockInType(str, enum.Enum):
    NONE = "NONE"
    FINAL_MILESTONE = "FINAL_MILESTONE"
    CUSTOM = "CUSTOM"

class CaptureMethod(str, enum.Enum):
    LIVE_CAMERA = "live_camera"
    FILE_UPLOAD = "file_upload"

class EvidenceType(str, enum.Enum):
    BEFORE_EVIDENCE = "before_evidence"
    MILESTONE_EVIDENCE = "milestone_evidence"

class EvidenceStatus(str, enum.Enum):
    SUBMITTED_NOT_VERIFIED = "submitted_not_verified"
    UNCLEAR_EVIDENCE = "unclear_evidence"
    POSSIBLE_MISMATCH = "possible_mismatch"
    VERIFIED = "verified"

class Evidence(Base):
    __tablename__ = "evidence"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    uploader_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    # Metadata & Tracking
    capture_method = Column(Enum(CaptureMethod))
    evidence_type = Column(String, default="milestone_evidence") # "before_evidence" | "milestone_evidence"
    milestone_index = Column(Integer, nullable=True) # 0, 1, 2, ...
    file_path = Column(String)
    file_hash = Column(String, index=True) # SHA-256 for duplicate detection
    original_filename = Column(String)
    mime_type = Column(String)
    file_size = Column(Integer)
    location = Column(String, nullable=True) # Optional GPS coordinates "lat,lng"
    asset_url = Column(String, nullable=True) # Optional link e.g. Current Website or Figma link
    
    # Timestamps (Server-side authoritative)
    server_receipt_timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    
    # AI & Review Status
    status = Column(Enum(EvidenceStatus), default=EvidenceStatus.SUBMITTED_NOT_VERIFIED)
    ai_confidence_score = Column(Integer, nullable=True) # 0 to 100 percentage
    ai_analysis_notes = Column(Text, nullable=True) # Comparative notes against scope and before evidence
    ai_comparison_details = Column(JSON, nullable=True) # Structured comparison findings
    fraud_flags = Column(JSON, default=list, nullable=True) # List of anti-spoofing flags (e.g. "Moire pattern", "Screen bezel")
    
    # Relationships
    project = relationship("Project", backref="evidence_items")
    uploader = relationship("User")

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    buyer_id = Column(Integer, ForeignKey("users.id"), nullable=True) # Initiating buyer/client
    seller_id = Column(Integer, ForeignKey("users.id"), nullable=True) # Seller/contractor who joins via invite
    invite_token = Column(String(100), unique=True, index=True, nullable=True)
    
    title = Column(String)
    industry_type = Column(String) # e.g., "Home Renovation", "Digital Art", "Custom Furniture"
    description = Column(Text) # The scope description
    total_price = Column(Float)
    deadline = Column(String(50), nullable=True) # Target completion deadline
    client_email = Column(String, index=True, nullable=True)
    status = Column(Enum(ProjectStatus), default=ProjectStatus.DRAFT)
    project_domain = Column(String(50), default="physical", nullable=True) # "physical" | "digital"
    is_renovation = Column(Boolean, default=False, nullable=True) # true: modifying existing asset, false: built from scratch
    requires_baseline_evidence = Column(Boolean, default=False, nullable=True)
    before_evidence_status = Column(String(50), default="pending", nullable=True) # "provided" | "exempt_no_evidence" | "pending"
    drafting_history = Column(JSON, default=list, nullable=True) # Chat history [{"role": "ai"|"user", "content": "..."}]
    contractor_rejection_reason = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    buyer = relationship("User", foreign_keys=[buyer_id], backref="bought_projects")
    seller = relationship("User", foreign_keys=[seller_id], backref="sold_projects")
    agreements = relationship("Agreement", back_populates="project", cascade="all, delete-orphan", order_by="desc(Agreement.version)")

    @property
    def agreement(self):
        from sqlalchemy.orm import object_session
        from sqlalchemy import desc
        sess = object_session(self)
        if sess:
            # Always query the authoritative latest ACTIVE agreement from the database
            ag = sess.query(Agreement).filter(
                Agreement.project_id == self.id,
                Agreement.status == "ACTIVE"
            ).order_by(desc(Agreement.version), desc(Agreement.id)).first()
            if ag:
                return ag
            # Fallback to latest non-superseded agreement
            ag = sess.query(Agreement).filter(
                Agreement.project_id == self.id,
                Agreement.status != "SUPERSEDED"
            ).order_by(desc(Agreement.version), desc(Agreement.id)).first()
            if ag:
                return ag
            # Fallback to highest version agreement
            ag = sess.query(Agreement).filter(
                Agreement.project_id == self.id
            ).order_by(desc(Agreement.version), desc(Agreement.id)).first()
            if ag:
                return ag

        if hasattr(self, "agreements") and self.agreements:
            active_list = [a for a in self.agreements if getattr(a, "status", None) == "ACTIVE"]
            if active_list:
                return max(active_list, key=lambda a: getattr(a, "version", 1) or 1)
            non_superseded = [a for a in self.agreements if getattr(a, "status", None) != "SUPERSEDED"]
            if non_superseded:
                return max(non_superseded, key=lambda a: getattr(a, "version", 1) or 1)
            return max(self.agreements, key=lambda a: getattr(a, "version", 1) or 1)
        return None

    @agreement.setter
    def agreement(self, val):
        if val is None:
            return
        if not hasattr(self, "agreements") or self.agreements is None:
            self.agreements = []
        if val not in self.agreements:
            self.agreements.append(val)

class Agreement(Base):
    __tablename__ = "agreements"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    
    ai_generated_contract = Column(Text, nullable=True) 
    evidence_requirements = Column(Text, nullable=True) 
    milestones = Column(JSON, default=list, nullable=True) # Array of milestone objects 
    
    # Negotiation chat history payload
    latest_buyer_message = Column(Text, nullable=True)
    latest_seller_message = Column(Text, nullable=True)
    version = Column(Integer, default=1)
    status = Column(String(50), default="ACTIVE") # ACTIVE, SUPERSEDED, PENDING_REVISION
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    is_accepted_by_client = Column(Integer, default=0) # 0 for false, 1 for true

    # Warranty Lock-In (Retainage) Configuration
    lock_in_type = Column(String(50), default="NONE", nullable=False) # NONE, FINAL_MILESTONE, CUSTOM
    lock_in_amount = Column(Float, default=0.0, nullable=False)
    lock_in_days = Column(Integer, default=0, nullable=False)
    warranty_end_date = Column(DateTime(timezone=True), nullable=True)
    dispute_active = Column(Boolean, default=False, nullable=False)
    warranty_payout_batch_id = Column(String(100), nullable=True)
    warranty_payout_status = Column(String(50), default="NONE", nullable=True) # NONE, PENDING, PROCESSING, SUCCESS, FAILED, HELD_DISPUTE

    project = relationship("Project", back_populates="agreements")

class ScopeChangeStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    NEGOTIATING = "NEGOTIATING"
    PENDING_FUNDS = "PENDING_FUNDS"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"

class ScopeChangeRequest(Base):
    __tablename__ = "scope_change_requests"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), index=True, nullable=False)
    requested_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    description = Column(Text, nullable=False)
    proposed_extra_cost = Column(Float, default=0.0)
    proposed_extra_days = Column(Integer, default=0)
    status = Column(String(50), default=ScopeChangeStatus.NEGOTIATING.value) # DRAFT, NEGOTIATING, PENDING_FUNDS, ACCEPTED, REJECTED
    
    addendum_contract = Column(Text, nullable=True)
    proposed_milestones = Column(JSON, default=list, nullable=True)
    chat_history = Column(JSON, default=list, nullable=True)
    
    paypal_order_id = Column(String(100), nullable=True)
    paypal_approval_url = Column(String(255), nullable=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    project = relationship("Project", backref="scope_changes")
    requested_by = relationship("User")

class PaymentStatus(str, enum.Enum):
    CREATED = "created"
    AUTHORIZED = "authorized"
    CAPTURED = "captured"
    PARTIALLY_CAPTURED = "partially_captured"
    REAUTHORIZED = "reauthorized"
    VOIDED = "voided"
    EXPIRED = "expired"

class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    milestone_index = Column(Integer, nullable=True) # None for full project escrow, or 0, 1, 2 for specific milestone
    
    # PayPal identifiers
    paypal_order_id = Column(String(100), index=True, nullable=True)
    authorization_id = Column(String(100), index=True, nullable=True)
    capture_id = Column(String(100), index=True, nullable=True)
    
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default="USD")
    status = Column(Enum(PaymentStatus), default=PaymentStatus.CREATED)
    
    # Timestamps for 29-day authorization expiration tracking
    authorized_at = Column(DateTime, nullable=True)
    authorization_expires_at = Column(DateTime, nullable=True) # Authorized date + 29 days
    last_reauthorized_at = Column(DateTime, nullable=True)
    captured_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Raw PayPal responses for audit trail
    paypal_payload = Column(JSON, nullable=True)
    
    project = relationship("Project", backref="payments")

class DisputeValidityFlag(str, enum.Enum):
    VERIFIED = "Verified"
    NOT_VERIFIED = "Not verified"
    CONFLICTING = "Conflicting"
    POTENTIALLY_MANIPULATED = "Potentially manipulated"
    REQUIRES_EXPERT_REVIEW = "Requires expert review"

class DisputeRecord(Base):
    __tablename__ = "disputes"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    dispute_id = Column(String(100), index=True, nullable=True) # PayPal Dispute ID e.g. PP-D-12345
    
    reason = Column(Text, nullable=False)
    disputed_by = Column(String(50), default="buyer")
    milestone_index = Column(Integer, nullable=True)
    
    # AI Classification
    dispute_classification = Column(String(100), nullable=True) # missing_work, technical_defect, scope_disagreement, fraud
    validity_flag = Column(Enum(DisputeValidityFlag), default=DisputeValidityFlag.REQUIRES_EXPERT_REVIEW)
    ai_confidence_score = Column(Integer, nullable=True)
    ai_analysis = Column(Text, nullable=True)
    
    # Compiled Evidence Dossier (Contract, Image Hashes, Timestamps, AI Flags)
    compiled_dossier = Column(JSON, nullable=True)
    
    # PayPal Disputes API sync
    pushed_to_paypal = Column(Boolean, default=False)
    paypal_submission_response = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    project = relationship("Project", backref="disputes")


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), index=True, nullable=False)
    milestone_index = Column(Integer, index=True, nullable=False)
    
    # PayPal Invoicing v2 identifiers
    paypal_invoice_id = Column(String(100), index=True, nullable=True) # e.g. INV2-XXXX-XXXX-XXXX-XXXX
    invoice_number = Column(String(100), index=True, nullable=True) # e.g. 0001 or INV-1-M1
    invoice_url = Column(String(500), nullable=True) # Official PayPal payer view URL
    
    # Financial details
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default="USD")
    status = Column(String(50), default="PAID") # MARKED_AS_PAID, PAID, SENT
    
    # Payment / Capture link
    paypal_capture_id = Column(String(100), nullable=True)
    buyer_email = Column(String(200), nullable=True)
    seller_email = Column(String(200), nullable=True)
    
    # Details & cryptographic audit
    items = Column(JSON, nullable=True)
    metadata_json = Column(JSON, nullable=True)
    
    issued_at = Column(DateTime(timezone=True), server_default=func.now())
    paid_at = Column(DateTime(timezone=True), nullable=True)

    project = relationship("Project", backref="invoices")

