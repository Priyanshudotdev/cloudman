import { getAuth } from "@my-better-t-app/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { CanvasEditor } from "@/components/canvas/canvas-editor";

export const dynamic = "force-dynamic";

export default async function ProjectCanvasPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const auth = await getAuth();
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		redirect("/login");
	}

	const { id } = await params;

	return (
		<div className="h-full min-h-0">
			<CanvasEditor projectId={id} />
		</div>
	);
}
