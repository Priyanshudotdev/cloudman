import mongoose from "mongoose";

const { Schema, model } = mongoose;
const { ObjectId } = Schema.Types;

const projectSchema = new Schema(
	{
		_id: { type: ObjectId, auto: true },
		name: { type: String, required: true, minlength: 1, maxlength: 120 },
		description: { type: String, default: "" },
		/** better-auth emits fractional ids ("user_..."); store as plain strings. */
		ownerUserId: { type: String, required: true },
		/** infra = canvas/OpenTofu project; repo = git-repo deploy project. */
		kind: {
			type: String,
			enum: ["infra", "repo"],
			required: true,
			default: "infra",
		},
		/** Git repo configuration for kind=repo projects. */
		repo: {
			type: new Schema(
				{
					url: { type: String },
					branch: { type: String, default: "main" },
					/** Optional stack override fetched from packages/repo detection. */
					defaultStack: { type: String },
					/** Optional default target server for repo deploys. */
					serverId: { type: ObjectId, ref: "Server" },
				},
				{ _id: false },
			),
			default: () => ({}),
		},
		latestGraphVersion: { type: Number, required: true, default: 0 },
		createdAt: { type: Date, required: true, default: Date.now },
		updatedAt: { type: Date, required: true, default: Date.now },
	},
	{ collection: "projects" },
);
projectSchema.index({ ownerUserId: 1, updatedAt: -1 });

const Project =
	(mongoose.models.Project as mongoose.Model<any>) ??
	model("Project", projectSchema);

export { Project };
