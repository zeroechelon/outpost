resource "aws_apigatewayv2_api" "main" {
  name          = "${var.project_name}-api-${var.environment}"
  protocol_type = "HTTP"
  
  cors_configuration {
    allow_headers = ["content-type", "authorization"]
    allow_methods = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
    allow_origins = ["*"] # Restrict in production
    max_age       = 300
  }

  tags = var.tags
}

resource "aws_apigatewayv2_stage" "main" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = var.environment
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gw.arn
    format          = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
      tenantId       = "$context.authorizer.tenant_id"
    })
  }
}

resource "aws_cloudwatch_log_group" "api_gw" {
  name              = "/aws/api-gw/${aws_apigatewayv2_api.main.name}"
  retention_in_days = 30
}

resource "aws_apigatewayv2_authorizer" "main" {
  api_id                            = aws_apigatewayv2_api.main.id
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = "arn:aws:apigateway:${data.aws_region.current.name}:lambda:path/2015-03-31/functions/${var.authorizer_lambda_arn}/invocations"
  identity_sources                  = ["$request.header.Authorization"]
  name                              = "api-key-authorizer"
  authorizer_payload_format_version = "2.0"
  enable_simple_responses           = false
}

data "aws_region" "current" {}
