"use client";
import { buttonVariants } from "@my-better-t-app/ui/components/button";
import { cn } from "@my-better-t-app/ui/lib/utils";
import { Cloud } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header() {
	const pathname = usePathname();
	const isLanding = pathname === "/";
	const isN8nShell =
		pathname === "/dashboard" ||
		pathname.startsWith("/projects/") ||
		pathname.startsWith("/settings/") ||
		pathname === "/templates" ||
		pathname === "/variables" ||
		pathname === "/help";

	if (isN8nShell) return null;

	const links = [
		{ to: "/dashboard", label: "Projects" },
		{ to: "/settings/aws", label: "AWS" },
	] as const;

	if (isLanding) {
		return (
			<header className="flex h-14 items-center justify-between border-b px-6">
				<Link
					href="/"
					className="flex items-center gap-2 font-semibold text-sm"
				>
					<span className="flex size-7 items-center justify-center rounded-md bg-brand text-brand-foreground">
						<Cloud className="size-4" />
					</span>
					CloudMan
				</Link>
				<div className="flex items-center gap-2">
					<ModeToggle />
					<Link
						href="/login"
						className={buttonVariants({ variant: "ghost", size: "sm" })}
					>
						Sign in
					</Link>
					<Link href="/login" className={buttonVariants({ size: "sm" })}>
						Start Free
					</Link>
				</div>
			</header>
		);
	}

	return (
		<header className="flex h-14 items-center justify-between border-b px-4 sm:px-6">
			<nav className="flex items-center gap-1">
				<Link
					href="/"
					className="mr-3 flex items-center gap-2 font-semibold text-sm"
				>
					<span className="flex size-7 items-center justify-center rounded-md bg-brand text-brand-foreground">
						<Cloud className="size-4" />
					</span>
					<span className="hidden sm:inline">CloudMan</span>
				</Link>
				{links.map(({ to, label }) => {
					const active =
						to === "/dashboard"
							? pathname === "/dashboard" ||
								pathname.startsWith("/projects/")
							: pathname.startsWith(to);
					return (
						<Link
							key={to}
							href={to as Route}
							className={cn(
								"rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
								active && "bg-muted text-foreground font-medium",
							)}
						>
							{label}
						</Link>
					);
				})}
			</nav>
			<div className="flex items-center gap-2">
				<ModeToggle />
				<UserMenu />
			</div>
		</header>
	);
}
