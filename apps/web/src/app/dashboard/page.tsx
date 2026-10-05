import { getAuth } from "@my-better-t-app/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ProjectHome } from "@/components/projects/project-home";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
	const session = await (await getAuth()).api.getSession({
		headers: await headers(),
	});
	if (!session?.user) redirect("/login");
	return <ProjectHome />;
}
