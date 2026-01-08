from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, Field

class APIKey(BaseModel):
    key_hash: str = Field(..., description="SHA-256 hash of the API key")
    tenant_id: str
    name: str = Field(..., description="Friendly name for the key")
    scopes: List[str] = Field(default_factory=lambda: ["job:run"])
    created_at: datetime = Field(default_factory=datetime.utcnow)
    last_used: Optional[datetime] = None
    revoked: bool = False

    class Config:
        from_attributes = True
