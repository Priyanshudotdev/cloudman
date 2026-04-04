resource "aws_instance" "another" {
    ami = var.ami
    instance_type = var.instance_type
    key_name = var.key_name
    region = var.region
    tags = {
      Name = "another"
    }
    provisioner "local-exec" {
      when    = destroy
      command = "echo 'Instance ${self.id} destroyed'"
    }
    }