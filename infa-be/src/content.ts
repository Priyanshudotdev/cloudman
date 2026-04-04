export type varsType = {
  name: string;
  ami: string;
  instanceType: string;
  keyName: string;
  region: string;
  accessKey: string;
  privateKey: string;
  userPrompt?: string;
  sgName: string;
};

export const getVariables = (vars: varsType) => {
  const mainContent = `resource "aws_instance" "{{NAME}}" {
    ami = var.ami
    instance_type = var.instance_type
    key_name = var.key_name
    region = var.region
    tags = {
      Name = "{{NAME}}"
    }
    provisioner "local-exec" {
      when    = destroy
      command = "echo 'Instance \${self.id} destroyed'"
    }
    }`;

  const variableContent = `variable "region" {
      type = string
      default = "{{REGION}}"
    }

    variable "instance_type" {
      type = string
      default = "{{INSTANCE_TYPE}}"
    }

    variable "ami" {
      type = string
      description = "AMI ID for the EC2 instance (region-specific)"
      default = "{{AMI_ID}}"
    }

    variable "key_name" {
      type = string
      default = "{{KEYNAME}}"
    }

    variable "access_key" {
      type = string
      default = "{{ACCESS_KEY}}"
      }
      
      variable "secret_key" {
        type = string
        default = "{{PRIVATE_KEY}}"
    }`;

  const outputContent = `output "instance_id" {
    value = aws_instance.{{NAME}}.id
    }

    output "public_ip" {
      value = aws_instance.{{NAME}}.public_ip
    }

    output "public_dns" {
      value = aws_instance.{{NAME}}.public_dns
    }`;

  const providerOutput = `terraform {
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
    }`;

  return {
    variables: variableContent
      .replace(/\{\{NAME\}\}/g, vars.name)
      .replace(/\{\{ACCESS_KEY\}\}/g, vars.accessKey)
      .replace(/\{\{PRIVATE_KEY\}\}/g, vars.privateKey)
      .replace(/\{\{AMI_ID\}\}/g, vars.ami)
      .replace(/\{\{INSTANCE_TYPE\}\}/g, vars.instanceType)
      .replace(/\{\{REGION\}\}/g, vars.region)
      .replace(/\{\{KEYNAME\}\}/g, vars.keyName),

    main: mainContent.replace(/\{\{NAME\}\}/g, vars.name),

    output: outputContent.replace(/\{\{NAME\}\}/g, vars.name),

    provider: providerOutput,
  };
};
