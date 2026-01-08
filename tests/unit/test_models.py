import json
import unittest
from datetime import datetime
from src.outpost.models import Tenant, Job, AuditEntry, APIKey, JobStatus, AgentType

class TestModels(unittest.TestCase):
    def test_tenant_model(self):
        tenant = Tenant(
            tenant_id="ten_123",
            name="Acme Corp",
            email="admin@acme.com"
        )
        self.assertEqual(tenant.tenant_id, "ten_123")
        self.assertEqual(tenant.status, "active")
        
        # Verify JSON schema export
        schema = Tenant.model_json_schema()
        self.assertEqual(schema["title"], "Tenant")

    def test_job_model(self):
        job = Job(
            job_id="job_01JK8W2",
            tenant_id="ten_123",
            agent=AgentType.CLAUDE,
            command="ls -R"
        )
        self.assertEqual(job.status, JobStatus.PENDING)
        self.assertEqual(job.agent, "claude")
        
        schema = Job.model_json_schema()
        self.assertIn("AgentType", str(schema))

    def test_audit_entry_model(self):
        audit = AuditEntry(
            tenant_id="ten_123",
            action="CREATE_JOB",
            resource="job_01JK8W2",
            metadata={"foo": "bar"}
        )
        self.assertEqual(audit.action, "CREATE_JOB")
        self.assertEqual(audit.metadata["foo"], "bar")

    def test_api_key_model(self):
        api_key = APIKey(
            key_hash="abc123hash",
            tenant_id="ten_123",
            name="Prod Key"
        )
        self.assertEqual(api_key.name, "Prod Key")
        self.assertIn("job:run", api_key.scopes)

if __name__ == "__main__":
    # Generate schema file for blueprint output requirement
    schemas = {
        "Tenant": Tenant.model_json_schema(),
        "Job": Job.model_json_schema(),
        "AuditEntry": AuditEntry.model_json_schema(),
        "APIKey": APIKey.model_json_schema()
    }
    import os
    os.makedirs("infrastructure/dynamodb", exist_ok=True)
    with open("infrastructure/dynamodb/model_schemas.json", "w") as f:
        json.dump(schemas, f, indent=2)
    print("Schemas exported to infrastructure/dynamodb/model_schemas.json")
    
    unittest.main()