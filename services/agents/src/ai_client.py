"""Model Abstraction Layer — Python mirror of TypeScript AI client.

Uses the same ModelRoutingTable config format for consistency.
Supports Anthropic and OpenAI with failover.
"""

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import anthropic
import openai


@dataclass
class ModelCallResult:
    text: str
    provider: str
    model: str
    used_fallback: bool
    input_tokens: int
    output_tokens: int
    latency_ms: int


def call_anthropic(model: str, prompt: str, system: str | None = None, max_tokens: int = 1024) -> ModelCallResult:
    """Call Anthropic Claude API."""
    client = anthropic.Anthropic()
    start = time.monotonic()

    messages = [{"role": "user", "content": prompt}]
    kwargs: dict[str, Any] = {"model": model, "messages": messages, "max_tokens": max_tokens}
    if system:
        kwargs["system"] = system

    response = client.messages.create(**kwargs)

    return ModelCallResult(
        text=response.content[0].text if response.content else "",
        provider="anthropic",
        model=model,
        used_fallback=False,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
        latency_ms=int((time.monotonic() - start) * 1000),
    )


def call_openai(model: str, prompt: str, system: str | None = None, max_tokens: int = 1024) -> ModelCallResult:
    """Call OpenAI GPT API."""
    client = openai.OpenAI()
    start = time.monotonic()

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    response = client.chat.completions.create(model=model, messages=messages, max_tokens=max_tokens)

    choice = response.choices[0] if response.choices else None
    usage = response.usage

    return ModelCallResult(
        text=choice.message.content if choice and choice.message.content else "",
        provider="openai",
        model=model,
        used_fallback=False,
        input_tokens=usage.prompt_tokens if usage else 0,
        output_tokens=usage.completion_tokens if usage else 0,
        latency_ms=int((time.monotonic() - start) * 1000),
    )


PROVIDER_CALLERS = {
    "anthropic": call_anthropic,
    "openai": call_openai,
}


def call_model(
    routing_table: dict,
    task: str,
    prompt: str,
    system: str | None = None,
    max_tokens: int = 1024,
) -> ModelCallResult:
    """Call a model for a task with failover support."""
    route = routing_table.get(task)
    if not route:
        available = ", ".join(routing_table.keys())
        raise ValueError(f"No model route for task '{task}'. Available: {available}")

    provider = route["provider"]
    model = route["model"]
    caller = PROVIDER_CALLERS.get(provider)
    if not caller:
        raise ValueError(f"Unknown provider: {provider}")

    try:
        return caller(model, prompt, system, max_tokens)
    except Exception as primary_error:
        fallback = route.get("fallback")
        if fallback:
            fb_provider = fallback["provider"]
            fb_model = fallback["model"]
            fb_caller = PROVIDER_CALLERS.get(fb_provider)
            if fb_caller:
                try:
                    result = fb_caller(fb_model, prompt, system, max_tokens)
                    result.used_fallback = True
                    return result
                except Exception:
                    pass
        raise primary_error


def load_routing_table(path: str | Path | None = None) -> dict:
    """Load routing table from JSON file or return defaults."""
    if path and Path(path).exists():
        return json.loads(Path(path).read_text())

    # Default routing table (mirrors TypeScript DEFAULT_ROUTING_TABLE)
    return {
        "classification": {
            "task": "classification",
            "provider": "anthropic",
            "model": "claude-opus-4-7-20260420",
            "fallback": {"provider": "openai", "model": "gpt-5.4"},
        },
        "code_generation": {
            "task": "code_generation",
            "provider": "anthropic",
            "model": "claude-opus-4-7-20260420",
            "fallback": {"provider": "openai", "model": "gpt-5.4"},
        },
        "analysis": {
            "task": "analysis",
            "provider": "anthropic",
            "model": "claude-opus-4-7-20260420",
            "fallback": {"provider": "openai", "model": "gpt-5.4"},
        },
        "oversight": {
            "task": "oversight",
            "provider": "anthropic",
            "model": "claude-opus-4-7-20260420",
            "fallback": {"provider": "openai", "model": "gpt-5.4"},
        },
        "writing": {
            "task": "writing",
            "provider": "anthropic",
            "model": "claude-sonnet-4-6-20260416",
            "fallback": {"provider": "openai", "model": "gpt-5.4"},
        },
        "coaching": {
            "task": "coaching",
            "provider": "anthropic",
            "model": "claude-sonnet-4-6-20260416",
            "fallback": {"provider": "openai", "model": "gpt-5.4"},
        },
        "onboarding": {
            "task": "onboarding",
            "provider": "anthropic",
            "model": "claude-sonnet-4-6-20260416",
            "fallback": {"provider": "openai", "model": "gpt-5.4"},
        },
        "reminders": {
            "task": "reminders",
            "provider": "anthropic",
            "model": "claude-haiku-4-5-20251001",
            "fallback": {"provider": "openai", "model": "gpt-4o-mini"},
        },
        "formatting": {
            "task": "formatting",
            "provider": "openai",
            "model": "gpt-4o-mini",
            "fallback": {"provider": "anthropic", "model": "claude-haiku-4-5-20251001"},
        },
        "summarization": {
            "task": "summarization",
            "provider": "anthropic",
            "model": "claude-sonnet-4-6-20260416",
            "fallback": {"provider": "openai", "model": "gpt-5.4"},
        },
        "extraction": {
            "task": "extraction",
            "provider": "anthropic",
            "model": "claude-opus-4-7-20260420",
            "fallback": {"provider": "openai", "model": "gpt-5.4"},
        },
    }
