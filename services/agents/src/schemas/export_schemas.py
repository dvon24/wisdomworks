"""Export Pydantic model schemas as JSON for cross-language contract testing.

Run: python -m services.agents.src.schemas.export_schemas
Output: services/agents/src/schemas/schemas.json
"""

import json
import sys
from pathlib import Path

from .events import DomainEvent
from .tenants import Tenant, TenantConfig

MODELS = {
    "DomainEvent": DomainEvent,
    "Tenant": Tenant,
    "TenantConfig": TenantConfig,
}


def export_schemas() -> dict:
    """Export all Pydantic models as JSON schemas."""
    schemas = {}
    for name, model in MODELS.items():
        schema = model.model_json_schema()
        # Extract field names and types for contract comparison
        properties = schema.get("properties", {})
        required = schema.get("required", [])
        fields = {}
        for field_name, field_info in properties.items():
            fields[field_name] = {
                "type": field_info.get("type", field_info.get("anyOf", "unknown")),
                "required": field_name in required,
                "nullable": "null" in str(field_info.get("anyOf", "")),
            }
        schemas[name] = {"fields": fields}
    return schemas


if __name__ == "__main__":
    output = export_schemas()
    output_path = Path(__file__).parent / "schemas.json"
    output_path.write_text(json.dumps(output, indent=2))
    print(f"Exported {len(output)} schemas to {output_path}")
