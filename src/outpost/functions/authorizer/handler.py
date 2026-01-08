import os
import hashlib
import boto3
from typing import Dict, Any, Optional
from src.outpost.models import APIKey, Tenant

class Authorizer:
    def __init__(self):
        self.dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
        self.tenants_table_name = os.environ.get("TENANTS_TABLE", "outpost-tenants-prod")
        self.table = self.dynamodb.Table(self.tenants_table_name)

    def _hash_key(self, api_key: str) -> str:
        return hashlib.sha256(api_key.encode()).hexdigest()

    def validate_key(self, api_key: str) -> Optional[Dict[str, Any]]:
        """
        Validates API key and returns tenant context if valid.
        """
        if not (api_key.startswith("op_live_") or api_key.startswith("op_test_")):
            return None

        key_hash = self._hash_key(api_key)
        
        # Query GSI api_key-index
        try:
            response = self.table.query(
                IndexName="api_key-index",
                KeyConditionExpression="api_key_hash = :h",
                ExpressionAttributeValues={":h": key_hash}
            )
            items = response.get("Items", [])
            if not items:
                return None
            
            key_data = items[0]
            # In a real scenario, we might want to check 'revoked' status here
            # But the GSI only has tenant_id and api_key_hash in simple projection
            # Let's assume the item has what we need
            
            if key_data.get("revoked", False):
                return None
                
            return {
                "tenant_id": key_data["tenant_id"],
                "scopes": key_data.get("scopes", ["job:run"]),
                "key_name": key_data.get("name", "default")
            }
        except Exception as e:
            print(f"Error validating key: {e}")
            return None

    def generate_policy(self, principal_id: str, effect: str, method_arn: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """
        Generates an IAM policy for API Gateway.
        """
        return {
            "principalId": principal_id,
            "policyDocument": {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Action": "execute-api:Invoke",
                        "Effect": effect,
                        "Resource": method_arn
                    }
                ]
            },
            "context": context
        }

def handler(event, context):
    auth_token = event.get("authorizationToken")
    method_arn = event.get("methodArn")
    
    if not auth_token:
        raise Exception("Unauthorized")

    # Expected format: "Bearer op_live_..."
    parts = auth_token.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        api_key = auth_token # Try raw if not bearer
    else:
        api_key = parts[1]

    authorizer = Authorizer()
    tenant_context = authorizer.validate_key(api_key)
    
    if tenant_context:
        return authorizer.generate_policy(
            principal_id=tenant_context["tenant_id"],
            effect="Allow",
            method_arn=method_arn,
            context=tenant_context
        )
    else:
        # In authorizer, returning 'Deny' is better than raising exception for performance
        return authorizer.generate_policy(
            principal_id="anonymous",
            effect="Deny",
            method_arn=method_arn,
            context={}
        )
