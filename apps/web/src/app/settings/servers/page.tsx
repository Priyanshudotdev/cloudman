import { ServersManager } from "@/components/settings/servers-manager";

export const dynamic = "force-dynamic";

export default async function ServersSettingsPage() {
	return <ServersManager />;
}
