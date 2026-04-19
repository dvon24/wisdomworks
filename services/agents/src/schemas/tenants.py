"""Pydantic mirror of tenants/tenant_configs tables from packages/db/src/schema/tenants.ts.

These models MUST stay in sync with the Drizzle ORM schema.
The schema contract test validates this alignment.
"""

from datetime import datetime
from enum import Enum
from typing import Any
from pydantic import BaseModel, Field


class TenantStatus(str, Enum):
    ONBOARDING = "onboarding"
    PROVISIONING = "provisioning"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DECOMMISSIONED = "decommissioned"


class Tenant(BaseModel):
    """Mirror of tenants table."""

    id: str = Field(..., description="UUID v7 primary key")
    name: str
    slug: str
    status: TenantStatus = TenantStatus.ONBOARDING
    created_at: datetime = Field(..., alias="createdAt")
    updated_at: datetime = Field(..., alias="updatedAt")

    model_config = {"populate_by_name": True}


class TenantConfig(BaseModel):
    """Mirror of tenant_configs table."""

    id: str = Field(..., description="UUID v7 primary key")
    tenant_id: str = Field(..., alias="tenantId")
    config_type: str = Field(..., alias="configType")
    config_data: dict[str, Any] = Field(..., alias="configData")
    created_at: datetime = Field(..., alias="createdAt")
    updated_at: datetime = Field(..., alias="updatedAt")

    model_config = {"populate_by_name": True}
