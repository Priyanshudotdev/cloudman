import mongoose from "mongoose";

const { Schema, model } = mongoose;
const { ObjectId } = Schema.Types;

/**
 * A deployable host (an IP / hostname) owned by a user. Mirrors the
 * AwsConnection pattern: secrets (the SSH key/password) are encrypted at rest
 * via the shared crypto helpers and CLOUDMAN_SECRET, and never returned by the
 * API once stored.
 */
const serverSchema = new Schema(
	{
		_id: { type: ObjectId, auto: true },
		/** better-auth emits fractional ids ("user_..."); store as plain strings. */
		userId: { type: String, required: true },
		label: { type: String, required: true, minlength: 1, maxlength: 80 },
		/** Hostname or IP address CloudMan connects to. */
		host: { type: String, required: true, minlength: 1, maxlength: 253 },
		port: { type: Number, required: true, default: 22, min: 1, max: 65535 },
		/** OS user CloudMan authenticates as on the host (e.g. root, deploy). */
		sshUser: { type: String, required: true, default: "root", minlength: 1 },
		/** Authenticate with a private key or a password. */
		authMode: {
			type: String,
			enum: ["key", "password"],
			required: true,
			default: "key",
		},
		/** Encrypted SSH private key (authMode=key) or password (authMode=password). */
		credentialEnc: { type: String, required: true },
		/** Remote directory the app is unpacked into on the host. */
		remoteAppDir: { type: String, default: "/srv/cloudman" },
		/** "disabled" means a deployment was attempted but the host-key check failed. */
		verifiedAt: { type: Date },
		createdAt: { type: Date, required: true, default: Date.now },
		updatedAt: { type: Date, required: true, default: Date.now },
	},
	{ collection: "servers" },
);
serverSchema.index({ userId: 1 });

const Server =
	(mongoose.models.Server as mongoose.Model<any>) ??
	model("Server", serverSchema);

export { Server };
