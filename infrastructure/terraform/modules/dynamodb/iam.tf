data "aws_iam_policy_document" "read_write" {
  statement {
    actions = [
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan"
    ]

    resources = [
      aws_dynamodb_table.tenants.arn,
      "${aws_dynamodb_table.tenants.arn}/index/*",
      aws_dynamodb_table.jobs.arn,
      "${aws_dynamodb_table.jobs.arn}/index/*",
      aws_dynamodb_table.audit.arn,
      "${aws_dynamodb_table.audit.arn}/index/*"
    ]
  }
}

output "read_write_policy_json" {
  value = data.aws_iam_policy_document.read_write.json
}
