resource "aws_instance" "test" {
    ami = var.ami
    instance_type = var.instance_type
    key_name = var.key_name
    region = var.region
    tags = {
      Name = "test"
    }
    provisioner "local-exec" {
      command = "echo 'Instance ${self.id} destroyed'"
    }
    }