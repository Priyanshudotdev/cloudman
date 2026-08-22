import mongoose from "mongoose";

const { Schema, model } = mongoose;
const { ObjectId } = Schema.Types;

const graphVersionSchema = new Schema(
	{
		_id: { type: ObjectId, auto: true },
		projectId: { type: ObjectId, ref: "Project", required: true },
		version: { type: Number, required: true, min: 1 },
		/** Raw CloudMan infrastructure graph JSON (nodes/edges/config). */
		graph: { type: Schema.Types.Mixed, required: true },
		createdByUserId: { type: ObjectId, ref: "User" },
		createdAt: { type: Date, required: true, default: Date.now },
	},
	{ collection: "graph_versions" },
);
graphVersionSchema.index({ projectId: 1, version: -1 }, { unique: true });

const GraphVersion =
	(mongoose.models.GraphVersion as mongoose.Model<any>) ??
	model("GraphVersion", graphVersionSchema);

export { GraphVersion };
