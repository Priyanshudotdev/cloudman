output "instance_id" {
    value = aws_instance.another.id
    }

    output "public_ip" {
      value = aws_instance.another.public_ip
    }

    output "public_dns" {
      value = aws_instance.another.public_dns
    }