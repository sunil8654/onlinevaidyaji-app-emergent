import os
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

# Load backend .env to reuse public URL from frontend .env
FRONTEND_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
load_dotenv(FRONTEND_ENV)

PUBLIC_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
BASE_URL = PUBLIC_URL or "http://localhost:8001"


@pytest.fixture(scope="session")
def base_url() -> str:
    return BASE_URL


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register(api_client, base_url, role: str):
    email = f"test_{uuid.uuid4().hex[:10]}@vaidhyaji.example.com"
    payload = {
        "name": f"TEST_{role.capitalize()}",
        "email": email,
        "password": "Passw0rd!123",
        "role": role,
        "phone": "9999999999",
    }
    r = api_client.post(f"{base_url}/api/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return data, payload


@pytest.fixture(scope="session")
def patient_ctx(api_client, base_url):
    data, payload = _register(api_client, base_url, "patient")
    return {
        "token": data["token"],
        "user": data["user"],
        "email": payload["email"],
        "password": payload["password"],
        "headers": {"Authorization": f"Bearer {data['token']}"},
    }


@pytest.fixture(scope="session")
def doctor_ctx(api_client, base_url):
    data, payload = _register(api_client, base_url, "doctor")
    return {
        "token": data["token"],
        "user": data["user"],
        "email": payload["email"],
        "password": payload["password"],
        "headers": {"Authorization": f"Bearer {data['token']}"},
    }
