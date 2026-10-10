output "site_url" {
  description = "Public address of the dashboard."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "api_url" {
  description = "Try: <api_url>/risk?city=Nagpur"
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "history_table" {
  value = aws_dynamodb_table.history.name
}

