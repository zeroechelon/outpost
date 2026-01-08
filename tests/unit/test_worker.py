import unittest
import os
import shutil
from moto import mock_aws
import boto3
from src.outpost.worker.executor import Worker
from src.outpost.models import JobStatus

@mock_aws
class TestWorker(unittest.TestCase):
    def setUp(self):
        self.region = "us-east-1"
        self.table_name = "outpost-jobs-prod"
        self.audit_table = "outpost-audit-prod"
        os.environ["JOBS_TABLE"] = self.table_name
        os.environ["AUDIT_TABLE"] = self.audit_table
        
        self.dynamodb = boto3.resource("dynamodb", region_name=self.region)
        self.table = self.dynamodb.create_table(
            TableName=self.table_name,
            KeySchema=[
                {"AttributeName": "tenant_id", "KeyType": "HASH"},
                {"AttributeName": "job_id", "KeyType": "RANGE"}
            ],
            AttributeDefinitions=[
                {"AttributeName": "tenant_id", "AttributeType": "S"},
                {"AttributeName": "job_id", "AttributeType": "S"}
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
        self.executor = Worker()

    def tearDown(self):
        if os.path.exists("/tmp/outpost"):
            shutil.rmtree("/tmp/outpost")

    def test_execute_success(self):
        job_id = "job_123"
        tenant_id = "ten_1"
        self.table.put_item(Item={
            "tenant_id": tenant_id,
            "job_id": job_id,
            "status": "pending"
        })
        
        job_data = {
            "tenant_id": tenant_id,
            "job_id": job_id,
            "agent": "claude",
            "command": "echo 'hello world'"
        }
        
        self.executor.execute(job_data)
        
        # Verify status
        res = self.table.get_item(Key={"tenant_id": tenant_id, "job_id": job_id})
        self.assertEqual(res["Item"]["status"], "success")

    def test_execute_failure(self):
        job_id = "job_456"
        tenant_id = "ten_1"
        self.table.put_item(Item={
            "tenant_id": tenant_id,
            "job_id": job_id,
            "status": "pending"
        })
        
        job_data = {
            "tenant_id": tenant_id,
            "job_id": job_id,
            "agent": "claude",
            "command": "exit 1"
        }
        
        self.executor.execute(job_data)
        
        # Verify status
        res = self.table.get_item(Key={"tenant_id": tenant_id, "job_id": job_id})
        self.assertEqual(res["Item"]["status"], "failed")

if __name__ == "__main__":
    unittest.main()
