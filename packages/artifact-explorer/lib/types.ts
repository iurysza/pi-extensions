export interface ArtifactExplorerConfig {
	sourceProfilePath: string;
	obsidianBinary: string;
	artifactWorkspaceName: string;
	hubWorkspaceName: string;
}

export interface ProjectRecord {
	id: string;
	name: string;
	repoPath: string;
	artifactPath: string;
	vaultId?: string;
	lastOpened: string;
	registeredAt: string;
}

export interface ProjectRegistry {
	version: 1;
	projects: Record<string, ProjectRecord>;
}

export interface ProjectContext {
	repoPath: string;
	artifactPath: string;
	projectId: string;
	projectName: string;
	isParentVault: boolean;
	parentVaultPath?: string;
	artifactInitialized: boolean;
}

export interface StatusReport {
	gitRoot: string | null;
	artifactPath: string | null;
	projectId: string | null;
	artifactInitialized: boolean;
	registered: boolean;
	isParentVault: boolean;
	obsidianCliAvailable: boolean;
	obsidianVersion: string | null;
	vaultId: string | null;
}

export type ParsedCommand =
	| { kind: "open" }
	| { kind: "hub" }
	| { kind: "status" }
	| { kind: "help" }
	| { kind: "unknown"; args: string };
