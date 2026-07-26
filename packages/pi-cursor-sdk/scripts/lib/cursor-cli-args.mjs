import { resolve } from "node:path";
import { CURSOR_SETTING_SOURCES_ENV, resolveCursorSettingSources } from "../../shared/cursor-setting-sources.mjs";

export function readArgvValue(argv, index, flagName, fail, options = {}) {
	const current = argv[index];
	if (!current || (!options.allowDashValue && current.startsWith("--"))) {
		fail(`${flagName} requires a value`);
	}
	return current;
}

function assignParsedArg(args, key, spec, raw, flagName) {
	const value = spec.assign ? spec.assign(raw, flagName) : raw;
	if (spec.repeat) {
		args[key] = [...(Array.isArray(args[key]) ? args[key] : []), value];
		return;
	}
	args[key] = value;
}

export function parseArgv(argv, { defaults, flags, fail }) {
	const args = { ...defaults, help: false };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "-h" || arg === "--help") {
			args.help = true;
			continue;
		}

		let matched = false;
		for (const [key, spec] of Object.entries(flags)) {
			for (const flagName of spec.names) {
				if (arg === flagName) {
					if (spec.takesValue === false) {
						assignParsedArg(args, key, spec, true, flagName);
					} else {
						const raw = readArgvValue(argv, ++index, flagName, fail, { allowDashValue: spec.allowDashValue === true });
						assignParsedArg(args, key, spec, raw, flagName);
					}
					matched = true;
					break;
				}
				if (arg.startsWith(`${flagName}=`)) {
					if (spec.takesValue === false) fail(`${flagName} does not accept a value`);
					const raw = arg.slice(flagName.length + 1);
					assignParsedArg(args, key, spec, raw, flagName);
					matched = true;
					break;
				}
			}
			if (matched) break;
		}
		if (!matched) fail(`unknown argument: ${arg}`);
	}
	return args;
}

export function defaultSettingSourcesFromEnv(env = process.env) {
	return resolveCursorSettingSources(env[CURSOR_SETTING_SOURCES_ENV]);
}

export function defaultApiKeyFromEnv(env = process.env) {
	return env.CURSOR_API_KEY?.trim() || undefined;
}

export function readArgvApiKey(argv) {
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--api-key") {
			const value = argv[index + 1];
			return typeof value === "string" ? value.trim() : undefined;
		}
		if (arg.startsWith("--api-key=")) return arg.slice("--api-key=".length).trim();
	}
	return undefined;
}

export function apiKeySecretsFromProcess(argv = process.argv.slice(2), env = process.env) {
	return [defaultApiKeyFromEnv(env), readArgvApiKey(argv)];
}

export function requireApiKey(args, env, fail) {
	const apiKey = args.apiKey ?? defaultApiKeyFromEnv(env);
	if (!apiKey) {
		fail("Cursor API key is required. Set CURSOR_API_KEY or pass --api-key.");
	}
	return apiKey;
}

export function defaultTimestampedDir(prefix, baseDir = "/tmp") {
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	return resolve(baseDir, `${prefix}-${stamp}`);
}

export const commonProbePathFlag = (key) => ({
	names: [`--${key}`],
	assign: (value) => resolve(value),
});

export const commonProbeStringFlag = (key) => ({
	names: [`--${key}`],
});

export const commonBooleanFlag = (...names) => ({
	names,
	takesValue: false,
});

export const commonRepeatStringFlag = (...names) => ({
	names,
	repeat: true,
});

export const commonProbeFlags = {
	cwd: commonProbePathFlag("cwd"),
	model: commonProbeStringFlag("model"),
	prompt: commonProbeStringFlag("prompt"),
	out: commonProbePathFlag("out"),
	sessionDir: { names: ["--session-dir"], assign: (value) => resolve(value) },
	promptFile: { names: ["--prompt-file"], assign: (value) => resolve(value) },
	apiKey: {
		names: ["--api-key"],
		assign: (value) => value.trim(),
	},
	settingSources: {
		names: ["--setting-sources"],
		assign: (value) => resolveCursorSettingSources(value),
	},
};
