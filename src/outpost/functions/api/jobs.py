import json
import os
import ulid
from datetime import datetime
import boto3
from src.outpost.models import Job, JobStatus, AgentType
from src.outpost.services import AuditService

class JobAPI:
    def __init__(self):
        self.dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
        self.sqs = boto3.client("sqs", region_name="us-east-1")
        self.jobs_table_name = os.environ.get("JOBS_TABLE", "outpost-jobs-prod")
        self.queue_url = os.environ.get("JOBS_QUEUE_URL")
        self.table = self.dynamodb.Table(self.jobs_table_name)
        self.audit = AuditService()

    def submit_job(self, tenant_id: str, data: dict):
        job_id = str(ulid.new())
        job = Job(
            job_id=job_id,
            tenant_id=tenant_id,
            agent=AgentType(data["agent"]),
            command=data["command"],
            status=JobStatus.PENDING,
            created_at=datetime.utcnow()
        )
        
        # 1. Save to DynamoDB
        item = job.model_dump(mode="json")
        self.table.put_item(Item=item)
        
        # 2. Submit to SQS
        if self.queue_url:
            self.sqs.send_message(
                QueueUrl=self.queue_url,
                MessageBody=json.dumps(item),
                MessageAttributes={
                    "TenantID": {"DataType": "String", "StringValue": tenant_id},
                    "JobID": {"DataType": "String", "StringValue": job_id},
                    "Priority": {"DataType": "String", "StringValue": data.get("priority", "normal")}
                }
            )
        
        self.audit.log_action(tenant_id, "SUBMIT_JOB", job_id, metadata=data)
        return item

    def get_job(self, tenant_id: str, job_id: str):
        response = self.table.get_item(Key={"tenant_id": tenant_id, "job_id": job_id})
        item = response.get("Item")
        if not item:
            return None
        return item

    def list_jobs(self, tenant_id: str, limit: int = 50):
        response = self.table.query(
            KeyConditionExpression=boto3.dynamodb.conditions.Key("tenant_id").eq(tenant_id),
            ScanIndexForward=False,
            Limit=limit
        )
        return response.get("Items", [])

    def cancel_job(self, tenant_id: str, job_id: str):
        # Only cancel if pending
        self.table.update_item(
            Key={"tenant_id": tenant_id, "job_id": job_id},
            UpdateExpression="SET #s = :s",
            ConditionExpression="#s = :pending",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={":s": JobStatus.CANCELLED.value, ":pending": JobStatus.PENDING.value}
        )
        self.audit.log_action(tenant_id, "CANCEL_JOB", job_id)
        return {"status": "cancelled"}

def handler(event, context):
    api = JobAPI()
    http_method = event.get("httpMethod") or event.get("requestContext", {}).get("http", {}).get("method")
    # In Lambda Authorizer context, tenant_id should be in authorizer context
    tenant_id = event.get("requestContext", {}).get("authorizer", {}).get("tenant_id")
    path_params = event.get("pathParameters") or {}
    job_id = path_params.get("id")
    
    if not tenant_id:
        # Fallback for testing or non-authorized routes (admin)
        tenant_id = event.get("headers", {}).get("X-Tenant-ID")

    try:
        if http_method == "POST":
            body = json.loads(event.get("body", "{}"))
            result = api.submit_job(tenant_id, body)
            return {"statusCode": 201, "body": json.dumps(result)}
            
        elif http_method == "GET":
            if job_id:
                result = api.get_job(tenant_id, job_id)
                if not result:
                    return {"statusCode": 404, "body": json.dumps({"error": "Not found"})}
                return {"statusCode": 200, "body": json.dumps(result)}
            else:
                result = api.list_jobs(tenant_id)
                return {"statusCode": 200, "body": json.dumps(result)}
                
        elif http_method == "DELETE":
            if not job_id:
                return {"statusCode": 400, "body": json.dumps({"error": "Missing job_id"})}
            result = api.cancel_job(tenant_id, job_id)
            return {"statusCode": 200, "body": json.dumps(result)}
            
        return {"statusCode": 405, "body": json.dumps({"error": "Method not allowed"})}
        
    except Exception as e:
        print(f"Error: {e}")
        return {"statusCode": 500, "body": json.dumps({"error": str(e)})}
