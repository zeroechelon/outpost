import boto3
import json
import time
from typing import Optional, Dict, Any
from botocore.exceptions import ClientError

class SecretsManager:
    def __init__(self, region_name: str = "us-east-1"):
        self.client = boto3.client("secretsmanager", region_name=region_name)
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._cache_ttl = 300  # 5 minutes

    def _get_secret_name(self, tenant_id: str, key_name: str) -> str:
        return f"/outpost/tenants/{tenant_id}/api_keys/{key_name}"

    def create_api_key_secret(self, tenant_id: str, key_name: str, api_key: str) -> str:
        secret_name = self._get_secret_name(tenant_id, key_name)
        try:
            response = self.client.create_secret(
                Name=secret_name,
                SecretString=api_key,
                Description=f"API key for tenant {tenant_id}",
                Tags=[
                    {"Key": "TenantID", "Value": tenant_id},
                    {"Key": "Project", "Value": "outpost"}
                ]
            )
            return response["ARN"]
        except ClientError as e:
            if e.response["Error"]["Code"] == "ResourceExistsException":
                # Fallback to update if it exists (though usually we generate new names)
                self.client.put_secret_value(SecretId=secret_name, SecretString=api_key)
                return secret_name
            raise e

    def get_api_key_secret(self, tenant_id: str, key_name: str) -> str:
        secret_name = self._get_secret_name(tenant_id, key_name)
        
        # Check cache
        if secret_name in self._cache:
            entry = self._cache[secret_name]
            if time.time() - entry["timestamp"] < self._cache_ttl:
                return entry["value"]

        try:
            response = self.client.get_secret_value(SecretId=secret_name)
            value = response["SecretString"]
            
            # Update cache
            self._cache[secret_name] = {
                "value": value,
                "timestamp": time.time()
            }
            return value
        except ClientError as e:
            raise e

    def delete_api_key_secret(self, tenant_id: str, key_name: str, recovery_window: int = 7):
        secret_name = self._get_secret_name(tenant_id, key_name)
        try:
            self.client.delete_secret(
                SecretId=secret_name,
                RecoveryWindowInDays=recovery_window
            )
            # Invalidate cache
            if secret_name in self._cache:
                del self._cache[secret_name]
        except ClientError as e:
            if e.response["Error"]["Code"] != "ResourceNotFoundException":
                raise e
