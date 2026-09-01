"use client";

import { Boxes, Cloud, FileStack, HelpCircle, LayoutDashboard, Variable } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_TOP = [
	{ href: "/dashboard", label: "Overview", icon: LayoutDashboard },
	{ href: "/settings/aws", label: "AWS", icon: Boxes },
] as const;

const NAV_BOTTOM = [
	{ href: "/templates", label: "Templates", icon: FileStack },
	{ href: "/variables", label: "Variables", icon: Variable },
	{ href: "/help", label: "Help", icon: HelpCircle },
] as const;

function isActive(pathname: string, href: string) {
	if (href === "/dashboard") return pathname === "/dashboard";
	return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();

	return (
		<div className="flex h-full min-h-0">
			<aside className="hidden w-14 shrink-0 flex-col bg-[#2e2e2e] sm:flex">
				<div className="flex h-12 items-center justify-center border-b border-white/10">
					<Link href="/dashboard" aria-label="Home">
						<span className="flex size-7 items-center justify-center rounded-md bg-brand text-brand-foreground">
							<Cloud className="size-4" />
						</span>
					</Link>
				</div>
				<nav className="flex flex-1 flex-col gap-1 p-2">
					{NAV_TOP.map((item) => {
						const active = isActive(pathname, item.href);
						return (
							<Link
								key={item.href}
								href={item.href as any}
								className={`flex flex-col items-center gap-1 rounded-md px-1 py-2.5 text-[10px] leading-none transition-colors ${
									active ? "bg-white/[0.08] text-white" : "text-white/50 hover:bg-white/5 hover:text-white"
								}`}
							>
								<item.icon className="size-4" />
								<span className="font-medium">{item.label}</span>
							</Link>
						);
					})}
				</nav>
				<div className="flex flex-col gap-1 border-t border-white/10 p-2">
					{NAV_BOTTOM.map((item) => {
						const active = isActive(pathname, item.href);
						return (
							<Link
								key={item.href}
								href={item.href as any}
								className={`flex flex-col items-center gap-1 rounded-md px-1 py-2 text-[10px] leading-none transition-colors ${
									active ? "bg-white/[0.08] text-white" : "text-white/40 hover:text-white/70 hover:bg-white/5"
								}`}
							>
								<item.icon className="size-4" />
								<span>{item.label}</span>
							</Link>
						);
					})}
				</div>
			</aside>
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
				{children}
			</div>
		</div>
	);
}
