variable "region" {
  type    = string
  default = "{{REGION}}"
}

variable "instance_type" {
  type    = string
  default = "{{INSTANCE_TYPE}}"
}

variable "ami" {
  type    = string
  default = "{{AMI_ID}}"
}

variable "key_name" {
  type    = string
  default = "{{KEY_NAME}}"
}

variable "access_key" {
  type    = string
  default = "{{ACCESS_KEY}}"
}

variable "secret_key" {
  type    = string
  default = "{{SECRET_KEY}}"
}
