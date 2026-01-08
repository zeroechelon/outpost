from datetime import datetime
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field

class AuditEntry(BaseModel):
    tenant_id: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    action: str = Field(..., description="e.g., CREATE_JOB, REVOKE_KEY")
    resource: str = Field(..., description="e.g., job_id, api_key_id")
    metadata: Dict[str, Any] = Field(default_factory=dict)
    request_id: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None

    class Config:
        from_attributes = True
