import { AwsConnectionsManager } from "@/components/settings/aws-connections";

export const dynamic = "force-dynamic";

export default async function AwsSettingsPage() {
	return <AwsConnectionsManager />;
}
