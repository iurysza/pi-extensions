export declare const CURSOR_SETTING_SOURCES_ENV: "PI_CURSOR_SETTING_SOURCES";
export declare const DEFAULT_CURSOR_SETTING_SOURCES: readonly string[];

export declare function resolveCursorSettingSources(raw?: string): string[] | undefined;

export declare function serializeCursorSettingSources(settingSources: string[] | undefined): string;
