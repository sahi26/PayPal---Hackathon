import os
import smtplib
import ssl
from email.message import EmailMessage


SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", "").strip()
SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "false").lower() in {"1", "true", "yes"}
SMTP_STARTTLS = os.getenv("SMTP_STARTTLS", "true").lower() in {"1", "true", "yes"}


class EmailDeliveryError(Exception):
    pass


def is_configured() -> bool:
    return bool(SMTP_HOST and SMTP_FROM_EMAIL)


def validate_production_config() -> None:
    if not is_configured():
        raise RuntimeError("SMTP_HOST and SMTP_FROM_EMAIL are required in production.")
    if SMTP_USE_SSL == SMTP_STARTTLS:
        raise RuntimeError("Configure exactly one of SMTP_USE_SSL or SMTP_STARTTLS for production.")
    if bool(SMTP_USERNAME) != bool(SMTP_PASSWORD):
        raise RuntimeError("SMTP_USERNAME and SMTP_PASSWORD must be configured together.")


def send_verification_email(recipient: str, verification_url: str) -> None:
    if not is_configured():
        raise EmailDeliveryError("SMTP email delivery is not configured.")
    if bool(SMTP_USERNAME) != bool(SMTP_PASSWORD):
        raise EmailDeliveryError("SMTP credentials must be configured together.")
    if SMTP_USE_SSL and SMTP_STARTTLS:
        raise EmailDeliveryError("Configure either SMTP SSL or STARTTLS, not both.")

    message = EmailMessage()
    message["Subject"] = "Verify your ProofLens email address"
    message["From"] = SMTP_FROM_EMAIL
    message["To"] = recipient
    message.set_content(
        "Verify your ProofLens email address using this link. It expires in 24 hours:\n\n"
        f"{verification_url}\n"
    )

    try:
        if SMTP_USE_SSL:
            connection = smtplib.SMTP_SSL(
                SMTP_HOST,
                SMTP_PORT,
                timeout=10,
                context=ssl.create_default_context(),
            )
        else:
            connection = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10)

        with connection:
            if SMTP_STARTTLS:
                connection.starttls(context=ssl.create_default_context())
            if SMTP_USERNAME:
                connection.login(SMTP_USERNAME, SMTP_PASSWORD)
            connection.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        raise EmailDeliveryError("Unable to deliver the verification email.") from exc
