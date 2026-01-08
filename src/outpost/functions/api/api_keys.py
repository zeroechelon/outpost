import json
import os
import secrets
import hashlib
from datetime import datetime
import boto3
from src.outpost.models import APIKey
from src.outpost.services import AuditService

class APIKeyAPI:
    def __init__(self):
        self.dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
        self.table_name = os.environ.get("TENANTS_TABLE", "outpost-tenants-prod")
        self.table = self.dynamodb.Table(self.table_name)
        self.audit = AuditService()

    def generate_key(self, tenant_id: str, name: str):
        raw_key = f"op_live_{secrets.token_hex(16)}"
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
        key_id = f"key_{secrets.token_hex(4)}"
        
        api_key_obj = APIKey(
            key_hash=key_hash,
            tenant_id=tenant_id,
            name=name,
            scopes=["job:run"],
            created_at=datetime.utcnow()
        )
        
        item = api_key_obj.model_dump() # Keep as dict for DynamoDB
        item["created_at"] = api_key_obj.created_at.isoformat()
        item["sk"] = f"KEY#{key_id}"
        item["key_id"] = key_id
        
        self.table.put_item(Item=item)
        self.audit.log_action(tenant_id, "GENERATE_KEY", key_id, metadata={"name": name})
        
        return {
            "key_id": key_id,
            "name": name,
            "api_key": raw_key,
            "created_at": api_key_obj.created_at.isoformat()
        }

    def revoke_key(self, tenant_id: str, key_id: str):
        sk = f"KEY#{key_id}"
        try:
            self.table.update_item(
                Key={"tenant_id": tenant_id, "sk": sk},
                UpdateExpression="SET revoked = :r",
                ExpressionAttributeValues={":r": True}
            )
            self.audit.log_action(tenant_id, "REVOKE_KEY", key_id)
            return {"status": "revoked"}
        except Exception as e:
            print(f"Error revoking key: {e}")
            raise e

def handler(event, context):

    api = APIKeyAPI()

    http_method = event.get("httpMethod") or event.get("requestContext", {}).get("http", {}).get("method")

    path_params = event.get("pathParameters") or {}

    tenant_id = path_params.get("id")

    key_id = path_params.get("key_id")

    

    try:

        if not tenant_id:

            return {"statusCode": 400, "body": json.dumps({"error": "Missing tenant_id"})}



        if http_method == "POST":

            body = json.loads(event.get("body", "{}"))

            result = api.generate_key(tenant_id, body.get("name", "Default Key"))

            return {"statusCode": 201, "body": json.dumps(result)}

            

        elif http_method == "DELETE":

            if not key_id:

                return {"statusCode": 400, "body": json.dumps({"error": "Missing key_id"})}

            result = api.revoke_key(tenant_id, key_id)

            return {"statusCode": 200, "body": json.dumps(result)}

            

        return {"statusCode": 405, "body": json.dumps({"error": "Method not allowed"})}

        

    except Exception as e:

        print(f"Error: {e}")

        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
