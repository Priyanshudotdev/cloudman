"use client";

import { Button } from "@my-better-t-app/ui/components/button";
import { Checkbox } from "@my-better-t-app/ui/components/checkbox";
import { Input } from "@my-better-t-app/ui/components/input";
import { Label } from "@my-better-t-app/ui/components/label";
import { Plus, X } from "lucide-react";

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

	if (field.type === "list") {
		return <ListFieldInput field={field} value={value} onChange={onChange} />;
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
			<Label>{field.label}</Label>
			{items.map((item, index) => (
				<div
					className="grid gap-2 rounded-md border bg-background/50 p-2.5"
					key={`ingress-${String(index)}`}
				>
					<div className="flex items-center justify-between">
						<p className="font-medium text-[11px] text-muted-foreground">
							Rule {index + 1}
						</p>
						<button
							aria-label={`Remove rule ${index + 1}`}
							className="text-muted-foreground transition-colors hover:text-destructive"
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
				className="w-full"
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
				<Label className="text-[11px]" htmlFor={id}>
					{field.label}
				</Label>
				<select
					className="h-8 rounded-md border bg-background px-2 text-xs"
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
			<Label className="text-[11px]" htmlFor={id}>
				{field.label}
			</Label>
			<Input
				className="h-8 text-xs"
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
