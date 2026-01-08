import unittest
import hashlib
import os
from moto import mock_aws
import boto3
from src.outpost.functions.authorizer.handler import handler, Authorizer

@mock_aws
class TestAuthorizer(unittest.TestCase):
    def setUp(self):
        self.region = "us-east-1"
        self.table_name = "outpost-tenants-prod"
        os.environ["TENANTS_TABLE"] = self.table_name
        
        self.dynamodb = boto3.resource("dynamodb", region_name=self.region)
        self.table = self.dynamodb.create_table(
            TableName=self.table_name,
            KeySchema=[{"AttributeName": "tenant_id", "KeyType": "HASH"}],
            AttributeDefinitions=[
                {"AttributeName": "tenant_id", "AttributeType": "S"},
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
        
        self.api_key = "op_live_1234567890abcdef1234567890abcdef"
        self.key_hash = hashlib.sha256(self.api_key.encode()).hexdigest()
        self.tenant_id = "ten_abc"
        
        self.table.put_item(Item={
            "tenant_id": self.tenant_id,
            "api_key_hash": self.key_hash,
            "name": "Test Key",
            "revoked": False,
            "scopes": ["job:run"]
        })

    def test_valid_key(self):
        event = {
            "authorizationToken": f"Bearer {self.api_key}",
            "methodArn": "arn:aws:execute-api:us-east-1:123456789012:api/prod/POST/jobs"
        }
        response = handler(event, None)
        self.assertEqual(response["policyDocument"]["Statement"][0]["Effect"], "Allow")
        self.assertEqual(response["principalId"], self.tenant_id)
        self.assertEqual(response["context"]["tenant_id"], self.tenant_id)

    def test_invalid_format(self):
        event = {
            "authorizationToken": "Bearer invalid_format",
            "methodArn": "arn:aws:execute-api:us-east-1:123456789012:api/prod/POST/jobs"
        }
        response = handler(event, None)
        self.assertEqual(response["policyDocument"]["Statement"][0]["Effect"], "Deny")

    def test_wrong_key(self):
        event = {
            "authorizationToken": "Bearer op_live_wrongkey",
            "methodArn": "arn:aws:execute-api:us-east-1:123456789012:api/prod/POST/jobs"
        }
        response = handler(event, None)
        self.assertEqual(response["policyDocument"]["Statement"][0]["Effect"], "Deny")

    def test_revoked_key(self):
        revoked_key = "op_live_revoked"
        revoked_hash = hashlib.sha256(revoked_key.encode()).hexdigest()
        self.table.put_item(Item={
            "tenant_id": "ten_revoked",
            "api_key_hash": revoked_hash,
            "revoked": True
        })
        
        event = {
            "authorizationToken": f"Bearer {revoked_key}",
            "methodArn": "arn:aws:execute-api:us-east-1:123456789012:api/prod/POST/jobs"
        }
        response = handler(event, None)
        self.assertEqual(response["policyDocument"]["Statement"][0]["Effect"], "Deny")

if __name__ == "__main__":
    unittest.main()
