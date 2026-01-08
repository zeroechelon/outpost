import unittest
import os
from moto import mock_aws
import boto3
from src.outpost.services.audit import AuditService

@mock_aws
class TestAuditService(unittest.TestCase):
    def setUp(self):
        self.region = "us-east-1"
        self.table_name = "outpost-audit-prod"
        os.environ["AUDIT_TABLE"] = self.table_name
        
        self.dynamodb = boto3.resource("dynamodb", region_name=self.region)
        self.table = self.dynamodb.create_table(
            TableName=self.table_name,
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
        self.service = AuditService(region_name=self.region)

    def test_log_action(self):
        self.service.log_action(
            tenant_id="ten_123",
            action="CREATE_JOB",
            resource="job_001",
            metadata={"agent": "claude"}
        )
        
        response = self.table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key("tenant_id").eq("ten_123")
        )
        items = response.get("Items", [])
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["action"], "CREATE_JOB")
        self.assertIn("expires_at", items[0])

    def test_get_tenant_audit(self):
        self.service.log_action("ten_123", "ACTION1", "res1")
        self.service.log_action("ten_123", "ACTION2", "res2")
        
        entries = self.service.get_tenant_audit("ten_123")
        self.assertEqual(len(entries), 2)
        # ScanIndexForward=False means newest first. ACTION2 should be first.
        self.assertEqual(entries[0].action, "ACTION2")

if __name__ == "__main__":
    unittest.main()
