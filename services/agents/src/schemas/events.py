"""Pydantic mirror of DomainEvent<T> from packages/shared/src/types/signals.ts.

This model MUST stay in sync with the TypeScript DomainEvent type.
The schema contract test validates this alignment.
"""

from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class DomainEvent(BaseModel):
    """Universal event wrapper for all NATS messages."""

    id: str = Field(..., description="UUID v7 — time-sortable, used as NATS dedup key")
    type: str = Field(..., description="Matches NATS subject: {domain}.{tenant_id}.{action}")
    tenant_id: str = Field(..., alias="tenantId", description="Tenant this event belongs to")
    timestamp: str = Field(..., description="ISO 8601 timestamp")
    source: str = Field(..., description="Originating service")
    data: Any = Field(..., description="Typed event payload")
    metadata: dict[str, Any] | None = Field(
        default=None, description="Optional metadata (requestId, correlationId, etc.)"
    )

    model_config = {
        "populate_by_name": True,
        "json_schema_extra": {
            "examples": [
                {
                    "id": "019756a0-b1c2-7def-8abc-123456789012",
                    "type": "signals.tenant123.created",
                    "tenantId": "tenant123",
                    "timestamp": "2026-04-19T10:00:00.000Z",
                    "source": "signal-layer",
                    "data": {"message": "hello"},
                }
            ]
        },
    }
