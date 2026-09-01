"use client";

import { Button } from "@my-better-t-app/ui/components/button";
import { Checkbox } from "@my-better-t-app/ui/components/checkbox";
import { Input } from "@my-better-t-app/ui/components/input";
import { Label } from "@my-better-t-app/ui/components/label";
import { Plus, Trash2, X } from "lucide-react";

import type { FieldDescriptor, ResourceUiSpec } from "@/lib/resource-catalog";

interface ConfigPanelProps {
	spec: ResourceUiSpec | null;
	nodeId: string | null;
	nodeLabel: string;
	config: Record<string, unknown>;
	onChangeLabel: (label: string) => void;
	onChangeConfig: (key: string, value: unknown) => void;
	onRemove: () => void;
}

export function ConfigPanel({
	spec,
	nodeId,
	nodeLabel,
	config,
	onChangeLabel,
	onChangeConfig,
	onRemove,
}: ConfigPanelProps) {
	if (!spec || !nodeId) {
		return (
			<div className="flex w-72 shrink-0 items-start justify-center border-l border-white/10 bg-[#1e1e1e] p-6 text-sm text-white/40">
				Select a node to configure it.
			</div>
		);
	}

	return (
		<div className="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-l border-white/10 bg-[#1e1e1e] shadow-[-4px_0_16px_rgba(0,0,0,0.5)]">
			<div className="flex items-center justify-between border-b border-white/10 bg-[#1e1e1e] px-4 py-3">
				<div className="min-w-0">
					<p className="font-semibold text-sm text-white">{spec.label}</p>
					<p className="truncate font-mono text-[11px] text-white/40">
						{nodeId}
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					aria-label="Remove node"
					title="Remove node from canvas"
					className="h-8 w-8 shrink-0 p-0 text-white/40 hover:bg-white/10 hover:text-red-400"
					onClick={onRemove}
					type="button"
				>
					<Trash2 className="h-4 w-4" />
				</Button>
			</div>
			<div className="flex flex-col gap-4 p-4">
				<div className="grid gap-1.5">
					<Label htmlFor="node-label" className="text-white/80">Name</Label>
					<Input
						id="node-label"
						value={nodeLabel}
						onChange={(event) => onChangeLabel(event.target.value)}
						className="border-white/10 bg-[#2e2e2e] text-white placeholder:text-white/30"
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
					className="border-white/20 data-[state=checked]:bg-brand data-[state=checked]:border-brand"
				/>
				<Label htmlFor={id} className="text-white/80">{field.label}</Label>
			</div>
		);
	}

	if (field.type === "select") {
		return (
			<div className="grid gap-1.5">
				<Label htmlFor={id} className="text-white/70">{field.label}</Label>
				<select
					id={id}
					className="h-9 rounded-md border border-white/10 bg-[#2e2e2e] px-3 text-sm text-white"
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
				<Label htmlFor={id} className="text-white/70">
					{field.label}{" "}
					{field.optional ? (
						<span className="text-white/30">(optional)</span>
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
					className="border-white/10 bg-[#2e2e2e] text-white placeholder:text-white/30"
				/>
			</div>
		);
	}

	if (field.type === "list") {
		return <ListFieldInput field={field} value={value} onChange={onChange} />;
	}

	return (
		<div className="grid gap-1.5">
			<Label htmlFor={id} className="text-white/70">
				{field.label}{" "}
				{field.optional ? (
					<span className="text-white/30">(optional)</span>
				) : null}
			</Label>
			<Input
				id={id}
				type={field.type}
				placeholder={field.placeholder}
				value={String(value ?? "")}
				onChange={(event) => onChange(event.target.value)}
				className="border-white/10 bg-[#2e2e2e] text-white placeholder:text-white/30"
			/>
		</div>
	);
}

function ListFieldInput({
	field,
	value,
	onChange,
}: {
	field: FieldDescriptor;
	value: unknown;
	onChange: (value: unknown) => void;
}) {
	const itemFields = field.itemFields ?? [];

	if (field.itemType) {
		const items = Array.isArray(value) ? value : [];
		return (
			<div className="grid gap-2">
				<Label className="text-white/70">
					{field.label}{" "}
					{field.optional ? (
						<span className="text-white/30">(optional)</span>
					) : null}
				</Label>
				{items.map((item, index) => (
					<div className="flex items-center gap-2" key={`item-${index}`}>
						<Input
							type={field.itemType}
							placeholder={field.placeholder}
							value={String(item ?? "")}
							onChange={(event) =>
								onChange(
									items.map((existing, i) =>
										i === index
											? field.itemType === "number"
												? Number(event.target.value)
												: event.target.value
											: existing,
									),
								)
							}
							className="border-white/10 bg-[#2e2e2e] text-white placeholder:text-white/30"
						/>
						<button
							aria-label={`Remove value ${index + 1}`}
							className="text-white/40 transition-colors hover:text-red-400"
							onClick={() => onChange(items.filter((_, i) => i !== index))}
							type="button"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</div>
				))}
				<Button
					className="w-full border-white/10 bg-[#2e2e2e] text-white/70 hover:bg-white/10 hover:text-white"
					size="sm"
					variant="outline"
					onClick={() =>
						onChange([...items, field.itemType === "number" ? 0 : ""])
					}
					type="button"
				>
					+ Add value
				</Button>
			</div>
		);
	}

	const items = Array.isArray(value)
		? (value.filter(
				(item): item is Record<string, unknown> =>
					typeof item === "object" && item !== null,
			) as unknown[])
		: [];

	function updateItem(index: number, key: string, itemValue: unknown) {
		onChange(
			items.map((item, i) => {
				if (i !== index) return item;
				const record = item as Record<string, unknown>;
				return { ...record, [key]: itemValue };
			}),
		);
	}

	function addItem() {
		const blank = Object.fromEntries(
			itemFields.map((itemField) => [itemField.key, itemField.default]),
		);
		onChange([...items, blank]);
	}

	function removeItem(index: number) {
		onChange(items.filter((_, i) => i !== index));
	}

	return (
		<div className="grid gap-2">
			<Label className="text-white/70">{field.label}</Label>
			{items.map((item, index) => (
				<div
					className="grid gap-2 rounded-md border border-white/10 bg-[#2e2e2e] p-2.5"
					key={`ingress-${String(index)}`}
				>
					<div className="flex items-center justify-between">
						<p className="font-medium text-[11px] text-white/50">
							Rule {index + 1}
						</p>
						<button
							aria-label={`Remove rule ${index + 1}`}
							className="text-white/40 transition-colors hover:text-red-400"
							onClick={() => removeItem(index)}
							type="button"
						>
							<X className="h-3.5 w-3.5" />
						</button>
					</div>
					<div className="grid grid-cols-2 gap-2">
						{itemFields.map((itemField) => (
							<ItemFieldInput
								key={itemField.key}
								field={itemField}
								id={`ingress-${index}-${itemField.key}`}
								value={(item as Record<string, unknown>)[itemField.key]}
								onChange={(itemValue) =>
									updateItem(index, itemField.key, itemValue)
								}
							/>
						))}
					</div>
				</div>
			))}
			<Button
				className="w-full border-white/10 bg-[#2e2e2e] text-white/70 hover:bg-white/10 hover:text-white"
				disabled={itemFields.length === 0}
				size="sm"
				variant="outline"
				onClick={() => addItem()}
				type="button"
			>
				<Plus className="mr-1 h-3.5 w-3.5" /> Add rule
			</Button>
		</div>
	);
}

function ItemFieldInput({
	field,
	id,
	value,
	onChange,
}: {
	field: FieldDescriptor;
	id: string;
	value: unknown;
	onChange: (value: unknown) => void;
}) {
	if (field.type === "select") {
		return (
			<div className="grid gap-1">
				<Label className="text-[11px] text-white/60" htmlFor={id}>
					{field.label}
				</Label>
				<select
					className="h-8 rounded-md border border-white/10 bg-[#2e2e2e] px-2 text-xs text-white"
					id={id}
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

	return (
		<div className="grid gap-1">
			<Label className="text-[11px] text-white/60" htmlFor={id}>
				{field.label}
			</Label>
			<Input
				className="h-8 border-white/10 bg-[#2e2e2e] text-xs text-white placeholder:text-white/30"
				id={id}
				max={field.max}
				min={field.min}
				placeholder={field.placeholder}
				type={field.type}
				value={value === undefined ? "" : String(value)}
				onChange={(event) =>
					onChange(
						field.type === "number"
							? event.target.value === ""
								? undefined
								: Number(event.target.value)
							: event.target.value,
					)
				}
			/>
		</div>
	);
}
