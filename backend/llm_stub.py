# --------------------------------------------------------------------------- #
# LOCAL DEV STUB for the private `emergentintegrations` package.
# The real package (emergentintegrations==0.2.0) only exists in the Emergent
# cloud environment — it is NOT on PyPI and not present on this dev machine.
# server.py imports LlmChat/UserMessage with a fallback: if the real package
# is installed it wins (production); otherwise this stub is used so the app
# backend can boot and every non-AI feature can be tested locally.
# AI endpoints (quiz answers, diet plans, support chat, AI reports) call
# LlmChat.send_message → which raises here → the endpoints return their normal
# 502 "service temporarily unavailable" response. Supply EMERGENT_LLM_KEY and
# the real package to enable those features.
# --------------------------------------------------------------------------- #
from typing import Any, Optional


class UserMessage:
    def __init__(self, text: str = "", **kwargs: Any) -> None:
        self.text = text
        for k, v in kwargs.items():
            setattr(self, k, v)


class LlmChat:
    def __init__(
        self,
        api_key: Optional[str] = None,
        session_id: Optional[str] = None,
        system_message: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        self.api_key = api_key
        self.session_id = session_id
        self.system_message = system_message

    def with_model(self, provider: str, model: str) -> "LlmChat":
        # Chainable per the real API: returns self.
        return self

    async def send_message(self, message: Any) -> Any:
        raise RuntimeError(
            "LLM not configured locally: the real `emergentintegrations` package "
            "and a valid EMERGENT_LLM_KEY are required for AI features."
        )