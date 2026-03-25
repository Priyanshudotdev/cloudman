// access : default = "AKIAUXVWBKUVL6UONK2C"
// private default = "uSN4YjX+vSxe0KB/kNwqit/PlllcuvsnPh+F6E1B"

//ami-02dfbd4ff395f2a1b
//MyPair

export type varsType = {
  name: string;
  ami: string;
  instanceType: string;
  keyName: string;
  region: string;
  accessKey: string;
  privateKey: string;
};

export const getVariables = (vars: varsType) => {
  return {
    variables: `variable "region" {
      type = string
      default = "us-east-1"
    }

    variable "instance_type" {
      type = string
      default = "${vars.instanceType}"
    }

    variable "ami" {
      type = string
      description = "AMI ID for the EC2 instance (region-specific)"
      default = "${vars.ami}"
    }

    variable "key_name" {
      type = string
      default = "${vars.keyName}"
    }

    variable "access_key" {
      type = string
      default = "${vars.accessKey}"
      }
      
      variable "secret_key" {
        type = string
        default = "${vars.privateKey}"
    }`,

    main: `resource "aws_instance" "${vars.name}" {
    ami = var.ami
    instance_type = var.instance_type
    key_name = var.key_name
    region = var.region
    tags = {
      Name = "${vars.name}"
    }
    provisioner "local-exec" {
      command = "echo 'Instance \${self.id} destroyed'"
    }
    }`,

    output: `output "instance_id" {
    value = aws_instance.test.id
    }

    output "public_ip" {
      value = aws_instance.test.public_ip
    }

    output "public_dns" {
      value = aws_instance.test.public_dns
    }`,

    provider: `terraform {
  required_providers {
   aws = {
    source = "hashicorp/aws"
    version = ">= 5.0.0"
   }
  }
  required_version = ">= 1.5.0"
    }

    provider "aws" {
        access_key = var.access_key
        secret_key = var.secret_key
        region = "us-east-1"
    }`,
  };
};
