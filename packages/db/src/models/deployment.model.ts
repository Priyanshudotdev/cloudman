import mongoose from "mongoose";

const { Schema, model } = mongoose;
const { ObjectId } = Schema.Types;

export const DEPLOYMENT_STATUSES = [
	"queued",
	"initializing",
	"planning",
	"planned",
	"awaiting_approval",
	"apply_queued",
	"applying",
	"completed",
	"failed",
	"canceled",
] as const;

export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

const planResourceSchema = new Schema(
	{
		address: { type: String, required: true },
		/** create | update | destroy */
		action: { type: String, required: true },
		name: { type: String },
	},
	{ _id: false },
);

const deploymentEventSchema = new Schema(
	{
		at: { type: Date, required: true, default: Date.now },
		/** info | success | error | progress */
		level: { type: String, required: true, default: "info" },
		message: { type: String, required: true },
		data: { type: Schema.Types.Mixed },
	},
	{ _id: false },
);

const deploymentSchema = new Schema(
	{
		_id: { type: ObjectId, auto: true },
		projectId: { type: ObjectId, ref: "Project", required: true },
		graphVersionId: { type: ObjectId, ref: "GraphVersion", required: true },
		status: {
			type: String,
			enum: DEPLOYMENT_STATUSES,
			required: true,
			default: "queued",
		},
		awsConnectionId: { type: ObjectId, ref: "AwsConnection" },
		region: { type: String },
		/** provision = create/update infrastructure, destroy = tear it down */
		action: {
			type: String,
			enum: ["provision", "destroy"],
			required: true,
			default: "provision",
		},
		planSummary: {
			create: { type: Number, default: 0 },
			update: { type: Number, default: 0 },
			destroy: { type: Number, default: 0 },
			resources: { type: [planResourceSchema], default: [] },
		},
		events: { type: [deploymentEventSchema], default: [] },
		/** Indicative monthly cost of the infra this deployment targets ($/mo). */
		estimatedMonthlyCost: { type: Number, default: 0 },
		error: { type: String },
		startedAt: { type: Date },
		completedAt: { type: Date },
		createdAt: { type: Date, required: true, default: Date.now },
		updatedAt: { type: Date, required: true, default: Date.now },
	},
	{ collection: "deployments" },
);
deploymentSchema.index({ projectId: 1, createdAt: -1 });

const Deployment =
	(mongoose.models.Deployment as mongoose.Model<any>) ??
	model("Deployment", deploymentSchema);

export { Deployment };
