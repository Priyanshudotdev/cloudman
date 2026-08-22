"use client";

import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";

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
	const configEntries = Object.entries(data.config ?? {}).filter(
		([, value]) => value !== "" && value !== undefined,
	);

	return (
		<div
			className="w-56 rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow"
			style={{
				borderColor: selected ? accent : undefined,
				boxShadow: selected ? `0 0 0 2px ${accent}` : undefined,
			}}
		>
			<Handle type="target" position={Position.Top} />
			<div className="flex items-center gap-2 border-b px-3 py-2">
				<span
					className="flex h-7 w-7 items-center justify-center rounded-md text-white"
					style={{ backgroundColor: accent }}
				>
					{Icon ? <Icon size={15} /> : null}
				</span>
				<div className="min-w-0">
					<p className="truncate font-medium text-sm leading-tight">
						{data.label}
					</p>
					<p className="text-[11px] text-muted-foreground">
						{spec?.label ?? data.resourceType}
					</p>
				</div>
			</div>
			{configEntries.length > 0 && (
				<div className="flex flex-wrap gap-1 px-3 py-2">
					{configEntries.slice(0, 4).map(([key, value]) => (
						<span
							key={key}
							className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
						>
							{key}: {String(value)}
						</span>
					))}
					{configEntries.length > 4 && (
						<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
							+{configEntries.length - 4}
						</span>
					)}
				</div>
			)}
			<Handle type="source" position={Position.Bottom} />
		</div>
	);
}
