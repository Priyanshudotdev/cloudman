variable "region" {
  type = string
  default = "us-east-1"
}

variable "instance_type" {
  type = string
  default = "t3.micro"
}

variable "ami" {
  type = string
  description = "AMI ID for the EC2 instance (region-specific)"
  default = "ami-02dfbd4ff395f2a1b"
}

variable "key_name" {
  type = string
  default = "MyPair"
}

variable "access_key" {
  type = string
  default = "AKIAUXVWBKUVL6UONK2C"
  }
  
  variable "secret_key" {
    type = string
    default = "uSN4YjX+vSxe0KB/kNwqit/PlllcuvsnPh+F6E1B"
}

variable "name" {
  type = string
  default = "fuckme"
}