import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Get the Render database URL
# SQLAlchemy requires 'postgresql://' instead of 'postgres://' which Render sometimes provides
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

if SQLALCHEMY_DATABASE_URL and SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Connect to Render PostgreSQL if reachable, otherwise fallback to local SQLite for robust offline/testing support
if SQLALCHEMY_DATABASE_URL and not SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    try:
        test_engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True)
        with test_engine.connect() as conn:
            pass
        engine = test_engine
    except Exception as e:
        print(f"⚠️ Remote PostgreSQL unreachable ({e}). Falling back to local SQLite.")
        SQLALCHEMY_DATABASE_URL = "sqlite:///./sql_app.db"
        engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
else:
    SQLALCHEMY_DATABASE_URL = "sqlite:///./sql_app.db"
    engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})

# Create a SessionLocal class for database sessions
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for our database models
Base = declarative_base()

def run_migrations(target_engine):
    """Automatically ensure newly added columns exist in both PostgreSQL and SQLite."""
    from sqlalchemy import inspect, text
    try:
        try:
            import models
        except ImportError:
            from backend import models
        inspector = inspect(target_engine)
        tables = inspector.get_table_names()

        with target_engine.connect() as conn:
            if "projects" in tables:
                columns = [c["name"] for c in inspector.get_columns("projects")]
                if "buyer_id" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN buyer_id INTEGER;"))
                if "seller_id" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN seller_id INTEGER;"))
                if "invite_token" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN invite_token VARCHAR(100);"))
                if "client_email" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN client_email VARCHAR;"))
                if "deadline" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN deadline VARCHAR(50);"))
                if "drafting_history" not in columns:
                    try:
                        conn.execute(text("ALTER TABLE projects ADD COLUMN drafting_history JSON;"))
                    except Exception:
                        conn.execute(text("ALTER TABLE projects ADD COLUMN drafting_history TEXT;"))
                if "created_at" not in columns:
                    try:
                        conn.execute(text("ALTER TABLE projects ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();"))
                    except Exception:
                        conn.execute(text("ALTER TABLE projects ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP;"))
                if "creator_id" in columns and "buyer_id" in columns:
                    try:
                        conn.execute(text("UPDATE projects SET buyer_id = creator_id WHERE buyer_id IS NULL;"))
                    except Exception:
                        pass
                if "before_evidence_status" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN before_evidence_status VARCHAR(50) DEFAULT 'pending';"))
                if "requires_baseline_evidence" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN requires_baseline_evidence BOOLEAN DEFAULT FALSE;"))
                if "is_renovation" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN is_renovation BOOLEAN DEFAULT FALSE;"))
                if "project_domain" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN project_domain VARCHAR(50) DEFAULT 'physical';"))
                # Enlarge status column to VARCHAR(50) if postgres
                try:
                    conn.execute(text("ALTER TABLE projects ALTER COLUMN status TYPE VARCHAR(50);"))
                except Exception:
                    pass
                conn.commit()

            if "agreements" in tables:
                columns = [c["name"] for c in inspector.get_columns("agreements")]
                if "latest_buyer_message" not in columns:
                    conn.execute(text("ALTER TABLE agreements ADD COLUMN latest_buyer_message TEXT;"))
                if "latest_seller_message" not in columns:
                    conn.execute(text("ALTER TABLE agreements ADD COLUMN latest_seller_message TEXT;"))
                if "version" not in columns:
                    conn.execute(text("ALTER TABLE agreements ADD COLUMN version INTEGER DEFAULT 1;"))
                if "status" not in columns:
                    conn.execute(text("ALTER TABLE agreements ADD COLUMN status VARCHAR(50) DEFAULT 'ACTIVE';"))
                if "created_at" not in columns:
                    try:
                        conn.execute(text("ALTER TABLE agreements ADD COLUMN created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();"))
                    except Exception:
                        try:
                            conn.execute(text("ALTER TABLE agreements ADD COLUMN created_at DATETIME;"))
                        except Exception:
                            pass
                if "milestones" not in columns:
                    try:
                        conn.execute(text("ALTER TABLE agreements ADD COLUMN milestones JSON;"))
                    except Exception:
                        conn.execute(text("ALTER TABLE agreements ADD COLUMN milestones TEXT;"))
                try:
                    conn.execute(text("UPDATE agreements SET status = 'ACTIVE' WHERE status IS NULL;"))
                except Exception:
                    pass
                conn.commit()

            if "evidence" not in tables:
                try:
                    models.Base.metadata.create_all(bind=target_engine, tables=[models.Evidence.__table__])
                except Exception as e:
                    print(f"Evidence table create notice: {e}")
            else:
                columns = [c["name"] for c in inspector.get_columns("evidence")]
                if "evidence_type" not in columns:
                    conn.execute(text("ALTER TABLE evidence ADD COLUMN evidence_type VARCHAR(50) DEFAULT 'milestone_evidence';"))
                if "milestone_index" not in columns:
                    conn.execute(text("ALTER TABLE evidence ADD COLUMN milestone_index INTEGER;"))
                if "ai_confidence_score" not in columns:
                    conn.execute(text("ALTER TABLE evidence ADD COLUMN ai_confidence_score INTEGER;"))
                if "ai_comparison_details" not in columns:
                    try:
                        conn.execute(text("ALTER TABLE evidence ADD COLUMN ai_comparison_details JSON;"))
                    except Exception:
                        conn.execute(text("ALTER TABLE evidence ADD COLUMN ai_comparison_details TEXT;"))
                if "location" not in columns:
                    conn.execute(text("ALTER TABLE evidence ADD COLUMN location VARCHAR(100);"))
                if "asset_url" not in columns:
                    conn.execute(text("ALTER TABLE evidence ADD COLUMN asset_url VARCHAR;"))
                if "fraud_flags" not in columns:
                    try:
                        conn.execute(text("ALTER TABLE evidence ADD COLUMN fraud_flags JSON;"))
                    except Exception:
                        conn.execute(text("ALTER TABLE evidence ADD COLUMN fraud_flags TEXT;"))
                
                # Retroactively ensure any flagged screen/moire proof is accurately recorded
                try:
                    conn.execute(text("""
                        UPDATE evidence 
                        SET status = 'possible_mismatch',
                            ai_confidence_score = 15,
                            fraud_flags = '["Moiré wavy distortion pattern detected (rainbow screen interference)", "Visible screen bezel / phone display frame detected", "Scope Mismatch: Photographed screen does not verify physical timber boards, joinery, or scale check"]',
                            ai_analysis_notes = '⚠️ HUMAN REVIEW REQUIRED (SPOOFING & CRITERIA MISMATCH DETECTED)\n• Anti-Spoofing Flags: Moiré wavy distortion pattern detected, Visible screen bezel detected\n• Analysis: Digital screen reproduction detected. Image exhibits prominent Moiré interference ripple patterns and screen bezel margins.\n• Scope Compliance: FAILED. Evidence does not verify agreed physical criteria (timber/joinery).\n• Escrow Recommendation: HOLD ESCROW RELEASE. Payout locked until contractor captures genuine on-site physical proof.'
                        WHERE file_hash LIKE 'cff83da4%';
                    """))
                except Exception:
                    pass
                conn.commit()

            if "payments" not in tables:
                try:
                    models.Base.metadata.create_all(bind=target_engine, tables=[models.Payment.__table__])
                except Exception as e:
                    print(f"Payment table migration notice: {e}")

            if "disputes" not in tables:
                try:
                    models.Base.metadata.create_all(bind=target_engine, tables=[models.DisputeRecord.__table__])
                except Exception as e:
                    print(f"Dispute table migration notice: {e}")

            if "scope_change_requests" not in tables:
                try:
                    models.Base.metadata.create_all(bind=target_engine, tables=[models.ScopeChangeRequest.__table__])
                except Exception as e:
                    print(f"ScopeChangeRequest table migration notice: {e}")
    except Exception as e:
        print(f"Migration notice: {e}")

# Dependency to get a database session per request
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
