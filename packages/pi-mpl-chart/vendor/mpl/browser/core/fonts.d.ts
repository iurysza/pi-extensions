import { type BakedFace, type CatalogEntry, type FaceId, type GlyphContours } from './fontcodec.js';
type Recs = readonly (readonly [number, number])[];
export type SubTable = {
    readonly t: 1;
    readonly map: readonly (readonly [number, number])[];
} | {
    readonly t: 4;
    readonly ligs: readonly (readonly number[])[];
} | {
    readonly t: 5;
    readonly f: 3;
    readonly inp: readonly (readonly number[])[];
    readonly recs: Recs;
} | {
    readonly t: 6;
    readonly f: 1;
    readonly rules: readonly {
        readonly g: number;
        readonly bt: readonly number[];
        readonly inp: readonly number[];
        readonly la: readonly number[];
        readonly recs: Recs;
    }[];
} | {
    readonly t: 6;
    readonly f: 2;
    readonly cov: readonly number[];
    readonly bcd: Readonly<Record<string, number>>;
    readonly icd: Readonly<Record<string, number>>;
    readonly lcd: Readonly<Record<string, number>>;
    readonly rules: readonly {
        readonly c: number;
        readonly bt: readonly number[];
        readonly inp: readonly number[];
        readonly la: readonly number[];
        readonly recs: Recs;
    }[];
} | {
    readonly t: 6;
    readonly f: 3;
    readonly bt: readonly (readonly number[])[];
    readonly inp: readonly (readonly number[])[];
    readonly la: readonly (readonly number[])[];
    readonly recs: Recs;
};
export type FaceData = {
    readonly family: string;
    readonly weight: number;
    readonly upm: number;
    /** OS/2 sTypoAscender, −sTypoDescender, sTypoLineGap (else hhea), font units */
    readonly typo: readonly [number, number, number];
    readonly cmap: Readonly<Record<string, number>>;
    /** every code point the font file maps, as [first, last] runs (cmap holds only the baked ones) */
    readonly cover: readonly (readonly [number, number])[];
    /** gid → [advance, xMin, xMax, yMin, yMax], font units, control-point box */
    readonly glyphs: Readonly<Record<string, readonly [number, number, number, number, number]>>;
    /** gid → contours, flat [x, y, tag] with FreeType tags (1 on, 0 conic, 2 cubic) */
    readonly outlines: Readonly<Record<string, readonly (readonly number[])[]>>;
    /** composite gid → per contour, its component offsets [dx, dy, ...] (font units), each scaled on its own */
    readonly offsets: Readonly<Record<string, readonly (readonly number[])[]>>;
    readonly kern: Readonly<Record<string, number>>;
    readonly gsub: {
        readonly order: readonly number[];
        readonly lookups: Readonly<Record<string, {
            readonly flag: number;
            readonly subs: readonly SubTable[];
        }>>;
        readonly gclass: Readonly<Record<string, number>>;
    };
};
type GSet = ReadonlySet<number>;
type CRule = {
    readonly bt: readonly number[];
    readonly inp: readonly number[];
    readonly la: readonly number[];
    readonly recs: Recs;
};
type CSub = {
    readonly t: 1;
    readonly map: ReadonlyMap<number, number>;
} | {
    readonly t: 4;
    readonly ligs: ReadonlyMap<number, readonly (readonly number[])[]>;
} | {
    readonly t: 5;
    readonly inp: readonly GSet[];
    readonly recs: Recs;
} | {
    readonly t: 61;
    readonly rules: ReadonlyMap<number, readonly CRule[]>;
} | {
    readonly t: 62;
    readonly cov: GSet;
    readonly bcd: ReadonlyMap<number, number>;
    readonly icd: ReadonlyMap<number, number>;
    readonly lcd: ReadonlyMap<number, number>;
    readonly rules: ReadonlyMap<number, readonly CRule[]>;
} | {
    readonly t: 63;
    readonly bt: readonly GSet[];
    readonly inp: readonly GSet[];
    readonly la: readonly GSet[];
    readonly recs: Recs;
};
type Lookup = {
    readonly flag: number;
    readonly subs: readonly CSub[];
    readonly first: GSet;
};
/** A loaded face: baked data plus lookup structures. `id` is "Family:weight". */
export type Face = {
    readonly id: string;
    readonly family: string;
    readonly weight: number;
    readonly upm: number;
    readonly cmap: ReadonlyMap<string, number>;
    readonly glyphs: ReadonlyMap<number, readonly [number, number, number, number, number]>;
    /** gid → contours (FaceData.outlines), each glyph decoded on first use */
    readonly outlines: GlyphContours;
    /** composite gid → per-contour component offsets (FaceData.offsets), decoded on first use */
    readonly offsets: GlyphContours;
    readonly kern: ReadonlyMap<number, number>;
    readonly lookups: ReadonlyMap<number, Lookup>;
    /** GDEF glyph class (1 base, 2 ligature, 3 mark) */
    readonly gclass: ReadonlyMap<number, number>;
    readonly data: Pick<FaceData, 'cover' | 'typo' | 'gsub'>;
    /** Text._get_layout's minimum ascent and descent, font units */
    readonly minAscent: number;
    readonly minDescent: number;
    /** font fallback: the faces of the later font.family entries, tried in order for a character this face lacks */
    readonly fallback: readonly Face[];
};
/** Rendering needed a shipped face that has not been passed to registerFonts(). */
export declare class FontNotLoadedError extends Error {
    readonly face: FaceId;
    readonly family: string;
    readonly weight: number;
    /** the module that exports it, e.g. "mpl/fonts/dejavu-sans-bold" */
    readonly module: string;
    /** its export name in that module, e.g. "dejavuSansBold" */
    readonly binding: string;
    constructor(e: CatalogEntry);
}
/** When each face was decoded (performance.now() ms), in order; the live demo turns these into spans. */
export type FaceLoad = {
    readonly id: string;
    readonly startMs: number;
    readonly endMs: number;
    readonly glyphs: number;
};
export declare const FACE_LOADS: readonly FaceLoad[];
/** Make faces available to rendering. Registering a face twice is harmless. */
export declare function registerFonts(...faces: readonly BakedFace[]): void;
/** The ids of the registered faces, in catalog order. */
export declare const registeredFonts: () => readonly FaceId[];
/** A shipped face, decoded on first use; FontNotLoadedError if it is not registered. */
export declare function getFace(e: CatalogEntry): Face;
/** matplotlib's weights: a number, or a named weight (unknown names read as normal). */
export declare const parseWeight: (v: unknown) => number;
/**
 * font_manager._find_fonts_by_props + get_font: each font.family entry resolves to one font, the first is the face and
 * the rest its fallback chain (FT2Font _fallback_list), duplicates dropped; none found → DejaVu Sans
 * (fallback_to_default). matplotlib ends the chain with LastResort, which mpl does not ship: a character no face has
 * draws the first face's .notdef. Throws FontNotLoadedError if a face it picks is not registered.
 */
