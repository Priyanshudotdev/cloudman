import "@my-better-t-app/env/web";
import type { NextConfig } from "next";

const API_REWRITE_PREFIXES = [
	"/api/projects/:path*",
	"/api/analytics/:path*",
	"/api/deployments/:path*",
	"/api/compile/:path*",
	"/api/aws-connections/:path*",
	"/api/generate/:path*",
	"/api/blueprints/:path*",
	"/api/servers/:path*",
	"/api/repo-deployments/:path*",
];

const nextConfig: NextConfig = {
	typedRoutes: true,
	reactCompiler: true,
	async rewrites() {
		const target = process.env.API_PROXY_TARGET?.replace(/\/$/, "");
		if (!target) return [];
		return API_REWRITE_PREFIXES.map((source) => ({
			source,
			destination: `${target}${source.replace(/:path\*$/, ":path*")}`,
		}));
	},
};

export default nextConfig;
