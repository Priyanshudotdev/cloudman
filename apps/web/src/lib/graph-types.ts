export interface GraphJson {
	version: number;
	name: string;
	nodes: Array<{
		id: string;
		type: string;
		label?: string;
		config?: Record<string, unknown>;
	}>;
	edges: Array<{ source: string; target: string; id?: string }>;
}
