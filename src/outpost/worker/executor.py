import os
import subprocess
from datetime import datetime
import boto3
from src.outpost.models import JobStatus
from src.outpost.services import AuditService
from src.outpost.secrets import SecretsManager

class Worker:
    def __init__(self):
        self.dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
        self.jobs_table_name = os.environ.get("JOBS_TABLE", "outpost-jobs-prod")
        self.table = self.dynamodb.Table(self.jobs_table_name)
        self.audit = AuditService()
        self.secrets = SecretsManager()

    def update_job_status(self, tenant_id: str, job_id: str, status: JobStatus, error: str = None):
        update_expr = "SET #s = :s, completed_at = :c"
        expr_attr_names = {"#s": "status"}
        expr_attr_values = {
            ":s": status.value,
            ":c": datetime.utcnow().isoformat() if status in [JobStatus.SUCCESS, JobStatus.FAILED] else None
        }
        
        if error:
            update_expr += ", error_message = :e"
            expr_attr_values[":e"] = error

        self.table.update_item(
            Key={"tenant_id": tenant_id, "job_id": job_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_attr_names,
            ExpressionAttributeValues=expr_attr_values
        )

    def execute(self, job_data: dict):
        tenant_id = job_data["tenant_id"]
        job_id = job_data["job_id"]
        agent = job_data["agent"]
        command = job_data["command"]

        # Update status to RUNNING
        self.update_job_status(tenant_id, job_id, JobStatus.RUNNING)
        self.audit.log_action(tenant_id, "START_JOB", job_id)

        # Workspace isolation
        workspace_dir = f"/tmp/outpost/workspaces/{tenant_id}/{job_id}"
        os.makedirs(workspace_dir, exist_ok=True)

        try:
            # Dispatch to agent CLI
            # This is a simplified version of dispatch.sh
            # In production, we'd use the actual agent CLI (claude, aider, etc.)
            
            # Example: Run as a subprocess
            # We might need to inject API keys here from Secrets Manager
            
            process = subprocess.Popen(
                command,
                shell=True,
                cwd=workspace_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            stdout, stderr = process.communicate(timeout=600) # 10 min timeout

            if process.returncode == 0:
                self.update_job_status(tenant_id, job_id, JobStatus.SUCCESS)
                self.audit.log_action(tenant_id, "JOB_SUCCESS", job_id)
            else:
                self.update_job_status(tenant_id, job_id, JobStatus.FAILED, error=stderr)
                self.audit.log_action(tenant_id, "JOB_FAILED", job_id, metadata={"error": stderr})

        except subprocess.TimeoutExpired:
            self.update_job_status(tenant_id, job_id, JobStatus.FAILED, error="Timeout expired")
            self.audit.log_action(tenant_id, "JOB_TIMEOUT", job_id)
        except Exception as e:
            self.update_job_status(tenant_id, job_id, JobStatus.FAILED, error=str(e))
            self.audit.log_action(tenant_id, "JOB_ERROR", job_id, metadata={"error": str(e)})
