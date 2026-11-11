// Startup prebundle loader. Generated bundles live in <package>/.prebundle/<slug>/ and are
// git-ignored. A bundle is used only when its manifest hash matches the sources on disk.
// Anything else (no bundle, edited source, broken bundle, PI_PREBUNDLE=0) loads the source.
// Keep this file identical in every package that has one; scripts/tests checks that.
// How it works: ai-artifacts/specs/2026-11-10-startup-prebundle.md
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MANIFEST_VERSION = 1;

interface Manifest {
	v: number;
	inputs: string[];
	sha256: string;
	/** Size in bytes of each bundle file. Manifests from older builds have none. */
	outputs?: Record<string, number>;
}

function note(bundleDir: URL, message: string): void {
	if (process.env.PI_PREBUNDLE_DEBUG === "1") process.stderr.write(`[prebundle] ${fileURLToPath(bundleDir)}: ${message}\n`);
}

/** Hash of the listed source files. scripts/build-bundles.mjs computes the same value. */
export function hashInputs(bundleDir: URL, inputs: string[]): string {
	const hash = createHash("sha256");
	for (const input of inputs) {
		hash.update(`${input}\0`);
		hash.update(readFileSync(new URL(input, bundleDir)));
		hash.update("\0");
	}
	return hash.digest("hex");
}

/**
 * File URL of the bundle entry when the bundle matches the sources on disk, else undefined.
 * A URL, not a path: import() rejects a Windows path such as C:\\dir\\index.ts.
 */
export function freshBundle(bundleDir: URL): string | undefined {
	if (process.env.PI_PREBUNDLE === "0") {
		note(bundleDir, "source (PI_PREBUNDLE=0)");
		return undefined;
	}
	try {
		const manifest = JSON.parse(readFileSync(new URL("manifest.json", bundleDir), "utf8")) as Manifest;
		if (manifest.v !== MANIFEST_VERSION || !Array.isArray(manifest.inputs)) {
			note(bundleDir, "source (unknown manifest)");
			return undefined;
		}
		if (hashInputs(bundleDir, manifest.inputs) !== manifest.sha256) {
			note(bundleDir, "source (bundle is stale)");
			return undefined;
		}
		// A missing file throws and lands in the catch below: a lazy chunk that is gone is found now.
		if (manifest.outputs && !Object.entries(manifest.outputs).every(([name, bytes]) => statSync(new URL(name, bundleDir)).size === bytes)) {
			note(bundleDir, "source (bundle files do not match the manifest)");
			return undefined;
		}
		return new URL("index.ts", bundleDir).href;
	} catch {
		note(bundleDir, "source (no bundle)");
		return undefined;
	}
}

/** Imports the bundle in `bundleDir` when it is fresh and loads; otherwise calls `source`. */
export async function loadPrebundled<T>(bundleDir: URL, source: () => Promise<T>): Promise<T> {
	const bundle = freshBundle(bundleDir);
	if (bundle) {
		try {
			const loaded = (await import(bundle)) as T;
			note(bundleDir, "bundle");
			return loaded;
		} catch (error) {
			note(bundleDir, `source (bundle failed to load: ${error instanceof Error ? error.message : String(error)})`);
		}
	}
	return source();
}
