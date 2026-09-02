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

function sanitizeName(appName: string): string {
	return appName.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function systemdManifest(
	recipe: BuildRecipe,
	opts: RenderRuntimeOptions,
): RuntimeManifest {
	const name = sanitizeName(opts.appName);
	const start =
		recipe.startCommand
			?.replace(/\$PORT/g, String(opts.port))
			.replace(/\$APP_JAR/g, `${opts.runDir}/app.jar`) ?? "";

	const unit = `[Unit]
Description=${opts.appName}
After=network.target

[Service]
Type=simple
User=${opts.runUser}
WorkingDirectory=${opts.runDir}
Environment=PORT=${opts.port}
ExecStart=${start}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;

	return {
		processType: "systemd",
		files: [{ path: `/etc/systemd/system/${name}.service`, contents: unit }],
		commands: [
			"systemctl daemon-reload",
			`systemctl enable ${name}.service`,
			`systemctl restart ${name}.service`,
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
	const file = `module.exports = {
  apps: [{
    name: '${name}',
    cwd: '${opts.runDir}',
    script: '${start}',
    interpreter: 'none',
    env: { PORT: ${opts.port}, NODE_ENV: 'production' }
  }]
};
`;
	return {
		processType: "pm2",
		files: [{ path: `${opts.runDir}/ecosystem.config.cjs`, contents: file }],
		commands: [
			`cd ${opts.runDir} && pm2 start ecosystem.config.cjs`,
			`cd ${opts.runDir} && pm2 save`,
		],
	};
}

function nginxStaticManifest(opts: RenderRuntimeOptions): RuntimeManifest {
	const name = sanitizeName(opts.appName);
	const site = `server {
  listen 80;
  server_name ${opts.publicHost};

  root ${opts.runDir};
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \\.(js|css|png|jpg|jpeg|gif|svg|woff2?)$ {
    expires 30d;
    add_header Cache-Control "public, immutable";
  }
}
`;
	return {
		processType: "static",
		files: [
			{ path: `/etc/nginx/sites-available/${name}.conf`, contents: site },
		],
		commands: [
			`ln -sf /etc/nginx/sites-available/${name}.conf /etc/nginx/sites-enabled/${name}.conf`,
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
