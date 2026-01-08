import unittest
import json
import os
from moto import mock_aws
import boto3
from src.outpost.functions.api.tenants import handler as tenants_handler
from src.outpost.functions.api.api_keys import handler as keys_handler

@mock_aws
class TestTenantAPI(unittest.TestCase):
    def setUp(self):
        self.region = "us-east-1"
        self.table_name = "outpost-tenants-prod"
        self.audit_table = "outpost-audit-prod"
        os.environ["TENANTS_TABLE"] = self.table_name
        os.environ["AUDIT_TABLE"] = self.audit_table
        
        self.dynamodb = boto3.resource("dynamodb", region_name=self.region)
        self.dynamodb.create_table(
            TableName=self.table_name,
            KeySchema=[
                {"AttributeName": "tenant_id", "KeyType": "HASH"},
                {"AttributeName": "sk", "KeyType": "RANGE"}
            ],
            AttributeDefinitions=[
                {"AttributeName": "tenant_id", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "S"},
                {"AttributeName": "api_key_hash", "AttributeType": "S"}
            ],
            GlobalSecondaryIndexes=[
                {
                    "IndexName": "api_key-index",
                    "KeySchema": [{"AttributeName": "api_key_hash", "KeyType": "HASH"}],
                    "Projection": {"ProjectionType": "ALL"}
                }
            ],
            BillingMode="PAY_PER_REQUEST"
        )
        self.dynamodb.create_table(
            TableName=self.audit_table,
            KeySchema=[
                {"AttributeName": "tenant_id", "KeyType": "HASH"},
                {"AttributeName": "timestamp", "KeyType": "RANGE"}
            ],
            AttributeDefinitions=[
                {"AttributeName": "tenant_id", "AttributeType": "S"},
                {"AttributeName": "timestamp", "AttributeType": "S"}
            ],
            BillingMode="PAY_PER_REQUEST"
        )

    def test_tenant_lifecycle_and_keys(self):
        # 1. Create Tenant
        event = {
            "httpMethod": "POST",
            "body": json.dumps({"name": "Acme", "email": "admin@acme.com"})
        }
        response = tenants_handler(event, None)
        self.assertEqual(response["statusCode"], 201)
        tenant = json.loads(response["body"])
        tenant_id = tenant["tenant_id"]
        self.assertEqual(tenant["name"], "Acme")

        # 2. Get Tenant
        event = {
            "httpMethod": "GET",
            "pathParameters": {"id": tenant_id}
        }
        response = tenants_handler(event, None)
        self.assertEqual(response["statusCode"], 200)

        # 3. Generate API Key
        event = {
            "httpMethod": "POST",
            "pathParameters": {"id": tenant_id},
            "body": json.dumps({"name": "My Key"})
        }
        response = keys_handler(event, None)
        self.assertEqual(response["statusCode"], 201)
        key_data = json.loads(response["body"])
        self.assertIn("op_live_", key_data["api_key"])
        key_id = key_data["key_id"]

        # 4. Revoke API Key
        event = {
            "httpMethod": "DELETE",
            "pathParameters": {"id": tenant_id, "key_id": key_id}
        }
        response = keys_handler(event, None)
        self.assertEqual(response["statusCode"], 200)

        # 5. Delete Tenant
        event = {
            "httpMethod": "DELETE",
            "pathParameters": {"id": tenant_id}
        }
        response = tenants_handler(event, None)
        self.assertEqual(response["statusCode"], 200)

if __name__ == "__main__":
    unittest.main()
