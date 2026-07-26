export declare const CURSOR_SDK_STARTUP_NOISE_PATTERNS: readonly string[];
export declare function isCursorSdkOutputSuppressed(): boolean;
export declare function suppressCursorSdkOutput<T>(operation: () => T): T;
export declare function isCursorSdkStartupNoise(text: string): boolean;
export declare function installCursorSdkOutputFilter(): () => void;
