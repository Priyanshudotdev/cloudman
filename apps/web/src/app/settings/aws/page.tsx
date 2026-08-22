import { auth } from "@my-better-t-app/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AwsConnectionsManager } from "@/components/settings/aws-connections";

export default async function AwsSettingsPage() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		redirect("/login");
	}

	return <AwsConnectionsManager />;
}
