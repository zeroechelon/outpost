# =============================================================================
# Outpost V2 - Production Environment Configuration
# =============================================================================

aws_region = "us-east-1"
vpc_cidr   = "10.1.0.0/16"

# Prod settings: high availability
max_agents                 = 20
enable_detailed_monitoring = true

# Alarm notifications
alarm_email_endpoints = [
  # Add production alert recipients here
]
