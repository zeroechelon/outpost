# =============================================================================
# Outpost V2 - CloudWatch Dashboards
# =============================================================================
#
# Purpose: Comprehensive monitoring dashboards for Outpost platform
#
# Dashboards:
#   1. Fleet Overview - ECS task counts, CPU/memory, failures, queue depth
#   2. Agent Performance - Success rates, durations, errors, concurrency
#   3. Infrastructure - VPC flow, NAT, EFS, S3 metrics
#
# =============================================================================

locals {
  agents     = ["claude", "codex", "gemini", "aider", "grok"]
  region     = data.aws_region.current.id
  account_id = data.aws_caller_identity.current.account_id
}

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# -----------------------------------------------------------------------------
# Variables for Dashboard Configuration
# -----------------------------------------------------------------------------

variable "sqs_queue_name" {
  description = "Name of the SQS jobs queue for queue depth metrics"
  type        = string
  default     = ""
}

variable "efs_file_system_id" {
  description = "EFS file system ID for throughput metrics"
  type        = string
  default     = ""
}

variable "s3_bucket_name" {
  description = "S3 bucket name for request metrics"
  type        = string
  default     = ""
}

variable "vpc_id" {
  description = "VPC ID for flow log metrics"
  type        = string
  default     = ""
}

variable "nat_gateway_id" {
  description = "NAT Gateway ID for data transfer metrics"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Fleet Overview Dashboard
# -----------------------------------------------------------------------------
# Primary dashboard for fleet-wide visibility into ECS task health and queue status

resource "aws_cloudwatch_dashboard" "fleet" {
  dashboard_name = "outpost-fleet-dashboard-${var.environment}"

  dashboard_body = jsonencode({
    widgets = concat(
      # Row 1: Header and Summary Metrics
      [
        {
          type   = "text"
          x      = 0
          y      = 0
          width  = 24
          height = 1
          properties = {
            markdown = "# Outpost Fleet Overview - ${upper(var.environment)}\nReal-time monitoring of ECS task execution across all agents"
          }
        }
      ],

      # Row 2: ECS Running Task Count per Agent
      [
        {
          type   = "metric"
          x      = 0
          y      = 1
          width  = 12
          height = 6
          properties = {
            title  = "Running Tasks by Agent"
            region = local.region
            view   = "timeSeries"
            stacked = true
            metrics = [
              for agent in local.agents : [
                "ECS/ContainerInsights",
                "RunningTaskCount",
                "ClusterName", var.ecs_cluster_name,
                "ServiceName", "outpost-${agent}-${var.environment}",
                { label = agent, stat = "Average", period = 60 }
              ]
            ]
            yAxis = {
              left = { min = 0, label = "Tasks" }
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 1
          width  = 12
          height = 6
          properties = {
            title  = "Task State Summary"
            region = local.region
            view   = "singleValue"
            metrics = [
              ["ECS/ContainerInsights", "RunningTaskCount", "ClusterName", var.ecs_cluster_name, { label = "Running", stat = "Sum", period = 60 }],
              ["ECS/ContainerInsights", "PendingTaskCount", "ClusterName", var.ecs_cluster_name, { label = "Pending", stat = "Sum", period = 60 }],
              ["ECS/ContainerInsights", "DesiredTaskCount", "ClusterName", var.ecs_cluster_name, { label = "Desired", stat = "Sum", period = 60 }]
            ]
          }
        }
      ],

      # Row 3: CPU Utilization per Agent
      [
        {
          type   = "metric"
          x      = 0
          y      = 7
          width  = 12
          height = 6
          properties = {
            title  = "CPU Utilization by Agent (%)"
            region = local.region
            view   = "timeSeries"
            stacked = false
            metrics = [
              for agent in local.agents : [
                "ECS/ContainerInsights",
                "CpuUtilized",
                "ClusterName", var.ecs_cluster_name,
                "ServiceName", "outpost-${agent}-${var.environment}",
                { label = agent, stat = "Average", period = 60 }
              ]
            ]
            yAxis = {
              left = { min = 0, max = 100, label = "%" }
            }
            annotations = {
              horizontal = [
                { value = 80, label = "Warning", color = "#ff7f0e" },
                { value = 95, label = "Critical", color = "#d62728" }
              ]
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 7
          width  = 12
          height = 6
          properties = {
            title  = "Memory Utilization by Agent (%)"
            region = local.region
            view   = "timeSeries"
            stacked = false
            metrics = [
              for agent in local.agents : [
                "ECS/ContainerInsights",
                "MemoryUtilized",
                "ClusterName", var.ecs_cluster_name,
                "ServiceName", "outpost-${agent}-${var.environment}",
                { label = agent, stat = "Average", period = 60 }
              ]
            ]
            yAxis = {
              left = { min = 0, max = 100, label = "%" }
            }
            annotations = {
              horizontal = [
                { value = 80, label = "Warning", color = "#ff7f0e" },
                { value = 95, label = "Critical", color = "#d62728" }
              ]
            }
          }
        }
      ],

      # Row 4: Task Failures and Queue Depth
      [
        {
          type   = "metric"
          x      = 0
          y      = 13
          width  = 12
          height = 6
          properties = {
            title  = "Task Failures (Last Hour)"
            region = local.region
            view   = "timeSeries"
            stacked = true
            metrics = [
              for agent in local.agents : [
                "ECS/ContainerInsights",
                "TaskSetTaskFailedCount",
                "ClusterName", var.ecs_cluster_name,
                "ServiceName", "outpost-${agent}-${var.environment}",
                { label = agent, stat = "Sum", period = 300 }
              ]
            ]
            yAxis = {
              left = { min = 0, label = "Failures" }
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 13
          width  = 12
          height = 6
          properties = {
            title  = "SQS Queue Depth"
            region = local.region
            view   = "timeSeries"
            metrics = var.sqs_queue_name != "" ? [
              ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", var.sqs_queue_name, { label = "Messages Waiting", stat = "Average", period = 60 }],
              ["AWS/SQS", "ApproximateNumberOfMessagesNotVisible", "QueueName", var.sqs_queue_name, { label = "In Flight", stat = "Average", period = 60 }],
              ["AWS/SQS", "ApproximateAgeOfOldestMessage", "QueueName", var.sqs_queue_name, { label = "Oldest Message (sec)", stat = "Maximum", period = 60, yAxis = "right" }]
            ] : []
            yAxis = {
              left  = { min = 0, label = "Messages" }
              right = { min = 0, label = "Seconds" }
            }
          }
        }
      ],

      # Row 5: Cluster-level Summary Gauges
      [
        {
          type   = "metric"
          x      = 0
          y      = 19
          width  = 6
          height = 4
          properties = {
            title   = "Cluster CPU Reserved"
            region  = local.region
            view    = "gauge"
            metrics = [
              ["ECS/ContainerInsights", "CpuReserved", "ClusterName", var.ecs_cluster_name, { stat = "Average", period = 300 }]
            ]
            yAxis = {
              left = { min = 0, max = 100 }
            }
          }
        },
        {
          type   = "metric"
          x      = 6
          y      = 19
          width  = 6
          height = 4
          properties = {
            title   = "Cluster Memory Reserved"
            region  = local.region
            view    = "gauge"
            metrics = [
              ["ECS/ContainerInsights", "MemoryReserved", "ClusterName", var.ecs_cluster_name, { stat = "Average", period = 300 }]
            ]
            yAxis = {
              left = { min = 0, max = 100 }
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 19
          width  = 6
          height = 4
          properties = {
            title   = "Network TX (bytes)"
            region  = local.region
            view    = "singleValue"
            metrics = [
              ["ECS/ContainerInsights", "NetworkTxBytes", "ClusterName", var.ecs_cluster_name, { stat = "Sum", period = 3600 }]
            ]
          }
        },
        {
          type   = "metric"
          x      = 18
          y      = 19
          width  = 6
          height = 4
          properties = {
            title   = "Network RX (bytes)"
            region  = local.region
            view    = "singleValue"
            metrics = [
              ["ECS/ContainerInsights", "NetworkRxBytes", "ClusterName", var.ecs_cluster_name, { stat = "Sum", period = 3600 }]
            ]
          }
        }
      ]
    )
  })
}

# -----------------------------------------------------------------------------
# Agent Performance Dashboard
# -----------------------------------------------------------------------------
# Detailed per-agent metrics for success rates, durations, and errors

resource "aws_cloudwatch_dashboard" "agent" {
  dashboard_name = "outpost-agent-dashboard-${var.environment}"

  dashboard_body = jsonencode({
    widgets = concat(
      # Row 1: Header
      [
        {
          type   = "text"
          x      = 0
          y      = 0
          width  = 24
          height = 1
          properties = {
            markdown = "# Outpost Agent Performance - ${upper(var.environment)}\nPer-agent task execution metrics, success rates, and error tracking"
          }
        }
      ],

      # Row 2: Success Rate per Agent (Custom Metrics from Application)
      [
        {
          type   = "metric"
          x      = 0
          y      = 1
          width  = 12
          height = 6
          properties = {
            title  = "Task Success Rate by Agent"
            region = local.region
            view   = "timeSeries"
            metrics = [
              for agent in local.agents : [
                "Outpost/Tasks",
                "SuccessRate",
                "Agent", agent,
                "Environment", var.environment,
                { label = agent, stat = "Average", period = 300 }
              ]
            ]
            yAxis = {
              left = { min = 0, max = 100, label = "%" }
            }
            annotations = {
              horizontal = [
                { value = 95, label = "Target SLA", color = "#2ca02c" },
                { value = 80, label = "Warning", color = "#ff7f0e" }
              ]
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 1
          width  = 12
          height = 6
          properties = {
            title  = "Task Success Rate Summary"
            region = local.region
            view   = "singleValue"
            metrics = [
              for agent in local.agents : [
                "Outpost/Tasks",
                "SuccessRate",
                "Agent", agent,
                "Environment", var.environment,
                { label = agent, stat = "Average", period = 3600 }
              ]
            ]
          }
        }
      ],

      # Row 3: Average Task Duration
      [
        {
          type   = "metric"
          x      = 0
          y      = 7
          width  = 12
          height = 6
          properties = {
            title  = "Average Task Duration by Agent (seconds)"
            region = local.region
            view   = "timeSeries"
            metrics = [
              for agent in local.agents : [
                "Outpost/Tasks",
                "Duration",
                "Agent", agent,
                "Environment", var.environment,
                { label = agent, stat = "Average", period = 300 }
              ]
            ]
            yAxis = {
              left = { min = 0, label = "Seconds" }
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 7
          width  = 12
          height = 6
          properties = {
            title  = "Task Duration Percentiles (All Agents)"
            region = local.region
            view   = "timeSeries"
            metrics = [
              ["Outpost/Tasks", "Duration", "Environment", var.environment, { label = "p50", stat = "p50", period = 300 }],
              ["Outpost/Tasks", "Duration", "Environment", var.environment, { label = "p90", stat = "p90", period = 300 }],
              ["Outpost/Tasks", "Duration", "Environment", var.environment, { label = "p99", stat = "p99", period = 300 }]
            ]
            yAxis = {
              left = { min = 0, label = "Seconds" }
            }
          }
        }
      ],

      # Row 4: Error Counts from Log Metric Filters
      [
        {
          type   = "metric"
          x      = 0
          y      = 13
          width  = 12
          height = 6
          properties = {
            title  = "Error Count by Agent"
            region = local.region
            view   = "timeSeries"
            stacked = true
            metrics = [
              for agent in local.agents : [
                "Outpost/Logs",
                "ErrorCount",
                "Agent", agent,
                "Environment", var.environment,
                { label = agent, stat = "Sum", period = 300 }
              ]
            ]
            yAxis = {
              left = { min = 0, label = "Errors" }
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 13
          width  = 12
          height = 6
          properties = {
            title  = "Error Rate by Type"
            region = local.region
            view   = "timeSeries"
            metrics = [
              ["Outpost/Logs", "TimeoutError", "Environment", var.environment, { label = "Timeout", stat = "Sum", period = 300 }],
              ["Outpost/Logs", "OOMError", "Environment", var.environment, { label = "Out of Memory", stat = "Sum", period = 300 }],
              ["Outpost/Logs", "APIError", "Environment", var.environment, { label = "API Error", stat = "Sum", period = 300 }],
              ["Outpost/Logs", "NetworkError", "Environment", var.environment, { label = "Network Error", stat = "Sum", period = 300 }]
            ]
            yAxis = {
              left = { min = 0, label = "Errors" }
            }
          }
        }
      ],

      # Row 5: Concurrent Task Count
      [
        {
          type   = "metric"
          x      = 0
          y      = 19
          width  = 12
          height = 6
          properties = {
            title  = "Concurrent Tasks by Agent"
            region = local.region
            view   = "timeSeries"
            stacked = true
            metrics = [
              for agent in local.agents : [
                "Outpost/Tasks",
                "ConcurrentTasks",
                "Agent", agent,
                "Environment", var.environment,
                { label = agent, stat = "Average", period = 60 }
              ]
            ]
            yAxis = {
              left = { min = 0, label = "Tasks" }
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 19
          width  = 12
          height = 6
          properties = {
            title  = "Task Throughput (tasks/minute)"
            region = local.region
            view   = "timeSeries"
            metrics = [
              for agent in local.agents : [
                "Outpost/Tasks",
                "TasksCompleted",
                "Agent", agent,
                "Environment", var.environment,
                { label = agent, stat = "Sum", period = 60 }
              ]
            ]
            yAxis = {
              left = { min = 0, label = "Tasks/min" }
            }
          }
        }
      ],

      # Row 6: Agent-specific deep dive table
      [
        {
          type   = "metric"
          x      = 0
          y      = 25
          width  = 24
          height = 3
          properties = {
            title   = "Agent Health Summary"
            region  = local.region
            view    = "table"
            metrics = flatten([
              for agent in local.agents : [
                ["Outpost/Tasks", "SuccessRate", "Agent", agent, "Environment", var.environment, { label = "${agent} Success %", stat = "Average", period = 3600 }],
                ["Outpost/Tasks", "Duration", "Agent", agent, "Environment", var.environment, { label = "${agent} Avg Duration", stat = "Average", period = 3600 }],
                ["Outpost/Tasks", "TasksCompleted", "Agent", agent, "Environment", var.environment, { label = "${agent} Completed", stat = "Sum", period = 3600 }]
              ]
            ])
          }
        }
      ]
    )
  })
}

# -----------------------------------------------------------------------------
# Infrastructure Dashboard
# -----------------------------------------------------------------------------
# VPC flow logs, NAT Gateway, EFS, and S3 metrics

resource "aws_cloudwatch_dashboard" "infra" {
  dashboard_name = "outpost-infra-dashboard-${var.environment}"

  dashboard_body = jsonencode({
    widgets = concat(
      # Row 1: Header
      [
        {
          type   = "text"
          x      = 0
          y      = 0
          width  = 24
          height = 1
          properties = {
            markdown = "# Outpost Infrastructure - ${upper(var.environment)}\nVPC, NAT Gateway, EFS, and S3 infrastructure metrics"
          }
        }
      ],

      # Row 2: VPC Flow Logs Summary
      [
        {
          type   = "metric"
          x      = 0
          y      = 1
          width  = 12
          height = 6
          properties = {
            title  = "VPC Traffic Volume (bytes)"
            region = local.region
            view   = "timeSeries"
            metrics = var.vpc_id != "" ? [
              ["AWS/VPC", "BytesIn", "VpcId", var.vpc_id, { label = "Bytes In", stat = "Sum", period = 300 }],
              ["AWS/VPC", "BytesOut", "VpcId", var.vpc_id, { label = "Bytes Out", stat = "Sum", period = 300 }]
            ] : []
            yAxis = {
              left = { min = 0, label = "Bytes" }
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 1
          width  = 12
          height = 6
          properties = {
            title  = "VPC Packet Counts"
            region = local.region
            view   = "timeSeries"
            metrics = var.vpc_id != "" ? [
              ["AWS/VPC", "PacketsIn", "VpcId", var.vpc_id, { label = "Packets In", stat = "Sum", period = 300 }],
              ["AWS/VPC", "PacketsOut", "VpcId", var.vpc_id, { label = "Packets Out", stat = "Sum", period = 300 }]
            ] : []
            yAxis = {
              left = { min = 0, label = "Packets" }
            }
          }
        }
      ],

      # Row 3: NAT Gateway Metrics
      [
        {
          type   = "metric"
          x      = 0
          y      = 7
          width  = 12
          height = 6
          properties = {
            title  = "NAT Gateway Data Transfer"
            region = local.region
            view   = "timeSeries"
            metrics = var.nat_gateway_id != "" ? [
              ["AWS/NATGateway", "BytesOutToDestination", "NatGatewayId", var.nat_gateway_id, { label = "Bytes Out", stat = "Sum", period = 300 }],
              ["AWS/NATGateway", "BytesInFromDestination", "NatGatewayId", var.nat_gateway_id, { label = "Bytes In", stat = "Sum", period = 300 }],
              ["AWS/NATGateway", "BytesOutToSource", "NatGatewayId", var.nat_gateway_id, { label = "Bytes to Source", stat = "Sum", period = 300 }],
              ["AWS/NATGateway", "BytesInFromSource", "NatGatewayId", var.nat_gateway_id, { label = "Bytes from Source", stat = "Sum", period = 300 }]
            ] : []
            yAxis = {
              left = { min = 0, label = "Bytes" }
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 7
          width  = 12
          height = 6
          properties = {
            title  = "NAT Gateway Connections & Packets"
            region = local.region
            view   = "timeSeries"
            metrics = var.nat_gateway_id != "" ? [
              ["AWS/NATGateway", "ActiveConnectionCount", "NatGatewayId", var.nat_gateway_id, { label = "Active Connections", stat = "Average", period = 60 }],
              ["AWS/NATGateway", "ConnectionEstablishedCount", "NatGatewayId", var.nat_gateway_id, { label = "New Connections", stat = "Sum", period = 60 }],
              ["AWS/NATGateway", "PacketsOutToDestination", "NatGatewayId", var.nat_gateway_id, { label = "Packets Out", stat = "Sum", period = 60, yAxis = "right" }]
            ] : []
            yAxis = {
              left  = { min = 0, label = "Connections" }
              right = { min = 0, label = "Packets" }
            }
          }
        }
      ],

      # Row 4: EFS Throughput and Connections
      [
        {
          type   = "metric"
          x      = 0
          y      = 13
          width  = 12
          height = 6
          properties = {
            title  = "EFS Throughput"
            region = local.region
            view   = "timeSeries"
            metrics = var.efs_file_system_id != "" ? [
              ["AWS/EFS", "TotalIOBytes", "FileSystemId", var.efs_file_system_id, { label = "Total IO", stat = "Sum", period = 60 }],
              ["AWS/EFS", "DataReadIOBytes", "FileSystemId", var.efs_file_system_id, { label = "Read IO", stat = "Sum", period = 60 }],
              ["AWS/EFS", "DataWriteIOBytes", "FileSystemId", var.efs_file_system_id, { label = "Write IO", stat = "Sum", period = 60 }],
              ["AWS/EFS", "MetadataIOBytes", "FileSystemId", var.efs_file_system_id, { label = "Metadata IO", stat = "Sum", period = 60 }]
            ] : []
            yAxis = {
              left = { min = 0, label = "Bytes" }
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 13
          width  = 12
          height = 6
          properties = {
            title  = "EFS Client Connections & Burst Credits"
            region = local.region
            view   = "timeSeries"
            metrics = var.efs_file_system_id != "" ? [
              ["AWS/EFS", "ClientConnections", "FileSystemId", var.efs_file_system_id, { label = "Client Connections", stat = "Sum", period = 60 }],
              ["AWS/EFS", "BurstCreditBalance", "FileSystemId", var.efs_file_system_id, { label = "Burst Credits", stat = "Average", period = 60, yAxis = "right" }]
            ] : []
            yAxis = {
              left  = { min = 0, label = "Connections" }
              right = { min = 0, label = "Credits" }
            }
          }
        }
      ],

      # Row 5: EFS Performance
      [
        {
          type   = "metric"
          x      = 0
          y      = 19
          width  = 12
          height = 6
          properties = {
            title  = "EFS Permitted Throughput vs Used"
            region = local.region
            view   = "timeSeries"
            metrics = var.efs_file_system_id != "" ? [
              ["AWS/EFS", "PermittedThroughput", "FileSystemId", var.efs_file_system_id, { label = "Permitted", stat = "Average", period = 60 }],
              ["AWS/EFS", "MeteredIOBytes", "FileSystemId", var.efs_file_system_id, { label = "Metered IO", stat = "Sum", period = 60 }]
            ] : []
            yAxis = {
              left = { min = 0, label = "Bytes/s" }
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 19
          width  = 12
          height = 6
          properties = {
            title  = "EFS Storage Bytes"
            region = local.region
            view   = "singleValue"
            metrics = var.efs_file_system_id != "" ? [
              ["AWS/EFS", "StorageBytes", "FileSystemId", var.efs_file_system_id, "StorageClass", "Total", { label = "Total Storage", stat = "Average", period = 86400 }],
              ["AWS/EFS", "StorageBytes", "FileSystemId", var.efs_file_system_id, "StorageClass", "Standard", { label = "Standard", stat = "Average", period = 86400 }],
              ["AWS/EFS", "StorageBytes", "FileSystemId", var.efs_file_system_id, "StorageClass", "InfrequentAccess", { label = "IA", stat = "Average", period = 86400 }]
            ] : []
          }
        }
      ],

      # Row 6: S3 Request Metrics
      [
        {
          type   = "metric"
          x      = 0
          y      = 25
          width  = 12
          height = 6
          properties = {
            title  = "S3 Request Counts"
            region = local.region
            view   = "timeSeries"
            metrics = var.s3_bucket_name != "" ? [
              ["AWS/S3", "AllRequests", "BucketName", var.s3_bucket_name, "FilterId", "EntireBucket", { label = "All Requests", stat = "Sum", period = 300 }],
              ["AWS/S3", "GetRequests", "BucketName", var.s3_bucket_name, "FilterId", "EntireBucket", { label = "GET Requests", stat = "Sum", period = 300 }],
              ["AWS/S3", "PutRequests", "BucketName", var.s3_bucket_name, "FilterId", "EntireBucket", { label = "PUT Requests", stat = "Sum", period = 300 }]
            ] : []
            yAxis = {
              left = { min = 0, label = "Requests" }
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 25
          width  = 12
          height = 6
          properties = {
            title  = "S3 Bytes Transferred"
            region = local.region
            view   = "timeSeries"
            metrics = var.s3_bucket_name != "" ? [
              ["AWS/S3", "BytesDownloaded", "BucketName", var.s3_bucket_name, "FilterId", "EntireBucket", { label = "Downloaded", stat = "Sum", period = 300 }],
              ["AWS/S3", "BytesUploaded", "BucketName", var.s3_bucket_name, "FilterId", "EntireBucket", { label = "Uploaded", stat = "Sum", period = 300 }]
            ] : []
            yAxis = {
              left = { min = 0, label = "Bytes" }
            }
          }
        }
      ],

      # Row 7: S3 Latency and Errors
      [
        {
          type   = "metric"
          x      = 0
          y      = 31
          width  = 12
          height = 6
          properties = {
            title  = "S3 Latency"
            region = local.region
            view   = "timeSeries"
            metrics = var.s3_bucket_name != "" ? [
              ["AWS/S3", "FirstByteLatency", "BucketName", var.s3_bucket_name, "FilterId", "EntireBucket", { label = "First Byte", stat = "Average", period = 300 }],
              ["AWS/S3", "TotalRequestLatency", "BucketName", var.s3_bucket_name, "FilterId", "EntireBucket", { label = "Total Request", stat = "Average", period = 300 }]
            ] : []
            yAxis = {
              left = { min = 0, label = "ms" }
            }
          }
        },
        {
          type   = "metric"
          x      = 12
          y      = 31
          width  = 12
          height = 6
          properties = {
            title  = "S3 Errors"
            region = local.region
            view   = "timeSeries"
            metrics = var.s3_bucket_name != "" ? [
              ["AWS/S3", "4xxErrors", "BucketName", var.s3_bucket_name, "FilterId", "EntireBucket", { label = "4xx Errors", stat = "Sum", period = 300 }],
              ["AWS/S3", "5xxErrors", "BucketName", var.s3_bucket_name, "FilterId", "EntireBucket", { label = "5xx Errors", stat = "Sum", period = 300 }]
            ] : []
            yAxis = {
              left = { min = 0, label = "Errors" }
            }
            annotations = {
              horizontal = [
                { value = 10, label = "Alert Threshold", color = "#d62728" }
              ]
            }
          }
        }
      ]
    )
  })
}
