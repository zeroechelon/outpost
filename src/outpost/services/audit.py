import boto3
import os
import time
from datetime import datetime
from typing import Dict, Any, Optional, List
from boto3.dynamodb.conditions import Key
from src.outpost.models import AuditEntry

class AuditService:
    def __init__(self, region_name: str = "us-east-1"):
        self.dynamodb = boto3.resource("dynamodb", region_name=region_name)
        self.table_name = os.environ.get("AUDIT_TABLE", "outpost-audit-prod")
        self.table = self.dynamodb.Table(self.table_name)
        self.retention_days = int(os.environ.get("AUDIT_RETENTION_DAYS", "90"))

    def log_action(
        self,
        tenant_id: str,
        action: str,
        resource: str,
        metadata: Optional[Dict[str, Any]] = None,
        request_id: Optional[str] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None
    ):
        """
        Logs an action to the audit table.
        """
        now = datetime.utcnow()
        expires_at = int(time.time()) + (self.retention_days * 24 * 60 * 60)
        
        entry = AuditEntry(
            tenant_id=tenant_id,
            timestamp=now,
            action=action,
            resource=resource,
            metadata=metadata or {},
            request_id=request_id,
            ip_address=ip_address,
            user_agent=user_agent
        )
        
        item = entry.model_dump()
        # Convert datetime to ISO string for DynamoDB
        item["timestamp"] = entry.timestamp.isoformat()
        item["expires_at"] = expires_at
        
        try:
            self.table.put_item(Item=item)
        except Exception as e:
            # In production, we might want to log this to CloudWatch or a DLQ
            print(f"Failed to log audit entry: {e}")

    def get_tenant_audit(self, tenant_id: str, limit: int = 50) -> List[AuditEntry]:
        """
        Retrieves audit entries for a tenant.
        """
        try:
            response = self.table.query(
                KeyConditionExpression=boto3.dynamodb.conditions.Key("tenant_id").eq(tenant_id),
                ScanIndexForward=False,  # Newest first
                Limit=limit
            )
            return [AuditEntry(**item) for item in response.get("Items", [])]
        except Exception as e:
            print(f"Failed to retrieve audit entries: {e}")
            return []
