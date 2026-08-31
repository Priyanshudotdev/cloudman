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
