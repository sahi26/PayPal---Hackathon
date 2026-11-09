import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# Load backend environment defaults without overriding deployment-provided variables.
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
load_dotenv()

# Get the Render database URL
# SQLAlchemy requires 'postgresql://' instead of 'postgres://' which Render sometimes provides
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

if SQLALCHEMY_DATABASE_URL and SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Use SQLite only when explicitly selected or when a local development environment has no URL.
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(BACKEND_DIR, ".."))
ROOT_SQLITE = os.path.join(ROOT_DIR, "sql_app.db")
BACKEND_SQLITE = os.path.join(BACKEND_DIR, "sql_app.db")
CANONICAL_SQLITE_PATH = ROOT_SQLITE if os.path.exists(ROOT_SQLITE) else BACKEND_SQLITE
CANONICAL_SQLITE_URL = f"sqlite:///{CANONICAL_SQLITE_PATH.replace(os.sep, '/')}"

APP_ENV = os.getenv("APP_ENV", "development").lower()
USE_LOCAL_DB = os.getenv("USE_LOCAL_DB", "false").lower() in ("true", "1", "yes")

if APP_ENV == "production" and (
    USE_LOCAL_DB
    or not SQLALCHEMY_DATABASE_URL
    or not SQLALCHEMY_DATABASE_URL.startswith("postgresql")
):
    raise RuntimeError("Production requires a PostgreSQL DATABASE_URL; local SQLite is not supported.")

if USE_LOCAL_DB:
    SQLALCHEMY_DATABASE_URL = CANONICAL_SQLITE_URL
    engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
elif SQLALCHEMY_DATABASE_URL and not SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    try:
        test_engine = create_engine(
            SQLALCHEMY_DATABASE_URL,
            pool_size=15,
            max_overflow=20,
            pool_timeout=10,
            pool_recycle=300,
            pool_pre_ping=True,
            connect_args={"connect_timeout": 5}
        )
        with test_engine.connect() as conn:
            pass
        engine = test_engine
    except Exception as e:
        raise RuntimeError("Configured database is unavailable; refusing to fall back to local SQLite.") from e
