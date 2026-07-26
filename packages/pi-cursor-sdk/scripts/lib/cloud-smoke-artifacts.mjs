import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	CLOUD_AGENT_ID_PATTERN,
	CLOUD_LIFECYCLE_ENTRY_TYPE,
	CLOUD_LIFECYCLE_JOURNAL_PREFIX,
} from "../../shared/cursor-cloud-lifecycle-constants.mjs";

function walkFiles(dir, predicate) {
	const files = [];
	const stack = [dir];
	while (stack.length > 0) {
		const current = stack.pop();
		try {
			for (const entry of readdirSync(current, { withFileTypes: true })) {
				const path = join(current, entry.name);
				if (entry.isDirectory()) stack.push(path);
				else if (predicate(entry.name)) files.push(path);
			}
		} catch {}
	}
	return files.sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs);
}

export function readCloudSmokeMetadata(artifactDir) {
	return walkFiles(artifactDir, (name) => name === "metadata.json").flatMap((metadataPath) => {
		try {
			return [{ metadataPath, metadata: JSON.parse(readFileSync(metadataPath, "utf8")) }];
		} catch {
			return [];
		}
	});
}

export function readLatestCloudSmokeMetadata(artifactDir) {
	return readCloudSmokeMetadata(artifactDir).at(-1);
}

export function cloudAgentIdsFromMetadata(artifactDir) {
	const ids = new Set();
	for (const { metadata } of readCloudSmokeMetadata(artifactDir)) {
		const value = metadata.run?.agentId ?? metadata.providerMeta?.cloudAgentId;
		if (typeof value === "string" && CLOUD_AGENT_ID_PATTERN.test(value)) ids.add(value);
	}
	return [...ids];
}

export function cloudLifecycleRecords(artifactDir) {
	const records = [];
	const files = walkFiles(
		artifactDir,
		(name) => name.endsWith(".jsonl") || (name.startsWith(`${CLOUD_LIFECYCLE_JOURNAL_PREFIX}-`) && name.endsWith(".journal")),
	);
	for (const path of files) {
		const journal = path.split(/[\\/]/).at(-1)?.startsWith(`${CLOUD_LIFECYCLE_JOURNAL_PREFIX}-`) === true;
		let lines;
		try {
			lines = readFileSync(path, "utf8").split(/\r?\n/);
		} catch {
			continue;
		}
		for (const line of lines) {
			if (!line) continue;
			try {
				const entry = JSON.parse(line);
				const data = journal
					? entry
					: entry?.type === "custom" && entry.customType === CLOUD_LIFECYCLE_ENTRY_TYPE
						? entry.data
						: undefined;
				if (data && CLOUD_AGENT_ID_PATTERN.test(data.agentId)) records.push({ path, data });
			} catch {}
		}
	}
	return records;
}

export function cloudAgentIdsFromLifecycleArtifacts(artifactDir) {
	return [...new Set(cloudLifecycleRecords(artifactDir).map(({ data }) => data.agentId))];
}

function readJsonlIfPresent(path) {
	if (!path || !existsSync(path)) return [];
	return readFileSync(path, "utf8").split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

export function readCloudRunReport({ metadataPath, metadata }) {
	const artifactPath = metadata.artifacts?.providerEvents;
	if (!artifactPath) return undefined;
	const providerEventsPath = resolve(artifactPath) === artifactPath
		? artifactPath
		: join(dirname(metadataPath), artifactPath);
	return readJsonlIfPresent(providerEventsPath).find((event) => event.phase === "cloud_run_report")?.payload;
}
