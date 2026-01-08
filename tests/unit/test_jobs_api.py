import unittest
import json
import os
from moto import mock_aws
import boto3
from src.outpost.functions.api.jobs import handler

@mock_aws
class TestJobAPI(unittest.TestCase):
    def setUp(self):
        self.region = "us-east-1"
        self.table_name = "outpost-jobs-prod"
        self.audit_table = "outpost-audit-prod"
        self.queue_name = "outpost-jobs-prod"
        
        os.environ["JOBS_TABLE"] = self.table_name
        os.environ["AUDIT_TABLE"] = self.audit_table
        
        self.dynamodb = boto3.resource("dynamodb", region_name=self.region)
        self.dynamodb.create_table(
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
        
        self.sqs = boto3.client("sqs", region_name=self.region)
        q = self.sqs.create_queue(QueueName=self.queue_name)
        os.environ["JOBS_QUEUE_URL"] = q["QueueUrl"]
        
        self.tenant_id = "ten_123"

    def test_submit_job(self):
        event = {
            "httpMethod": "POST",
            "requestContext": {"authorizer": {"tenant_id": self.tenant_id}},
            "body": json.dumps({"agent": "claude", "command": "ls", "priority": "high"})
        }
        response = handler(event, None)
        self.assertEqual(response["statusCode"], 201)
        job = json.loads(response["body"])
        self.assertEqual(job["status"], "pending")
        
        # Verify SQS message
        sqs_response = self.sqs.receive_message(QueueUrl=os.environ["JOBS_QUEUE_URL"])
        self.assertEqual(len(sqs_response["Messages"]), 1)

    def test_get_and_list_jobs(self):
        # Submit a job first
        self.test_submit_job()
        
        event = {
            "httpMethod": "GET",
            "requestContext": {"authorizer": {"tenant_id": self.tenant_id}}
        }
        response = handler(event, None)
        self.assertEqual(response["statusCode"], 200)
        jobs = json.loads(response["body"])
        self.assertEqual(len(jobs), 1)

    def test_cancel_job(self):
        # Submit
        event = {
            "httpMethod": "POST",
            "requestContext": {"authorizer": {"tenant_id": self.tenant_id}},
            "body": json.dumps({"agent": "claude", "command": "ls"})
        }
        res = handler(event, None)
        job_id = json.loads(res["body"])["job_id"]
        
        # Cancel
        event = {
            "httpMethod": "DELETE",
            "requestContext": {"authorizer": {"tenant_id": self.tenant_id}},
            "pathParameters": {"id": job_id}
        }
        response = handler(event, None)
        self.assertEqual(response["statusCode"], 200)
        
        # Verify status
        event = {
            "httpMethod": "GET",
            "requestContext": {"authorizer": {"tenant_id": self.tenant_id}},
            "pathParameters": {"id": job_id}
        }
        res = handler(event, None)
        job = json.loads(res["body"])
        self.assertEqual(job["status"], "cancelled")

if __name__ == "__main__":
    unittest.main()
