module "dispatch_callback" {
  source = "../../modules/dispatch-callback"

  cluster_arn           = "arn:aws:ecs:us-east-1:311493921645:cluster/outpost-dev"
  dispatches_table_name = "outpost-dispatches"
  dispatches_table_arn  = "arn:aws:dynamodb:us-east-1:311493921645:table/outpost-dispatches"
  lambda_zip_path       = "${path.module}/../../../lambda/dispatch-callback/function.zip"

  tags = {
    Environment = "dev"
    Service     = "outpost"
    Purpose     = "dispatch-status-callback"
  }
}
