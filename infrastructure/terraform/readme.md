# ClimateGuard infrastructure (Terraform)

Describes the whole AWS stack as code: DynamoDB, Lambda + IAM, API Gateway,
S3 + CloudFront, CloudWatch alarm and dashboard.

Resources use the prefix `climateguard-tf`, so this stack sits beside the
hand-built one without touching it.

## Check the code (no AWS account needed)
    terraform init -backend=false
    terraform validate

## Preview or create it (needs AWS credentials, e.g. AWS CloudShell)
    terraform init
    terraform plan  -var="alert_email=you@example.com"
    terraform apply -var="alert_email=you@example.com"
    terraform destroy        # removes everything it created

Outputs: `site_url`, `api_url`, `history_table`.