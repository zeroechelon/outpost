import os
import json
import time
import signal
import boto3
from src.outpost.worker.executor import Worker

class JobPoller:
    def __init__(self):
        self.sqs = boto3.client("sqs", region_name="us-east-1")
        self.queue_url = os.environ.get("JOBS_QUEUE_URL")
        self.worker = Worker()
        self.running = True
        
        # Graceful shutdown
        signal.signal(signal.SIGTERM, self.stop)
        signal.signal(signal.SIGINT, self.stop)

    def stop(self, *args):
        print("Stopping worker...")
        self.running = False

    def start(self):
        print(f"Starting worker, polling {self.queue_url}...")
        while self.running:
            try:
                response = self.sqs.receive_message(
                    QueueUrl=self.queue_url,
                    MaxNumberOfMessages=1,
                    WaitTimeSeconds=20, # Long polling
                    MessageAttributeNames=["All"]
                )
                
                messages = response.get("Messages", [])
                for message in messages:
                    self.process_message(message)
                    
            except Exception as e:
                print(f"Error polling SQS: {e}")
                time.sleep(5)

    def process_message(self, message):
        body = json.loads(message["Body"])
        receipt_handle = message["ReceiptHandle"]
        
        print(f"Processing job {body.get('job_id')} for tenant {body.get('tenant_id')}")
        
        try:
            self.worker.execute(body)
            # Delete message after successful execution
            self.sqs.delete_message(QueueUrl=self.queue_url, ReceiptHandle=receipt_handle)
        except Exception as e:
            print(f"Error executing job: {e}")
            # Message will eventually return to queue via visibility timeout

if __name__ == "__main__":
    poller = JobPoller()
    poller.start()
