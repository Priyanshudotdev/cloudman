resource "aws_instance" "fuckme" {
  ami = var.ami
  instance_type = var.instance_type
  key_name = var.key_name
  region = var.region
  tags = {
    Name = "fuckme"
  }
  provisioner "local-exec" {
    command = "echo 'Instance ${self.id} destroyed'"
  }
}