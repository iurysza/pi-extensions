import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const MAX_TARBALL_BYTES = 2 * 1024 * 1024;
const root = process.cwd();
const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
	cwd: root,
	encoding: "utf8",
});
const [pack] = JSON.parse(output);
const errors = [];

if (!pack) {
	throw new Error("npm pack returned no package report");
}

if (pack.size > MAX_TARBALL_BYTES) {
	errors.push(`tarball is ${pack.size} bytes; limit is ${MAX_TARBALL_BYTES} bytes`);
}

const allowedFiles = new Set([
	"package.json",
	"package-lock.json",
	"README.md",
	"LICENSE",
	"THIRD_PARTY_NOTICES.md",
]);
const allowedDirectories = ["extensions/", "skills/", "themes/", "prompts/", ".pi/taskflows/"];
const personalPathPatterns = [
	/\/Users\/[^/\s"'`]+/g,
	/\/home\/[^/\s"'`]+/g,
	/[A-Za-z]:\\Users\\[^\\\s"'`]+/g,
];

for (const entry of pack.files) {
	const path = entry.path.replaceAll("\\", "/");
	const allowed = allowedFiles.has(path) || allowedDirectories.some((directory) => path.startsWith(directory));
	if (!allowed) errors.push(`unexpected package file: ${path}`);

	if (/(^|\/)[^/]*\.test\.[^/]+$/i.test(path)) {
		errors.push(`test file included: ${path}`);
	}
	if (
		path !== "package-lock.json" &&
		/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|bun\.lockb?|pnpm-lock\.yaml|yarn\.lock)$/i.test(path)
	) {
		errors.push(`nested or alternate lockfile included: ${path}`);
	}
	if (path === ".github" || path.startsWith(".github/")) {
		errors.push(`GitHub metadata included: ${path}`);
	}
	if (/(^|\/)(AINE-PLAN\.md|PLAN\.md|docs\/plans(?:\/|$)|plans(?:\/|$)|openspec(?:\/|$))/i.test(path)) {
		errors.push(`internal plan included: ${path}`);
	}

	const content = readFileSync(resolve(root, path), "utf8");
	for (const pattern of personalPathPatterns) {
		const matches = content.match(pattern) ?? [];
		for (const match of matches) errors.push(`absolute personal path in ${path}: ${match}`);
	}
}

if (errors.length > 0) {
	console.error(errors.map((error) => `- ${error}`).join("\n"));
	process.exit(1);
}

console.log(`pack check passed: ${pack.files.length} files, ${pack.size} bytes`);
