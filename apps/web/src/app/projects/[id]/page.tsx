import { CanvasEditor } from "@/components/canvas/canvas-editor";

export const dynamic = "force-dynamic";

export default async function ProjectCanvasPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;

	return (
		<div className="h-full min-h-0">
			<CanvasEditor projectId={id} />
		</div>
	);
}
