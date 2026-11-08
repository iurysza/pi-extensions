/** Shared launch boundary. Targets retain their backend and ownership receipt. */
import { createHerdrUi, type LaunchRequest, type OwnedTarget } from "@iurysza/herdr-ui";

export type SplitTarget = OwnedTarget;
export type MultiplexerType = "app" | "legacy" | "tmux" | "cmux";

export function detectMultiplexer(): MultiplexerType | null {
	const result = createHerdrUi().resolveCaller();
	return result.ok && result.value.backend !== "none" ? result.value.backend : null;
}

export function launchMultiplexer(request: LaunchRequest) {
	return createHerdrUi().launch(request);
}

export function closeTarget(target: SplitTarget) {
	return createHerdrUi().close(target);
}

export function getMultiplexerName(): string {
	return detectMultiplexer() ?? "none";
}
