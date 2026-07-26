export interface CursorCliValueFlagSpec<TValue = string> {
	[key: string]: unknown;
	names: readonly string[];
	takesValue?: true;
	repeat?: boolean;
	allowDashValue?: boolean;
	assign?: (value: string, flagName: string) => TValue;
}

export interface CursorCliBooleanFlagSpec<TValue = boolean> {
	[key: string]: unknown;
	names: readonly string[];
	takesValue: false;
	repeat?: boolean;
	assign?: (value: true, flagName: string) => TValue;
}

export type CursorCliFlagSpec<TValue = string> = CursorCliValueFlagSpec<TValue> | CursorCliBooleanFlagSpec<TValue>;

export type CursorCliFlagSpecMap<TArgs extends Record<string, unknown>> = {
	[K in keyof TArgs]?: CursorCliFlagSpec<unknown>;
};

export type ParsedCursorCliArgs<TDefaults extends Record<string, unknown>> = TDefaults & { help: boolean };

export declare function readArgvValue(
	argv: readonly string[],
	index: number,
	flagName: string,
	fail: (message: string) => never,
	options?: { allowDashValue?: boolean },
): string;
export declare function parseArgv<TDefaults extends Record<string, unknown>>(
	argv: readonly string[],
	options: { defaults: TDefaults; flags: CursorCliFlagSpecMap<TDefaults>; fail: (message: string) => never },
): ParsedCursorCliArgs<TDefaults>;
export declare function defaultSettingSourcesFromEnv(env?: NodeJS.ProcessEnv): string[] | undefined;
export declare function defaultApiKeyFromEnv(env?: NodeJS.ProcessEnv): string | undefined;
export declare function readArgvApiKey(argv: readonly string[]): string | undefined;
export declare function apiKeySecretsFromProcess(
	argv?: readonly string[],
	env?: NodeJS.ProcessEnv,
): Array<string | undefined>;
export declare function requireApiKey(
	args: { apiKey?: string },
	env: NodeJS.ProcessEnv,
	fail: (message: string) => never,
): string;
export declare function defaultTimestampedDir(prefix: string, baseDir?: string): string;
export declare const commonProbePathFlag: <TKey extends string>(key: TKey) => CursorCliValueFlagSpec<string>;
export declare const commonProbeStringFlag: <TKey extends string>(key: TKey) => CursorCliValueFlagSpec<string>;
export declare const commonBooleanFlag: (...names: string[]) => CursorCliBooleanFlagSpec<boolean>;
export declare const commonRepeatStringFlag: (...names: string[]) => CursorCliValueFlagSpec<string>;
export declare const commonProbeFlags: {
	readonly cwd: CursorCliValueFlagSpec<string>;
	readonly model: CursorCliValueFlagSpec<string>;
	readonly prompt: CursorCliValueFlagSpec<string>;
	readonly out: CursorCliValueFlagSpec<string>;
	readonly sessionDir: CursorCliValueFlagSpec<string>;
	readonly promptFile: CursorCliValueFlagSpec<string>;
	readonly apiKey: CursorCliValueFlagSpec<string>;
	readonly settingSources: CursorCliValueFlagSpec<string[] | undefined>;
};
