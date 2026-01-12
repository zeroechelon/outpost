# =============================================================================
# Outpost V2 - ECS Module Outputs
# =============================================================================

# -----------------------------------------------------------------------------
# Cluster Outputs
# -----------------------------------------------------------------------------

# NOTE: Cluster outputs commented out until T1.3.1 (ECS cluster) is activated
# output "cluster_arn" {
#   description = "ARN of the ECS cluster"
#   value       = aws_ecs_cluster.main.arn
# }

# output "cluster_name" {
#   description = "Name of the ECS cluster"
#   value       = aws_ecs_cluster.main.name
# }

# output "cluster_id" {
#   description = "ID of the ECS cluster"
#   value       = aws_ecs_cluster.main.id
# }

# -----------------------------------------------------------------------------
# Task Definition Outputs
# -----------------------------------------------------------------------------

output "task_definition_arns" {
  description = "Map of agent name to task definition ARN"
  value = {
    for agent, task_def in aws_ecs_task_definition.agent : agent => task_def.arn
  }
}

output "task_definition_families" {
  description = "Map of agent name to task definition family"
  value = {
    for agent, task_def in aws_ecs_task_definition.agent : agent => task_def.family
  }
}

output "task_definition_revisions" {
  description = "Map of agent name to task definition revision"
  value = {
    for agent, task_def in aws_ecs_task_definition.agent : agent => task_def.revision
  }
}

# -----------------------------------------------------------------------------
# IAM Role Outputs
# -----------------------------------------------------------------------------

output "execution_role_arn" {
  description = "ARN of the ECS task execution role"
  value       = aws_iam_role.execution.arn
}

output "execution_role_name" {
  description = "Name of the ECS task execution role"
  value       = aws_iam_role.execution.name
}

output "task_role_arn" {
  description = "ARN of the ECS task role"
  value       = aws_iam_role.task.arn
}

output "task_role_name" {
  description = "Name of the ECS task role"
  value       = aws_iam_role.task.name
}

# -----------------------------------------------------------------------------
# Security Group Outputs
# -----------------------------------------------------------------------------

# output "ecs_tasks_security_group_id" {
#   description = "ID of the security group for ECS tasks"
#   value       = aws_security_group.ecs_tasks.id
# }

# output "ecs_tasks_security_group_arn" {
#   description = "ARN of the security group for ECS tasks"
#   value       = aws_security_group.ecs_tasks.arn
# }

# -----------------------------------------------------------------------------
# CloudWatch Log Group Outputs
# -----------------------------------------------------------------------------

output "agent_log_group_names" {
  description = "Map of agent name to CloudWatch log group name"
  value = {
    for agent, log_group in aws_cloudwatch_log_group.agents : agent => log_group.name
  }
}

output "agent_log_group_arns" {
  description = "Map of agent name to CloudWatch log group ARN"
  value = {
    for agent, log_group in aws_cloudwatch_log_group.agents : agent => log_group.arn
  }
}

output "dispatches_log_group_name" {
  description = "Name of the dispatches CloudWatch log group"
  value       = aws_cloudwatch_log_group.dispatches.name
}

output "dispatches_log_group_arn" {
  description = "ARN of the dispatches CloudWatch log group"
  value       = aws_cloudwatch_log_group.dispatches.arn
}

# -----------------------------------------------------------------------------
# Service Outputs (if services are enabled)
# -----------------------------------------------------------------------------

# output "service_arns" {
#   description = "Map of agent name to ECS service ARN"
#   value = {
#     for agent, service in aws_ecs_service.agents : agent => service.id
#   }
# }

# output "service_names" {
#   description = "Map of agent name to ECS service name"
#   value = {
#     for agent, service in aws_ecs_service.agents : agent => service.name
#   }
# }

# -----------------------------------------------------------------------------
# Computed Values (useful for dependent modules)
# -----------------------------------------------------------------------------

output "cluster_name_computed" {
  description = "Computed cluster name (cluster_name-environment)"
  value       = "${var.cluster_name}-${var.environment}"
}

output "agent_names" {
  description = "List of configured agent names"
  value       = keys(var.agent_configs)
}
