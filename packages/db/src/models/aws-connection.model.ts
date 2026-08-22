import mongoose from "mongoose";

const { Schema, model } = mongoose;
const { ObjectId } = Schema.Types;

const awsConnectionSchema = new Schema(
	{
		_id: { type: ObjectId, auto: true },
		userId: { type: ObjectId, ref: "User", required: true },
		label: { type: String, required: true, minlength: 1, maxlength: 80 },
		roleArn: { type: String, required: true },
		externalId: { type: String, required: true },
		region: { type: String, required: true, default: "us-east-1" },
		createdAt: { type: Date, required: true, default: Date.now },
		updatedAt: { type: Date, required: true, default: Date.now },
	},
	{ collection: "aws_connections" },
);
awsConnectionSchema.index({ userId: 1 });

const AwsConnection =
	(mongoose.models.AwsConnection as mongoose.Model<any>) ??
	model("AwsConnection", awsConnectionSchema);

export { AwsConnection };
