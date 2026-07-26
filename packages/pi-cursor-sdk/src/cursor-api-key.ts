export const CURSOR_API_KEY_ENV_VAR = "CURSOR_API_KEY";
const CURSOR_PROVIDER_ID = "cursor";

// Non-secret literal sentinel for pi's provider registry. Pi 0.77 treats `$ENV_VAR`
// values as unconfigured when the env var is absent, which hides fallback models
// before `/login`. Keep the provider available and resolve the real key in the
// Cursor provider turn path from pi auth or CURSOR_API_KEY.
export const CURSOR_API_KEY_CONFIG_VALUE = "pi-cursor-sdk-cursor-api-key-placeholder";

const CURSOR_API_KEY_PLACEHOLDERS = new Set([
	CURSOR_API_KEY_ENV_VAR,
	`$${CURSOR_API_KEY_ENV_VAR}`,
	`\${${CURSOR_API_KEY_ENV_VAR}}`,
	CURSOR_API_KEY_CONFIG_VALUE,
]);

export function resolveCursorApiKey(apiKey?: string): string | undefined {
	const trimmed = apiKey?.trim();
	if (!trimmed) return undefined;
	if (CURSOR_API_KEY_PLACEHOLDERS.has(trimmed)) return process.env.CURSOR_API_KEY?.trim() || undefined;
	return trimmed;
}

async function getStoredCursorApiKey(): Promise<string | undefined> {
	try {
		const { readStoredCredential } = await import("@earendil-works/pi-coding-agent");
		const credential = readStoredCredential(CURSOR_PROVIDER_ID);
		return resolveCursorApiKey(credential?.type === "api_key" ? credential.key : undefined);
	} catch {
		return undefined;
	}
}

export async function resolveCursorRuntimeApiKey(): Promise<string | undefined> {
	return (await getStoredCursorApiKey()) ?? resolveCursorApiKey(process.env.CURSOR_API_KEY);
}
