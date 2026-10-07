import type { ModelListItem } from "@cursor/sdk";

export interface CursorModelSelectionIdentity {
	model: ModelListItem;
	selectionModelId: string;
	context?: string;
	fastOverride?: boolean;
	piModelId: string;
	contextWindowKey: string;
	baseContextWindowKey: string;
}

export declare function getCursorModelSelectionIdentities(
	models: readonly ModelListItem[],
): CursorModelSelectionIdentity[];

export declare function normalizeCursorContextWindowEntries(
	models: readonly ModelListItem[],
	entries: ReadonlyMap<string, number>,
	source?: string,
): Map<string, number>;
