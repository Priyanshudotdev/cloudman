"use client";

import { Checkbox } from "@my-better-t-app/ui/components/checkbox";
import { Input } from "@my-better-t-app/ui/components/input";
import { Label } from "@my-better-t-app/ui/components/label";

import type { FieldDescriptor, ResourceUiSpec } from "@/lib/resource-catalog";

interface ConfigPanelProps {
	spec: ResourceUiSpec | null;
	nodeId: string | null;
	nodeLabel: string;
	config: Record<string, unknown>;
	onChangeLabel: (label: string) => void;
	onChangeConfig: (key: string, value: unknown) => void;
}

export function ConfigPanel({
	spec,
	nodeId,
	nodeLabel,
	config,
	onChangeLabel,
	onChangeConfig,
}: ConfigPanelProps) {
	if (!spec || !nodeId) {
		return (
			<div className="border-l bg-card p-4 text-muted-foreground text-sm">
				Select a resource to configure it.
			</div>
		);
	}

	return (
		<div className="flex h-full w-72 flex-col overflow-y-auto border-l bg-card">
			<div className="border-b px-4 py-3">
				<p className="font-semibold text-sm">{spec.label}</p>
				<p className="font-mono text-[11px] text-muted-foreground">{nodeId}</p>
			</div>
			<div className="flex flex-col gap-4 p-4">
				<div className="grid gap-1.5">
					<Label htmlFor="node-label">Name</Label>
					<Input
						id="node-label"
						value={nodeLabel}
						onChange={(event) => onChangeLabel(event.target.value)}
					/>
				</div>
				{spec.fields.map((field) => (
					<FieldInput
						key={field.key}
						field={field}
						value={config[field.key]}
						onChange={(value) => onChangeConfig(field.key, value)}
					/>
				))}
			</div>
		</div>
	);
}

function FieldInput({
	field,
	value,
	onChange,
}: {
	field: FieldDescriptor;
	value: unknown;
	onChange: (value: unknown) => void;
}) {
	const id = `field-${field.key}`;

	if (field.type === "boolean") {
		return (
			<div className="flex items-center space-x-2">
				<Checkbox
					id={id}
					checked={Boolean(value)}
					onCheckedChange={(checked) => onChange(checked === true)}
				/>
				<Label htmlFor={id}>{field.label}</Label>
			</div>
		);
	}

	if (field.type === "select") {
		return (
			<div className="grid gap-1.5">
				<Label htmlFor={id}>{field.label}</Label>
				<select
					id={id}
					className="h-9 rounded-md border bg-background px-3 text-sm"
					value={String(value ?? field.default ?? "")}
					onChange={(event) => onChange(event.target.value)}
				>
					{(field.options ?? []).map((option) => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</select>
			</div>
		);
	}

	if (field.type === "number") {
		return (
			<div className="grid gap-1.5">
				<Label htmlFor={id}>
					{field.label}{" "}
					{field.optional ? (
						<span className="text-muted-foreground">(optional)</span>
					) : null}
				</Label>
				<Input
					id={id}
					type="number"
					min={field.min}
					max={field.max}
					placeholder={field.placeholder}
					value={value === undefined ? "" : String(value)}
					onChange={(event) =>
						onChange(
							event.target.value === ""
								? undefined
								: Number(event.target.value),
						)
					}
				/>
			</div>
		);
	}

	return (
		<div className="grid gap-1.5">
			<Label htmlFor={id}>
				{field.label}{" "}
				{field.optional ? (
					<span className="text-muted-foreground">(optional)</span>
				) : null}
			</Label>
			<Input
				id={id}
				type={field.type}
				placeholder={field.placeholder}
				value={String(value ?? "")}
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}
