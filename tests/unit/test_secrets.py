import unittest
import time
from moto import mock_aws
import boto3
from src.outpost.secrets import SecretsManager

@mock_aws
class TestSecretsManager(unittest.TestCase):
    def setUp(self):
        self.region = "us-east-1"
        self.manager = SecretsManager(region_name=self.region)
        self.tenant_id = "ten_123"
        self.key_name = "prod-key"
        self.api_key = "sk_live_secret123"

    def test_create_and_get_secret(self):
        arn = self.manager.create_api_key_secret(self.tenant_id, self.key_name, self.api_key)
        self.assertIn(self.key_name, arn)
        
        retrieved = self.manager.get_api_key_secret(self.tenant_id, self.key_name)
        self.assertEqual(retrieved, self.api_key)

    def test_caching(self):
        self.manager.create_api_key_secret(self.tenant_id, self.key_name, self.api_key)
        
        # First call updates cache
        self.manager.get_api_key_secret(self.tenant_id, self.key_name)
        self.assertIn(self.manager._get_secret_name(self.tenant_id, self.key_name), self.manager._cache)
        
        # Manually update secret in backend
        client = boto3.client("secretsmanager", region_name=self.region)
        client.put_secret_value(
            SecretId=self.manager._get_secret_name(self.tenant_id, self.key_name),
            SecretString="new_secret"
        )
        
        # Should still get old secret from cache
        retrieved = self.manager.get_api_key_secret(self.tenant_id, self.key_name)
        self.assertEqual(retrieved, self.api_key)
        
        # Clear cache and get new secret
        self.manager._cache = {}
        retrieved = self.manager.get_api_key_secret(self.tenant_id, self.key_name)
        self.assertEqual(retrieved, "new_secret")

    def test_delete_secret(self):
        self.manager.create_api_key_secret(self.tenant_id, self.key_name, self.api_key)
        self.manager.delete_api_key_secret(self.tenant_id, self.key_name)
        
        with self.assertRaises(Exception):
            self.manager.get_api_key_secret(self.tenant_id, self.key_name)

if __name__ == "__main__":
    unittest.main()
