export function buildCloudSmokeEnv(artifactDir: string, options?: {
	contextHandoff?: "fresh" | "bootstrap" | "never";
	repoUrl?: string;
	startingRef?: string;
	directPush?: boolean;
}): NodeJS.ProcessEnv;
export function buildCloudSmokeWorkspace(artifactDir: string): string;
export function cloudAgentIdsFromLifecycleArtifacts(artifactDir: string): string[];

export {
	assertCloudSmokeEvidenceSafe,
	buildCloudSmokeEvidenceProvenance,
	coordinateCloudSmokeReleaseGate,
	listCloudSmokePackageSourcePaths,
	projectCloudSmokeMatrixEvidence,
	validateCloudSmokeMatrixEvidence,
} from "./lib/cloud-smoke-cleanup-evidence.d.mts";

export type {
	CloudSmokeBranchLaneEvidence,
	CloudSmokeCancelLaneEvidence,
	CloudSmokeCleanupEvidence,
	CloudSmokeDirectPushLaneEvidence,
	CloudSmokeEvidenceBranch,
	CloudSmokeEvidenceProvenance,
	CloudSmokeLaneEvidence,
	CloudSmokeLaneName,
	CloudSmokeLifecycleDeleteLaneEvidence,
	CloudSmokeMatrixEvidence,
	CloudSmokeMissingBranchLaneEvidence,
	CloudSmokePassiveArtifactsLaneEvidence,
	CloudSmokeReleaseGateState,
	CloudSmokeThrowawayRepositoryEvidence,
} from "./lib/cloud-smoke-cleanup-evidence.d.mts";

export {
	assertOwnedThrowawayRepositoryHandle,
	cloudSmokeRepositoryDescription,
	normalizeCloudSmokeGitHubRepo,
} from "./lib/cloud-smoke-github.d.mts";

export type { CloudSmokeOwnedRepository } from "./lib/cloud-smoke-github.d.mts";