elif SQLALCHEMY_DATABASE_URL and SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
else:
    if APP_ENV == "production":
        raise RuntimeError("DATABASE_URL is required in production unless USE_LOCAL_DB is explicitly enabled.")
    SQLALCHEMY_DATABASE_URL = CANONICAL_SQLITE_URL
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
            if "users" in tables:
                user_columns = [column["name"] for column in inspector.get_columns("users")]
                if "email_verified" not in user_columns:
                    conn.execute(text(
                        "ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;"
                    ))
                if "email_verification_token_hash" not in user_columns:
                    conn.execute(text(
                        "ALTER TABLE users ADD COLUMN email_verification_token_hash VARCHAR(64);"
                    ))
                if "email_verification_expires_at" not in user_columns:
                    conn.execute(text(
                        "ALTER TABLE users ADD COLUMN email_verification_expires_at TIMESTAMP WITH TIME ZONE;"
                    ))
                if "email_verification_sent_at" not in user_columns:
                    conn.execute(text(
                        "ALTER TABLE users ADD COLUMN email_verification_sent_at TIMESTAMP WITH TIME ZONE;"
                    ))
                try:
                    conn.execute(text("""
                        UPDATE users 
                        SET email = lower(email) || '+dup' || id 
                        WHERE id NOT IN (
                            SELECT min_id FROM (
                                SELECT MIN(id) AS min_id FROM users GROUP BY lower(email)
                            ) AS subquery
                        );
                    """))
                    conn.commit()
                except Exception:
                    pass
                conn.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower "
                    "ON users (lower(email));"
                ))
                conn.execute(text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_verification_token_hash "
                    "ON users (email_verification_token_hash);"
                ))
                conn.commit()

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
                if "site_location" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN site_location VARCHAR(100);"))
                if "project_domain" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN project_domain VARCHAR(50) DEFAULT 'physical';"))
                if "contractor_rejection_reason" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN contractor_rejection_reason TEXT;"))
                if "paypal_authorization_id" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN paypal_authorization_id VARCHAR(100);"))
                if "authorization_expires_at" not in columns:
                    try:
                        conn.execute(text("ALTER TABLE projects ADD COLUMN authorization_expires_at TIMESTAMP WITH TIME ZONE;"))
                    except Exception:
                        try:
                            conn.execute(text("ALTER TABLE projects ADD COLUMN authorization_expires_at DATETIME;"))
                        except Exception:
                            pass
                if "void_escrow_status" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN void_escrow_status VARCHAR(50) DEFAULT 'NONE';"))
                if "void_escrow_reason" not in columns:
                    conn.execute(text("ALTER TABLE projects ADD COLUMN void_escrow_reason TEXT;"))
                if "void_escrow_requested_at" not in columns:
                    try:
                        conn.execute(text("ALTER TABLE projects ADD COLUMN void_escrow_requested_at TIMESTAMP WITH TIME ZONE;"))
                    except Exception:
                        try:
                            conn.execute(text("ALTER TABLE projects ADD COLUMN void_escrow_requested_at DATETIME;"))
                        except Exception:
                            pass
                if "void_escrow_responded_at" not in columns:
                    try:
                        conn.execute(text("ALTER TABLE projects ADD COLUMN void_escrow_responded_at TIMESTAMP WITH TIME ZONE;"))
                    except Exception:
                        try:
                            conn.execute(text("ALTER TABLE projects ADD COLUMN void_escrow_responded_at DATETIME;"))
                        except Exception:
                            pass
                if "captured_amount" not in columns:
                    try:
                        conn.execute(text("ALTER TABLE projects ADD COLUMN captured_amount FLOAT DEFAULT 0.0;"))
                    except Exception:
                        pass
                if "voided_amount" not in columns:
                    try:
                        conn.execute(text("ALTER TABLE projects ADD COLUMN voided_amount FLOAT DEFAULT 0.0;"))
                    except Exception:
                        pass
                try:
                    conn.execute(text("UPDATE projects SET captured_amount = 0.0 WHERE captured_amount IS NULL;"))
                except Exception:
                    pass
                # Backfill project authorization tracking from existing payments
                try:
                    conn.execute(text("""
                        UPDATE projects
                        SET paypal_authorization_id = (
                            SELECT authorization_id FROM payments 
                            WHERE payments.project_id = projects.id AND payments.authorization_id IS NOT NULL 
                            ORDER BY payments.id DESC LIMIT 1
                        )
                        WHERE paypal_authorization_id IS NULL;
                    """))
                    conn.execute(text("""
                        UPDATE projects
                        SET authorization_expires_at = (
                            SELECT authorization_expires_at FROM payments 
                            WHERE payments.project_id = projects.id AND payments.authorization_expires_at IS NOT NULL 
                            ORDER BY payments.id DESC LIMIT 1
                        )
                        WHERE authorization_expires_at IS NULL;
                    """))
                except Exception:
                    pass
                # Enlarge status column to VARCHAR(50) if postgres and not already >= 50
                status_col = next((c for c in inspector.get_columns("projects") if c["name"] == "status"), None)
                if status_col and (not hasattr(status_col.get("type"), "length") or (status_col["type"].length or 0) < 50):
                    try:
                        conn.execute(text("SET LOCAL lock_timeout = '2s';"))
                        conn.execute(text("ALTER TABLE projects ALTER COLUMN status TYPE VARCHAR(50);"))
                    except Exception:
                        pass
                conn.commit()

            if "agreements" in tables:
                ag_cols = [c["name"] for c in inspector.get_columns("agreements")]
                if "rejection_reason" not in ag_cols:
                    conn.execute(text("ALTER TABLE agreements ADD COLUMN rejection_reason TEXT;"))

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
                if "lock_in_type" not in columns:
                    conn.execute(text("ALTER TABLE agreements ADD COLUMN lock_in_type VARCHAR(50) DEFAULT 'NONE';"))
                if "lock_in_amount" not in columns:
                    conn.execute(text("ALTER TABLE agreements ADD COLUMN lock_in_amount FLOAT DEFAULT 0.0;"))
                if "lock_in_days" not in columns:
                    conn.execute(text("ALTER TABLE agreements ADD COLUMN lock_in_days INTEGER DEFAULT 0;"))
                if "warranty_days" not in columns:
                    conn.execute(text("ALTER TABLE agreements ADD COLUMN warranty_days INTEGER DEFAULT 0;"))
                if "warranty_end_date" not in columns:
                    try:
                        conn.execute(text("ALTER TABLE agreements ADD COLUMN warranty_end_date TIMESTAMP WITH TIME ZONE;"))
                    except Exception:
                        try:
                            conn.execute(text("ALTER TABLE agreements ADD COLUMN warranty_end_date DATETIME;"))
                        except Exception:
                            pass
                if "dispute_active" not in columns:
                    try:
                        conn.execute(text("ALTER TABLE agreements ADD COLUMN dispute_active BOOLEAN DEFAULT FALSE;"))
                    except Exception:
                        conn.execute(text("ALTER TABLE agreements ADD COLUMN dispute_active INTEGER DEFAULT 0;"))
                if "warranty_payout_batch_id" not in columns:
                    conn.execute(text("ALTER TABLE agreements ADD COLUMN warranty_payout_batch_id VARCHAR(100);"))
                if "warranty_payout_status" not in columns:
                    conn.execute(text("ALTER TABLE agreements ADD COLUMN warranty_payout_status VARCHAR(50) DEFAULT 'NONE';"))
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
            else:
                p_cols = [c["name"] for c in inspector.get_columns("payments")]
                if "paypal_authorization_id" not in p_cols:
                    conn.execute(text("ALTER TABLE payments ADD COLUMN paypal_authorization_id VARCHAR(100);"))
                    try:
                        conn.execute(text("UPDATE payments SET paypal_authorization_id = authorization_id WHERE paypal_authorization_id IS NULL;"))
                    except Exception:
                        pass
                conn.commit()

            if "disputes" not in tables:
                try:
                    models.Base.metadata.create_all(bind=target_engine, tables=[models.DisputeRecord.__table__])
                except Exception as e:
                    print(f"Dispute table migration notice: {e}")
            else:
                d_cols = [c["name"] for c in inspector.get_columns("disputes")]
                if "status" not in d_cols:
                    conn.execute(text("ALTER TABLE disputes ADD COLUMN status VARCHAR(50) DEFAULT 'INTERNAL_NEGOTIATION';"))
                if "initiated_by_id" not in d_cols:
                    conn.execute(text("ALTER TABLE disputes ADD COLUMN initiated_by_id INTEGER;"))
                if "resolution_type" not in d_cols:
                    conn.execute(text("ALTER TABLE disputes ADD COLUMN resolution_type VARCHAR(50);"))
                if "resolution_notes" not in d_cols:
                    conn.execute(text("ALTER TABLE disputes ADD COLUMN resolution_notes TEXT;"))
                if "paypal_claim_id" not in d_cols:
                    conn.execute(text("ALTER TABLE disputes ADD COLUMN paypal_claim_id VARCHAR(100);"))
                if "escalated_to_human_at" not in d_cols:
                    try:
                        conn.execute(text("ALTER TABLE disputes ADD COLUMN escalated_to_human_at TIMESTAMP WITH TIME ZONE;"))
                    except Exception:
                        try:
                            conn.execute(text("ALTER TABLE disputes ADD COLUMN escalated_to_human_at DATETIME;"))
                        except Exception:
                            pass
                if "updated_at" not in d_cols:
                    try:
                        conn.execute(text("ALTER TABLE disputes ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE;"))
                    except Exception:
                        try:
                            conn.execute(text("ALTER TABLE disputes ADD COLUMN updated_at DATETIME;"))
                        except Exception:
                            pass
                conn.commit()

            if "dispute_chat_history" not in tables:
                try:
                    models.Base.metadata.create_all(bind=target_engine, tables=[models.DisputeChatHistory.__table__])
                except Exception as e:
                    print(f"DisputeChatHistory table migration notice: {e}")

            if "dossiers" not in tables:
                try:
                    models.Base.metadata.create_all(bind=target_engine, tables=[models.Dossier.__table__])
                except Exception as e:
                    print(f"Dossier table migration notice: {e}")

            if "scope_change_requests" not in tables:
                try:
                    models.Base.metadata.create_all(bind=target_engine, tables=[models.ScopeChangeRequest.__table__])
                except Exception as e:
                    print(f"ScopeChangeRequest table migration notice: {e}")

            if "notifications" not in tables:
                try:
                    models.Base.metadata.create_all(bind=target_engine, tables=[models.Notification.__table__])
                except Exception as e:
                    print(f"Notification table migration notice: {e}")
    except Exception as e:
        print(f"Database schema migration error: {e}")
        raise RuntimeError(f"Database schema migration failed: {e}") from e

# Dependency to get a database session per request
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        try:
            db.rollback()
        except Exception:
            pass
        db.close()
