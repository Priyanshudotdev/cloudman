output "instance_id" {
    value = aws_instance.test.id
    }

    output "public_ip" {
      value = aws_instance.test.public_ip
    }

    output "public_dns" {
      value = aws_instance.test.public_dns
    }