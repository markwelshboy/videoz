import base64
from pathlib import Path

import httpx

from .config import Settings
from .models import CaptionProviderInfo, CaptionRecipe


class CaptionProvider:
    id: str

    def generate(self, recipe: CaptionRecipe, prompt: str, frame_paths: list[Path]) -> str:
        raise NotImplementedError


class MockCaptionProvider(CaptionProvider):
    id = "mock"

    def generate(self, recipe: CaptionRecipe, prompt: str, frame_paths: list[Path]) -> str:
        return (
            f"A concise visual description of this clip based on {len(frame_paths)} reviewed frames. "
            "Replace this mock caption by configuring OpenRouter or a local OpenAI-compatible VLM endpoint."
        )


class OpenAICompatibleCaptionProvider(CaptionProvider):
    def __init__(self, provider_id: str, base_url: str, api_key: str | None):
        self.id = provider_id
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def _data_url(self, path: Path) -> str:
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"

    def generate(self, recipe: CaptionRecipe, prompt: str, frame_paths: list[Path]) -> str:
        content: list[dict] = [{"type": "text", "text": prompt}]
        for path in frame_paths:
            content.append({"type": "image_url", "image_url": {"url": self._data_url(path)}})

        messages: list[dict] = []
        if recipe.system_prompt.strip():
            messages.append({"role": "system", "content": recipe.system_prompt.strip()})
        messages.append({"role": "user", "content": content})

        payload: dict = {
            "model": recipe.model,
            "messages": messages,
            "max_tokens": recipe.max_tokens,
            "temperature": recipe.temperature,
            "top_p": recipe.top_p,
        }
        if recipe.seed is not None:
            payload["seed"] = recipe.seed

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.id == "openrouter":
            headers["X-Title"] = "Videoz"

        with httpx.Client(timeout=180) as client:
            response = client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            body = response.json()

        try:
            content_value = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError("Vision provider returned an unexpected response") from exc

        if isinstance(content_value, str):
            return content_value.strip()
        if isinstance(content_value, list):
            parts = [item.get("text", "") for item in content_value if isinstance(item, dict)]
            return "".join(parts).strip()
        raise RuntimeError("Vision provider did not return text")


class CaptionProviderRegistry:
    def __init__(self, settings: Settings):
        self.settings = settings

    def list(self) -> list[CaptionProviderInfo]:
        return [
            CaptionProviderInfo(
                id="mock",
                label="Mock provider (workflow test)",
                available=True,
                default_model="videoz/mock-vlm",
                model_hint="No GPU or API required; returns a placeholder caption.",
            ),
            CaptionProviderInfo(
                id="local-openai",
                label="Local / OpenAI-compatible VLM",
                available=bool(self.settings.vlm_base_url),
                reason=None if self.settings.vlm_base_url else "Set VIDEOZ_VLM_BASE_URL to enable this provider.",
                default_model=self.settings.vlm_default_model,
                model_hint="Designed for Qwen3-VL behind vLLM or another OpenAI-compatible server.",
            ),
            CaptionProviderInfo(
                id="openrouter",
                label="OpenRouter",
                available=bool(self.settings.openrouter_api_key),
                reason=None if self.settings.openrouter_api_key else "Set VIDEOZ_OPENROUTER_API_KEY to enable this provider.",
                default_model="qwen/qwen3-vl-8b-instruct",
                model_hint="Any OpenRouter vision-capable model slug may be entered.",
            ),
        ]

    def get(self, provider_id: str) -> CaptionProvider:
        if provider_id == "mock":
            return MockCaptionProvider()
        if provider_id == "openrouter":
            if not self.settings.openrouter_api_key:
                raise RuntimeError("OpenRouter is not configured")
            return OpenAICompatibleCaptionProvider(
                "openrouter",
                self.settings.openrouter_base_url,
                self.settings.openrouter_api_key,
            )
        if provider_id == "local-openai":
            if not self.settings.vlm_base_url:
                raise RuntimeError("Local VLM endpoint is not configured")
            return OpenAICompatibleCaptionProvider(
                "local-openai",
                self.settings.vlm_base_url,
                self.settings.vlm_api_key,
            )
        raise RuntimeError(f"Unknown caption provider: {provider_id}")
