import type { BuildRecipe } from "./types";

/**
 * Renders the runtime configuration CloudMan installs on the target host so
 * the deployed app actually runs and stays up. Used by the SSH driver via
 * `HostTransport`; the AWS-IaC driver ignores this and maps `runtimeShape` to
 * cloud resources instead.
 */

export interface RuntimeManifest {
	/** Files to write on the host, keyed by absolute path. */
	readonly files: ReadonlyArray<{ path: string; contents: string }>;
	/** Shell commands to run after files are written (start/reload/serve). */
	readonly commands: readonly string[];
	/** The process type used (mirrors the recipe). */
	readonly processType: BuildRecipe["processType"];
}

export interface RenderRuntimeOptions {
	/** Service identifier, e.g. the project name — safe for file/service names. */
	readonly appName: string;
	/** Working directory on the host where artifacts were unpacked. */
	readonly runDir: string;
	/** User the service runs as on the host. */
	readonly runUser: string;
	/** The resolved TCP port. */
	readonly port: number;
	/** Public FQDN or IP:port the app is reachable at (for nginx). */
	readonly publicHost: string;
}

/**
 * Shell single-quote escaping for values interpolated into systemd units,
 * nginx configs, and remote shell commands. `'` becomes `'\''` and the whole
 * value is wrapped in single quotes so spaces, `$`, `;`, backticks, etc. stay
 * literal.
 */
function sq(value: string): string {
	return "'" + value.replace(/'/g, "'\\''") + "'";
}

/**
 * JS single-quote escaping for values interpolated into the pm2 CJS module
 * (`script` / `cwd` are JS string literals, not shell). Escapes backslash and
 * single-quote plus newlines.
 */
function jsStr(value: string): string {
	return (
		"'" +
		value
			.replace(/\\/g, "\\\\")
			.replace(/'/g, "\\'")
			.replace(/\n/g, "\\n")
			.replace(/\r/g, "\\r") +
		"'"
	);
}

function sanitizeName(appName: string): string {
	const cleaned = appName.replace(/[^a-zA-Z0-9_.-]/g, "_");
	if (
		cleaned === "" ||
		cleaned === "." ||
		cleaned === ".." ||
		cleaned === "-" ||
		/^[.-]+$/.test(cleaned)
	) {
		return "app";
	}
	return cleaned;
}

function systemdManifest(
	recipe: BuildRecipe,
	opts: RenderRuntimeOptions,
): RuntimeManifest {
	const name = sanitizeName(opts.appName);
	const jarPath = sq(opts.runDir + "/app.jar");
	const start =
		recipe.startCommand
			?.replace(/\$PORT/g, String(opts.port))
			.replace(/\$APP_JAR/g, jarPath) ?? "";

	const unit =
		"[Unit]\n" +
		"Description=" +
		sq(opts.appName) +
		"\n" +
		"After=network.target\n" +
		"\n" +
		"[Service]\n" +
		"Type=simple\n" +
		"User=" +
		opts.runUser +
		"\n" +
		"WorkingDirectory=" +
		sq(opts.runDir) +
		"\n" +
		"Environment=PORT=" +
		String(opts.port) +
		"\n" +
		"ExecStart=" +
		start +
		"\n" +
		"Restart=always\n" +
		"RestartSec=5\n" +
		"\n" +
		"[Install]\n" +
		"WantedBy=multi-user.target\n";

	return {
		processType: "systemd",
		files: [
			{ path: "/etc/systemd/system/" + name + ".service", contents: unit },
		],
		commands: [
			"systemctl daemon-reload",
			"systemctl enable " + sq(name + ".service"),
			"systemctl restart " + sq(name + ".service"),
		],
	};
}

function pm2Manifest(
	recipe: BuildRecipe,
	opts: RenderRuntimeOptions,
): RuntimeManifest {
	const name = sanitizeName(opts.appName);
	const start =
		recipe.startCommand?.replace(/\$PORT/g, String(opts.port)) ?? "npm start";
	const file =
		"module.exports = {\n" +
		"  apps: [{\n" +
		"    name: " +
		jsStr(name) +
		",\n" +
		"    cwd: " +
		jsStr(opts.runDir) +
		",\n" +
		"    script: " +
		jsStr(start) +
		",\n" +
		"    interpreter: 'none',\n" +
		"    env: { PORT: " +
		String(opts.port) +
		", NODE_ENV: 'production' }\n" +
		"  }]\n" +
		"};\n";
	return {
		processType: "pm2",
		files: [{ path: opts.runDir + "/ecosystem.config.cjs", contents: file }],
		commands: [
			"cd " + sq(opts.runDir) + " && pm2 start ecosystem.config.cjs",
			"cd " + sq(opts.runDir) + " && pm2 save",
		],
	};
}

function nginxStaticManifest(opts: RenderRuntimeOptions): RuntimeManifest {
	const name = sanitizeName(opts.appName);
	const site =
		"server {\n" +
		"  listen 80;\n" +
		"  server_name " +
		sq(opts.publicHost) +
		";\n" +
		"\n" +
		"  root " +
		sq(opts.runDir) +
		";\n" +
		"  index index.html;\n" +
		"\n" +
		"  location / {\n" +
		"    try_files $uri $uri/ /index.html;\n" +
		"  }\n" +
		"\n" +
		"  location ~* \\.(js|css|png|jpg|jpeg|gif|svg|woff2?)$ {\n" +
		"    expires 30d;\n" +
		'    add_header Cache-Control "public, immutable";\n' +
		"  }\n" +
		"}\n";
	return {
		processType: "static",
		files: [
			{ path: "/etc/nginx/sites-available/" + name + ".conf", contents: site },
		],
		commands: [
			"ln -sf " +
				sq("/etc/nginx/sites-available/" + name + ".conf") +
				" " +
				sq("/etc/nginx/sites-enabled/" + name + ".conf"),
			"nginx -t && systemctl reload nginx || systemctl restart nginx",
		],
	};
}

/** Render the full runtime manifest for a build recipe and options. */
export function renderRuntime(
	recipe: BuildRecipe,
	opts: RenderRuntimeOptions,
): RuntimeManifest {
	if (recipe.processType === "systemd") return systemdManifest(recipe, opts);
	if (recipe.processType === "pm2") return pm2Manifest(recipe, opts);
	return nginxStaticManifest(opts);
}

export { sanitizeName };
