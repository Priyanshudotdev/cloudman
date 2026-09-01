"use client";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { AlertTriangle } from "lucide-react";

import { RESOURCE_SPECS } from "@/lib/resource-catalog";

export type ResourceNodeData = {
	[key: string]: unknown;
	resourceType: string;
	label: string;
	config: Record<string, unknown>;
};

export type ResourceFlowNode = Node<ResourceNodeData, "resource">;

export function ResourceNode({ data, selected }: NodeProps<ResourceFlowNode>) {
	const spec = RESOURCE_SPECS[data.resourceType];
	const Icon = spec?.icon;
	const accent = spec?.accent ?? "#64748b";

	// n8n-style: compact square card, dark bg, icon centered, title + type below outside? In reference image title is below node.
	// We render node box + external label.
	return (
		<div className="flex flex-col items-center">
			<div
				className="relative flex size-[88px] flex-col items-center justify-center rounded-[10px] border bg-[#3a3a3a] shadow-[0_2px_8px_rgba(0,0,0,0.35)] transition"
				style={{
					borderColor: selected ? "var(--brand)" : "rgba(255,255,255,0.12)",
					borderWidth: selected ? 2 : 1.2,
				}}
			>
				{/* left input handle — diamond-ish via square rotate? Use circle for simplicity */}
				<Handle
					type="target"
					position={Position.Left}
					className="!size-2.5 !border !border-[#1e1e1e] !bg-[#d0d0d0] dark:!bg-[#d0d0d0]"
					style={{ left: -5 }}
				/>
				{/* icon */}
				<span
					className="flex size-9 items-center justify-center rounded-md text-white shadow-sm"
					style={{ backgroundColor: accent }}
				>
					{Icon ? <Icon size={18} /> : null}
				</span>
				{/* warning triangle placeholder — shown at bottom right if you want to flag issues */}
				<span className="pointer-events-none absolute -bottom-1 -right-1 hidden">
					<AlertTriangle className="size-3 text-[var(--brand)]" />
				</span>
				<Handle
					type="source"
					position={Position.Right}
					className="!size-2.5 !border !border-[#1e1e1e] !bg-[#d0d0d0]"
					style={{ right: -5 }}
				/>
				{/* subtle inner border highlight when selected */}
				{selected && (
					<span className="pointer-events-none absolute inset-0 rounded-[10px] ring-1 ring-[var(--brand)]/20" />
				)}
			</div>
			{/* n8n labels below node */}
			<div className="mt-2 max-w-[128px] text-center">
				<p className="truncate text-xs font-medium leading-tight text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">
					{data.label}
				</p>
				<p className="truncate text-[10px] leading-tight text-white/55">
					{spec?.label ?? data.resourceType}
				</p>
			</div>
		</div>
	);
}
