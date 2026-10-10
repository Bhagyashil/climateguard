data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# Database: risk history (rows expire after 30 days via TTL)
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "history" {
  name         = "${var.name_prefix}-history"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "place"
  range_key    = "checkedAt"

  attribute {
    name = "place"
    type = "S"
  }

  attribute {
    name = "checkedAt"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }
}

# ---------------------------------------------------------------------------
# Lambda: the risk engine
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.name_prefix}-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "history_access" {
  statement {
    actions   = ["dynamodb:PutItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.history.arn]
  }
}

resource "aws_iam_role_policy" "history" {
  name   = "history-access"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.history_access.json
}

data "archive_file" "lambda" {
  type        = "zip"
  output_path = "${path.module}/build/lambda.zip"

  source {
    content  = file("${path.module}/../../backend/handler.js")
    filename = "handler.js"
  }

  source {
    content  = file("${path.module}/../../backend/history.js")
    filename = "history.js"
  }

  source {
    content  = file("${path.module}/../../backend/risk-engine.js")
    filename = "risk-engine.js"
  }
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.name_prefix}-risk"
  retention_in_days = 14
}

resource "aws_lambda_function" "risk" {
  function_name    = "${var.name_prefix}-risk"
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  handler          = "handler.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  memory_size      = 256
  timeout          = 15

  environment {
    variables = {
      HISTORY_TABLE  = aws_dynamodb_table.history.name
      ALLOWED_ORIGIN = "https://${aws_cloudfront_distribution.site.domain_name}"
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

# ---------------------------------------------------------------------------
# API Gateway (HTTP API): GET /risk
# ---------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "http" {
  name          = "${var.name_prefix}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.risk.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "risk" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "GET /risk"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  # Rate limit so a public API cannot run up the bill.
  default_route_settings {
    throttling_rate_limit  = 5
    throttling_burst_limit = 10
  }
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.risk.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*/risk"
}

# ---------------------------------------------------------------------------
# Website: private S3 bucket served through CloudFront
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "site" {
  bucket = "${var.name_prefix}-web-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.name_prefix}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  default_root_object = "index.html"
  comment             = "${var.name_prefix} dashboard"

  origin {
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_id                = "s3-site"
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # AWS managed policy "CachingOptimized"
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_iam_policy_document" "site" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site.json
}

locals {
  frontend_dir  = "${path.module}/../../frontend"
  content_types = { html = "text/html", css = "text/css", js = "text/javascript" }
  # config.js is generated below (it needs this stack's API address), so skip the repo copy.
  site_files = toset([for f in fileset(local.frontend_dir, "*") : f if f != "config.js"])
}

resource "aws_s3_object" "site" {
  for_each = local.site_files

  bucket       = aws_s3_bucket.site.id
  key          = each.value
  source       = "${local.frontend_dir}/${each.value}"
  etag         = filemd5("${local.frontend_dir}/${each.value}")
  content_type = lookup(local.content_types, element(split(".", each.value), length(split(".", each.value)) - 1), "application/octet-stream")
}

resource "aws_s3_object" "config" {
  bucket       = aws_s3_bucket.site.id
  key          = "config.js"
  content      = "window.CLIMATEGUARD_API = \"${aws_apigatewayv2_api.http.api_endpoint}\";\n"
  content_type = "text/javascript"
}

# ---------------------------------------------------------------------------
# Monitoring: alarm + email, and a dashboard
# ---------------------------------------------------------------------------
resource "aws_sns_topic" "alerts" {
  name = "${var.name_prefix}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "api_5xx" {
  alarm_name          = "${var.name_prefix}-api-5xx"
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  dimensions          = { ApiId = aws_apigatewayv2_api.http.id }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = var.name_prefix

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric", x = 0, y = 0, width = 12, height = 6
        properties = {
          title   = "API requests and server errors"
          region  = var.region
          stat    = "Sum"
          period  = 300
          metrics = [["AWS/ApiGateway", "Count", "ApiId", aws_apigatewayv2_api.http.id], [".", "5xx", ".", "."]]
        }
      },
      {
        type   = "metric", x = 12, y = 0, width = 12, height = 6
        properties = {
          title   = "Lambda invocations and errors"
          region  = var.region
          stat    = "Sum"
          period  = 300
          metrics = [["AWS/Lambda", "Invocations", "FunctionName", aws_lambda_function.risk.function_name], [".", "Errors", ".", "."]]
        }
      },
      {
        type   = "metric", x = 0, y = 6, width = 12, height = 6
        properties = {
          title   = "Lambda duration (ms)"
          region  = var.region
          stat    = "Average"
          period  = 300
          metrics = [["AWS/Lambda", "Duration", "FunctionName", aws_lambda_function.risk.function_name]]
        }
      }
    ]
  })
}
