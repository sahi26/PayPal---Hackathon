import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import bcrypt
from jose import JWTError, jwt

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "60"))
_app_env = os.getenv("APP_ENV", "development").lower()
_configured_secret = os.getenv("JWT_SECRET_KEY", "")

if _app_env == "production" and len(_configured_secret) < 32:
    raise RuntimeError("JWT_SECRET_KEY must contain at least 32 characters in production.")

_jwt_secret = _configured_secret or secrets.token_urlsafe(48)
if not _configured_secret and _app_env != "production":
    print("WARNING: JWT_SECRET_KEY is unset; development sessions will expire when the process restarts.")


def hash_password(password: str) -> str:
    encoded = password.encode("utf-8")
    if not 1 <= len(encoded) <= 72:
        raise ValueError("Password must be between 1 and 72 UTF-8 bytes.")
    return bcrypt.hashpw(encoded, bcrypt.gensalt(rounds=12)).decode("ascii")


def verify_password(password: str, stored_hash: str) -> bool:
    encoded = password.encode("utf-8")
    if len(encoded) > 72 or not stored_hash.startswith(("$2a$", "$2b$", "$2y$")):
        return False
    try:
        return bcrypt.checkpw(encoded, stored_hash.encode("ascii"))
    except (ValueError, TypeError):
        return False


def create_access_token(user_id: int, email: str, role: str) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    return jwt.encode(
        {"sub": str(user_id), "email": email, "role": role, "exp": expires_at},
        _jwt_secret,
        algorithm=JWT_ALGORITHM,
    )


def decode_access_token(token: str) -> Dict[str, Any]:
    try:
        payload = jwt.decode(token, _jwt_secret, algorithms=[JWT_ALGORITHM])
        if not payload.get("sub"):
            raise JWTError("Token subject is missing.")
        return payload
    except JWTError as exc:
        raise ValueError("Invalid or expired access token.") from exc
