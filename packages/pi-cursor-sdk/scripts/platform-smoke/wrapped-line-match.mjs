/** Match a regex directly against a line, or against up to 3 lines joined with a space when the
 * terminal wrapped the token across lines and a wrappedPattern was supplied. */
export function matchesWrappedLineAt(lines, index, pattern, wrappedPattern) {
	pattern.lastIndex = 0;
	if (pattern.test(lines[index])) return true;
	if (!wrappedPattern) return false;
	wrappedPattern.lastIndex = 0;
	return wrappedPattern.test(lines.slice(index, index + 3).join(" "));
}
