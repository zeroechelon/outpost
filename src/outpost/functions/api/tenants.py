import json
import os
import uuid
from datetime import datetime
import boto3
from src.outpost.models import Tenant, TenantStatus
from src.outpost.services import AuditService

class TenantAPI:
    def __init__(self):
        self.dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
        self.table_name = os.environ.get("TENANTS_TABLE", "outpost-tenants-prod")
        self.table = self.dynamodb.Table(self.table_name)
        self.audit = AuditService()

    def create_tenant(self, data: dict):
        tenant_id = f"ten_{uuid.uuid4().hex[:12]}"
        tenant = Tenant(
            tenant_id=tenant_id,
            name=data["name"],
            email=data["email"],
            status=TenantStatus.ACTIVE,
            created_at=datetime.utcnow()
        )
        
        item = tenant.model_dump()
        item["created_at"] = tenant.created_at.isoformat()
        item["sk"] = "METADATA"
        
        self.table.put_item(Item=item)
        self.audit.log_action(tenant_id, "CREATE_TENANT", tenant_id, metadata=data)
        
        return tenant.model_dump(mode="json")

    def get_tenant(self, tenant_id: str):
        response = self.table.get_item(Key={"tenant_id": tenant_id, "sk": "METADATA"})
        item = response.get("Item")
        if not item:
            return None
        return item

    def update_tenant(self, tenant_id: str, data: dict):
        # Simplified update
        update_expr = "SET #n = :n, email = :e"
        expr_attr_names = {"#n": "name"}
        expr_attr_values = {":n": data["name"], ":e": data["email"]}
        
        self.table.update_item(
            Key={"tenant_id": tenant_id, "sk": "METADATA"},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_attr_names,
            ExpressionAttributeValues=expr_attr_values
        )
        self.audit.log_action(tenant_id, "UPDATE_TENANT", tenant_id, metadata=data)
        return self.get_tenant(tenant_id)

    def delete_tenant(self, tenant_id: str):
        self.table.update_item(
            Key={"tenant_id": tenant_id, "sk": "METADATA"},
            UpdateExpression="SET #s = :s",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": TenantStatus.DELETED.value}
        )
        self.audit.log_action(tenant_id, "DELETE_TENANT", tenant_id)
        return {"status": "deleted"}

def handler(event, context):
    api = TenantAPI()
    http_method = event.get("httpMethod") or event.get("requestContext", {}).get("http", {}).get("method")
    path_params = event.get("pathParameters") or {}
    tenant_id = path_params.get("id")
    
    try:
        if http_method == "POST":
            body = json.loads(event.get("body", "{}"))
            result = api.create_tenant(body)
            return {"statusCode": 201, "body": json.dumps(result)}
        
        elif http_method == "GET":
            if tenant_id:
                result = api.get_tenant(tenant_id)
                if not result:
                    return {"statusCode": 404, "body": json.dumps({"error": "Not found"})}
                return {"statusCode": 200, "body": json.dumps(result)}
            else:
                return {"statusCode": 400, "body": json.dumps({"error": "Missing ID"})}
                
        elif http_method == "PATCH":
            body = json.loads(event.get("body", "{}"))
            result = api.update_tenant(tenant_id, body)
            return {"statusCode": 200, "body": json.dumps(result)}
            
        elif http_method == "DELETE":
            result = api.delete_tenant(tenant_id)
            return {"statusCode": 200, "body": json.dumps(result)}
            
        return {"statusCode": 405, "body": json.dumps({"error": "Method not allowed"})}
        
    except Exception as e:
        print(f"Error: {e}")
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
