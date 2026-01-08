# Integrations
resource "aws_apigatewayv2_integration" "tenants" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.tenants_lambda_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "jobs" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.jobs_lambda_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "api_keys" {
  api_id           = aws_apigatewayv2_api.main.id
  integration_type = "AWS_PROXY"
  integration_uri  = var.api_keys_lambda_arn
  payload_format_version = "2.0"
}

# Routes
resource "aws_apigatewayv2_route" "create_tenant" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /tenants"
  target    = "integrations/${aws_apigatewayv2_integration.tenants.id}"
}

resource "aws_apigatewayv2_route" "get_tenant" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "GET /tenants/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.tenants.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.main.id
}

resource "aws_apigatewayv2_route" "update_tenant" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "PATCH /tenants/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.tenants.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.main.id
}

resource "aws_apigatewayv2_route" "delete_tenant" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "DELETE /tenants/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.tenants.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.main.id
}

resource "aws_apigatewayv2_route" "generate_key" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "POST /tenants/{id}/api-keys"
  target    = "integrations/${aws_apigatewayv2_integration.api_keys.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.main.id
}

resource "aws_apigatewayv2_route" "revoke_key" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "DELETE /tenants/{id}/api-keys/{key_id}"
  target    = "integrations/${aws_apigatewayv2_integration.api_keys.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.main.id
}

resource "aws_apigatewayv2_route" "jobs" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "ANY /jobs"
  target    = "integrations/${aws_apigatewayv2_integration.jobs.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.main.id
}

resource "aws_apigatewayv2_route" "jobs_id" {
  api_id    = aws_apigatewayv2_api.main.id
  route_key = "ANY /jobs/{id}"
  target    = "integrations/${aws_apigatewayv2_integration.jobs.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.main.id
}
