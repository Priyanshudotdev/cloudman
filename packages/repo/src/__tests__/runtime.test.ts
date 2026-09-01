import { describe, expect, it } from "bun:test";
import { buildRecipe } from "../builders";
import { renderRuntime } from "../runtime";

const opts = {
	appName: "my-app",
	runDir: "/srv/my-app",
	runUser: "cloudman",
	port: 3000,
	publicHost: "app.example.com",
};

describe("renderRuntime", () => {
	it("renders a systemd unit for a Node/Next service", () => {
		const recipe = buildRecipe("next-node")!;
		const m = renderRuntime(recipe, opts);
		expect(m.processType).toBe("systemd");
		const unit = m.files[0]!.contents;
		expect(unit).toContain("Description=my-app");
		expect(unit).toContain("ExecStart=next start -p 3000");
		expect(unit).toContain("User=cloudman");
		expect(unit).toContain("WorkingDirectory=/srv/my-app");
		expect(m.commands).toContain("systemctl restart my-app.service");
	});

	it("substitutes the resolved port into the start command", () => {
		const recipe = buildRecipe("python-flask")!;
		const m = renderRuntime(recipe, { ...opts, port: 5000 });
		expect(m.files[0]!.contents).toContain("Environment=PORT=5000");
		expect(m.files[0]!.contents).toContain(
			"ExecStart=gunicorn --bind 0.0.0.0:5000 app:app",
		);
	});

	it("renders a pm2 config with a context module", () => {
		const recipe = buildRecipe("node-express")!;
		const m = renderRuntime(recipe, opts);
		expect(m.processType).toBe("pm2");
		expect(m.files[0]!.path).toContain("ecosystem.config.cjs");
		const cfg = m.files[0]!.contents;
		expect(cfg).toContain("name: 'my-app'");
		expect(cfg).toContain("PORT: 3000");
		expect(m.commands.some((c) => c.includes("pm2 start"))).toBe(true);
	});

	it("renders an nginx static site with SPA fallback", () => {
		const recipe = buildRecipe("react-vite")!;
		const m = renderRuntime(recipe, opts);
		expect(m.processType).toBe("static");
		expect(m.files[0]!.contents).toContain("root /srv/my-app");
		expect(m.files[0]!.contents).toContain("try_files $uri $uri/ /index.html;");
		expect(m.commands.some((c) => c.includes("nginx -t"))).toBe(true);
	});

	it("sanitizes unsafe app names in service/file names", async () => {
		const { sanitizeName } = await import("../runtime");
		expect(sanitizeName("My App (prod)")).toBe("My_App__prod_");
	});
});
