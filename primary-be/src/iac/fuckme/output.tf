output "instance_id" {
  value = aws_instance.fuckme.id
}

output "public_ip" {
  value = aws_instance.fuckme.public_ip
}

output "public_dns" {
  value = aws_instance.fuckme.public_dns
}