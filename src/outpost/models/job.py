from datetime import datetime
from enum import Enum
from typing import Optional, Any
from pydantic import BaseModel, Field

class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"

class AgentType(str, Enum):
    CLAUDE = "claude"
    CODEX = "codex"
    GEMINI = "gemini"
    GROK = "grok"
    AIDER = "aider"

class Job(BaseModel):
    job_id: str = Field(..., description="Unique job identifier (ULID)")
    tenant_id: str = Field(..., description="Owner tenant ID")
    agent: AgentType
    command: str = Field(..., min_length=1)
    status: JobStatus = JobStatus.PENDING
    created_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: Optional[datetime] = None
    output_location: Optional[str] = Field(None, description="S3 URI or local path to results")
    error_message: Optional[str] = None

    class Config:
        from_attributes = True
