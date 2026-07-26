export interface CloudSmokeMetadataRecord {
	metadataPath: string;
	metadata: Record<string, unknown>;
}

export interface CloudSmokeLifecycleRecord {
	path: string;
	data: Record<string, unknown> & { agentId: string };
}

export function readCloudSmokeMetadata(artifactDir: string): CloudSmokeMetadataRecord[];
export function readLatestCloudSmokeMetadata(artifactDir: string): CloudSmokeMetadataRecord | undefined;
export function cloudAgentIdsFromMetadata(artifactDir: string): string[];
export function cloudLifecycleRecords(artifactDir: string): CloudSmokeLifecycleRecord[];
export function cloudAgentIdsFromLifecycleArtifacts(artifactDir: string): string[];
export function readCloudRunReport(input: CloudSmokeMetadataRecord): Record<string, unknown> | undefined;
