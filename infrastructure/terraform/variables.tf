variable "region" {
  description = "AWS region for everything except CloudFront (which is global)."
  type        = string
  default     = "ap-south-1"
}

variable "name_prefix" {
  description = "Prefix for every resource name. Different from the hand-built stack, so the two never clash."
  type        = string
  default     = "climateguard-tf"
}

variable "alert_email" {
  description = "Email address that receives CloudWatch alarm notifications. Leave empty to skip."
  type        = string
  default     = ""
}
