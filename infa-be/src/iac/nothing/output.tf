output "instance_id" {
  value = aws_instance.nothing.id
}

output "public_ip" {
  value = aws_instance.nothing.public_ip
}

output "public_dns" {
  value = aws_instance.nothing.public_dns
}
