from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

class TenantStatus(str, Enum):
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DELETED = "deleted"

class Tenant(BaseModel):
    tenant_id: str = Field(..., description="Unique tenant identifier (UUID or ULID)")
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., description="Tenant contact email")
    stripe_customer_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    status: TenantStatus = TenantStatus.ACTIVE

    class Config:
        from_attributes = True
