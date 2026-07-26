// Adapted from @sting8k/pi-vcc 0.3.5 under MIT; see THIRD_PARTY_NOTICES.md.
const SENSITIVE_RE =
	/(?:sshpass\s+-p\s*'[^']*'|sshpass\s+-p\s*"[^"]*"|sshpass\s+-p\s*\S+|password[=:]\s*\S+|api[_-]?key[=:]\s*\S+|secret[=:]\s*\S+|token[=:]\s*[A-Za-z0-9_\-.]{8,}|-i\s+\S+\.pem\b)/gi;

export function redact(text: string): string {
	return text.replace(SENSITIVE_RE, (match) => {
		const prefix = match.split(/[=:\s]+/)[0];
		return `${prefix} [REDACTED]`;
	});
}
