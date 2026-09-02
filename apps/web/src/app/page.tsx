"use client";

import { Button, buttonVariants } from "@my-better-t-app/ui/components/button";
import {
	Boxes,
	CheckCircle2,
	GitBranch,
	Network,
	Rocket,
	ScanSearch,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";

const VALUE_PROPS = [
	{
		icon: Network,
		title: "Design on a visual canvas",
		description:
			"Drag AWS resources onto a canvas and wire them together. See your architecture as a graph, not a config file.",
	},
	{
		icon: ScanSearch,
		title: "Review before you deploy",
		description:
			"Inspect the generated OpenTofu plan, estimated monthly cost, and risk analysis before anything touches your account.",
	},
	{
		icon: ShieldCheck,
		title: "Deploy with a human approval gate",
		description:
			"No silent changes. Every deployment pauses for review and approval, so you stay in control of your AWS account.",
	},
];

const STEPS = [
	{
		icon: Boxes,
		title: "Design",
		description:
			"Place resources on the canvas, configure them, and connect dependencies. Start from scratch, a template, or a natural-language prompt.",
	},
	{
		icon: GitBranch,
		title: "Review",
		description:
			"Validate the graph, inspect the compiled OpenTofu, see cost estimates and risk warnings. Nothing is deployed yet.",
	},
	{
		icon: Rocket,
		title: "Deploy",
		description:
			"Runs a plan against your account, then waits for your approval to apply. Watch live deployment events as they stream in.",
	},
];

const CAPABILITIES = [
	"25 AWS resource types",
	"OpenTofu generated on demand",
	"CloudFormation export",
	"Monthly cost estimation",
	"Security risk analysis",
	"Versioned graph history",
	"Live deployment event streaming",
	"Isolated worker with STS assume-role",
];

export default function Home() {
	return (
		<div className="flex flex-col overflow-y-auto">
			{/* Hero */}
			<section className="border-b">
				<div className="mx-auto max-w-4xl px-6 pt-20 pb-16 text-center sm:pt-28 sm:pb-24">
					<span className="mb-6 inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
						Visual infrastructure-as-code
					</span>
					<h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
						Design AWS infrastructure visually.{" "}
						<span className="text-brand">Deploy with confidence.</span>
					</h1>
					<p className="mx-auto mt-6 max-w-2xl text-base text-muted-foreground sm:text-lg">
						CloudMan turns a visual architecture canvas into production
						OpenTofu, reviewing cost and risk before anything reaches your AWS
						account.
					</p>
					<div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
						<Link
							href="/login"
							className={buttonVariants({ size: "lg" })}
						>
							<Rocket className="size-4" />
							Start Free
						</Link>
						<Link
							href="/dashboard"
							className={buttonVariants({ variant: "outline", size: "lg" })}
						>
							View Live Demo
						</Link>
					</div>
				</div>
			</section>

			{/* Product visual placeholder */}
			<section className="border-b">
				<div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
					<div className="overflow-hidden rounded-lg border bg-card shadow-sm">
						<div className="flex items-center justify-between border-b px-4 py-2.5">
							<div className="flex items-center gap-1.5">
								<span className="size-2.5 rounded-full bg-muted" />
								<span className="size-2.5 rounded-full bg-muted" />
								<span className="size-2.5 rounded-full bg-muted" />
							</div>
							<span className="font-mono text-xs text-muted-foreground">
								project canvas
							</span>
						</div>
						<div className="flex h-72 items-center justify-center bg-muted/40 sm:h-96">
							<div className="mx-auto max-w-md px-6 text-center">
								<Network className="mx-auto mb-4 size-8 text-muted-foreground" />
								<p className="text-sm text-muted-foreground">
									The CloudMan canvas — drag resources, wire dependencies,
									review the plan, deploy.
								</p>
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Value props */}
			<section className="border-b">
				<div className="mx-auto grid max-w-5xl gap-8 px-6 py-16 sm:grid-cols-3 sm:py-20">
					{VALUE_PROPS.map(({ icon: Icon, title, description }) => (
						<div key={title} className="flex flex-col gap-3">
							<div className="flex size-10 items-center justify-center rounded-md bg-brand-muted text-brand">
								<Icon className="size-5" />
							</div>
							<h3 className="text-base font-semibold">{title}</h3>
							<p className="text-sm text-muted-foreground">{description}</p>
						</div>
					))}
				</div>
			</section>

			{/* How it works */}
			<section className="border-b">
				<div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
					<h2 className="mb-10 text-center text-2xl font-semibold tracking-tight">
						From idea to infrastructure in three steps
					</h2>
					<div className="grid gap-10 sm:grid-cols-3 sm:gap-6">
						{STEPS.map(({ icon: Icon, title, description }, index) => (
							<div key={title} className="relative flex flex-col gap-3">
								<div className="flex items-center gap-3">
									<div className="flex size-10 items-center justify-center rounded-md border bg-card text-foreground">
										<Icon className="size-5 text-brand" />
									</div>
									<span className="font-mono text-sm text-muted-foreground">
										0{index + 1}
									</span>
								</div>
								<h3 className="text-base font-semibold">{title}</h3>
								<p className="text-sm text-muted-foreground">{description}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Capabilities */}
			<section className="border-b">
				<div className="mx-auto max-w-4xl px-6 py-16 sm:py-20">
					<h2 className="mb-8 text-center text-2xl font-semibold tracking-tight">
						Everything you need to design and ship infrastructure
					</h2>
					<ul className="mx-auto grid max-w-2xl gap-3 sm:grid-cols-2">
						{CAPABILITIES.map((capability) => (
							<li
								key={capability}
								className="flex items-center gap-2.5 text-sm"
							>
								<CheckCircle2 className="size-4 shrink-0 text-success" />
								{capability}
							</li>
						))}
					</ul>
				</div>
			</section>

			{/* Final CTA */}
			<section>
				<div className="mx-auto max-w-3xl px-6 py-16 text-center sm:py-24">
					<h2 className="text-3xl font-semibold tracking-tight">
						Ready to design your next stack?
					</h2>
					<p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground">
						Start designing infrastructure on a canvas and deploy it safely
						into your own account.
					</p>
					<Link
						href="/login"
						className={`${buttonVariants({ size: "lg" })} mt-8`}
					>
						Start Free
					</Link>
				</div>
			</section>

			{/* Footer */}
			<footer className="border-t">
				<div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
					<div className="flex items-center gap-2">
						<span className="font-semibold text-sm">CloudMan</span>
						<span className="text-xs text-muted-foreground">
							Visual AWS infrastructure control plane
						</span>
					</div>
					<div className="flex items-center gap-4 text-xs text-muted-foreground">
						<Link href="/dashboard" className="hover:text-foreground">
							App
						</Link>
						<Link href="/login" className="hover:text-foreground">
							Sign In
						</Link>
					</div>
				</div>
			</footer>
		</div>
	);
}