export declare function resolveFace(families: readonly (readonly string[])[], weight: number): Face;
/** The face a laid-out text node names (its Face.id). */
export declare function faceById(id: string): Face;
export declare function mulFix(a: number, b: number): number;
export declare function divFix(a: number, b: number): number;
export declare const mulDiv: (a: number, b: number, c: number) => number;
/** FT_Set_Char_Size(face, (FT_F26Dot6)(pt·64), 0, dpi, dpi) → 16.16 scale. */
export declare function ftScale(face: Face, sizePt: number, dpi: number): number;
/** Why a character has no baked glyph: the font lacks it (matplotlib warns and draws .notdef), or
 *  matplotlib would draw a real glyph that mpl does not bundle (we draw .notdef, so say so). */
export type MissingGlyph = {
    readonly kind: 'not-in-font';
    readonly cp: number;
    readonly family: string;
} | {
    readonly kind: 'not-bundled';
    readonly cp: number;
    readonly family: string;
};
export declare const missingGlyphMessage: (m: MissingGlyph) => string;
export declare function setGlyphWarningSink(sink: (msg: string) => void): void;
/** Characters → glyph ids, with the default GSUB features applied in lookup order. */
export declare function shapeGlyphs(face: Face, text: string): number[];
/** Pen positions in 26.6 for shaped glyphs; n+1 entries, the last is the total advance. */
export declare function penPositions(face: Face, gids: readonly number[], scale: number): Int32Array;
/** `table[key] * scale` with scale = 1 / upem * size * dpi / 72, as _get_layout computes it. */
export declare function minMetrics(face: Face, sizePt: number, dpi: number): {
    readonly ascent: number;
    readonly descent: number;
};
/** Ink extent of shaped glyphs (union of scaled outline cboxes, 26.6 → px): what FT2Font.set_text measures. */
export declare function inkExtent(face: Face, gids: readonly number[], scale: number): {
    readonly yMax: number;
    readonly yMin: number;
};
/** Mathtext glyph metrics (by character): linearHoriAdvance and the scaled outline's cbox, in px. */
export declare function mathMetrics(face: Face, ch: string, sizePt: number, dpi: number): {
    readonly advance: number;
    readonly iceberg: number;
    readonly depth: number;
};
export declare const glyphOf: (face: Face, ch: string) => number;
export {};
