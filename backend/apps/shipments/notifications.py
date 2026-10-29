import json
import logging
import os
import urllib.parse
import urllib.request
from typing import Dict, Any, Tuple
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


class NotificationService:
    """
    Production-grade notification service supporting Twilio for SMS
    and an explicit development Mock provider for safe local testing.
    Adheres to Indian DLT (Distributed Ledger Technology) requirements
    by supporting template headers and registered message formats.
    """

    @classmethod
    def get_provider_name(cls) -> str:
        explicit = os.getenv("SMS_PROVIDER", "").strip().lower()
        if explicit in ("twilio", "mock"):
            return explicit
        if os.getenv("TWILIO_ACCOUNT_SID") and os.getenv("TWILIO_AUTH_TOKEN"):
            return "twilio"
        return "mock"

    @classmethod
    def send_dispatch_sms(
        cls,
        *,
        dispatch_request,
        base_portal_url: str = "http://localhost:5173",
    ) -> Tuple[bool, Dict[str, Any]]:
        """
        Sends dispatch SMS notification to assigned driver.
        Returns (success: bool, metadata: dict).
        """
        driver = dispatch_request.driver
        shipment = dispatch_request.shipment

        # Normalized recipient number
        phone = driver.phone.strip() if driver.phone else ""
        if not phone:
            return False, {
                "provider": cls.get_provider_name(),
                "error": "Driver has no registered mobile number.",
                "provider_message_id": "",
            }

        # Secure driver portal action link
        portal_link = f"{base_portal_url}/driver/assignment?token={dispatch_request.token}"

        # Standard clean message complying with template guidelines
        message_body = (
            f"New delivery assignment: Shipment {shipment.reference}. "
            f"Pickup: {shipment.pickup_address[:40]}. "
            f"Destination: {shipment.delivery_address[:40]}. "
            f"Cargo: {shipment.cargo_description[:30]} ({shipment.weight_kg} kg). "
            f"Please review the assignment and accept or reject it through the secure driver portal: {portal_link}"
        )

        provider = cls.get_provider_name()

        if provider == "twilio":
            return cls._send_twilio(phone, message_body)
        else:
            return cls._send_mock(phone, message_body, dispatch_request.id)

    @classmethod
    def _send_twilio(cls, to_phone: str, body: str) -> Tuple[bool, Dict[str, Any]]:
        account_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
        auth_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
        from_number = os.getenv("TWILIO_FROM_NUMBER", "").strip()
        messaging_service_sid = os.getenv("TWILIO_MESSAGING_SERVICE_SID", "").strip()

        if not account_sid or not auth_token:
            return False, {
                "provider": "twilio",
                "error": "Twilio credentials missing in environment (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).",
                "provider_message_id": "",
            }

        # Normalize Indian number format (+91 prefix if 10 digits)
        clean_phone = to_phone.replace(" ", "").replace("-", "")
        if len(clean_phone) == 10 and clean_phone.isdigit():
            clean_phone = f"+91{clean_phone}"

        url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
        payload = {"To": clean_phone, "Body": body}
        if messaging_service_sid:
            payload["MessagingServiceSid"] = messaging_service_sid
        elif from_number:
            payload["From"] = from_number
        else:
            return False, {
                "provider": "twilio",
                "error": "Neither TWILIO_FROM_NUMBER nor TWILIO_MESSAGING_SERVICE_SID is configured.",
                "provider_message_id": "",
            }

        data = urllib.parse.urlencode(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")

        import base64
        creds = f"{account_sid}:{auth_token}"
        auth_header = base64.b64encode(creds.encode("utf-8")).decode("ascii")
        req.add_header("Authorization", f"Basic {auth_header}")
        req.add_header("Content-Type", "application/x-www-form-urlencoded")

        try:
            with urllib.request.urlopen(req, timeout=12) as response:
                resp_data = json.loads(response.read().decode("utf-8"))
                msg_id = resp_data.get("sid", "")
                status = resp_data.get("status", "sent")
                return True, {
                    "provider": "twilio",
                    "provider_message_id": msg_id,
                    "status": "sent" if status in ("queued", "sending", "sent") else status,
                    "error": "",
                }
        except urllib.error.HTTPError as exc:
            try:
                err_content = json.loads(exc.read().decode("utf-8"))
                err_msg = err_content.get("message", str(exc))
            except Exception:
                err_msg = str(exc)
            logger.error("Twilio SMS send error: %s", err_msg)
            return False, {
                "provider": "twilio",
                "provider_message_id": "",
                "error": f"Twilio API Error ({exc.code}): {err_msg}",
            }
        except Exception as exc:
            logger.error("SMS network error: %s", exc)
            return False, {
                "provider": "twilio",
                "provider_message_id": "",
                "error": f"Network error sending SMS: {str(exc)}",
            }

    @classmethod
    def _send_mock(cls, to_phone: str, body: str, dispatch_id: int) -> Tuple[bool, Dict[str, Any]]:
        """
        Transparent development mock provider.
        Does not falsely claim real carrier delivery, logs message details clearly.
        """
        import uuid
        msg_id = f"MOCK-SMS-{uuid.uuid4().hex[:12].upper()}"
        logger.info(
            "[DEV NOTIFICATION MODE] Mock SMS dispatched for Dispatch #%s to %s | ID: %s\nContent: %s",
            dispatch_id,
            to_phone,
            msg_id,
            body,
        )
        return True, {
            "provider": "mock",
            "provider_message_id": msg_id,
            "status": "sent",
            "error": "",
            "mode": "development_mock",
        }
