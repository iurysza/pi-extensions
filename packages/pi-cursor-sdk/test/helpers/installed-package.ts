import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** Walk from require.resolve(packageName) to the installed package root. */
export function resolveInstalledPackageRoot(packageName: string): string {
	let directory = dirname(require.resolve(packageName));
	for (let depth = 0; depth < 6; depth += 1) {
		const packageJsonPath = join(directory, "package.json");
		try {
			const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: string };
			if (packageJson.name === packageName) return directory;
		} catch {
			// keep walking toward the package root
		}
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	throw new Error(`could not resolve installed package root for ${packageName}`);
}

/** Locate one installed SDK chunk by semantic markers, not webpack chunk numbers. */
export function readCursorSdkEsmBundleContaining(...markers: string[]): string {
	const directory = join(resolveInstalledPackageRoot("@cursor/sdk"), "dist/esm");
	const hits = readdirSync(directory).flatMap((name) => {
		if (!name.endsWith(".js")) return [];
		const source = readFileSync(join(directory, name), "utf8");
		return markers.every((marker) => source.includes(marker)) ? [{ name, source }] : [];
	});
	if (hits.length !== 1) {
		throw new Error(`Expected one Cursor SDK chunk containing ${JSON.stringify(markers)}; found ${hits.length}: ${hits.map((hit) => hit.name).join(", ")}`);
	}
	return hits[0]!.source;
}

/** Keep usage assertions inside the SDK's usage module, not unrelated totals. */
export function readCursorSdkUsageModule(): string {
	const source = readCursorSdkEsmBundleContaining('"./src/agent/usage-types.ts"(t,r,e){');
	const start = source.indexOf('"./src/agent/usage-types.ts"(t,r,e){');
	const end = source.indexOf('},"./src/agent/utils/logger.ts"', start);
	if (end < start) throw new Error("Cursor SDK usage module boundary changed");
	return source.slice(start, end);
}

export function readInstalledPackageVersion(packageName: string): string {
	const packageJson = JSON.parse(readFileSync(join(resolveInstalledPackageRoot(packageName), "package.json"), "utf8")) as {
		version?: string;
	};
	if (typeof packageJson.version !== "string") {
		throw new Error(`could not resolve installed version for ${packageName}`);
	}
	return packageJson.version;
}
