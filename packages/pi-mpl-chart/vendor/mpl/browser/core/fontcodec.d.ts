import type { FaceData, SubTable } from './fonts.js';
import { type Option } from './types.js';
/** The faces mpl ships. Families and weights are matplotlib's names for them. */
export declare const FACE_CATALOG: readonly [{
    readonly id: 'DejaVu Sans:400';
    readonly family: 'DejaVu Sans';
    readonly weight: 400;
    readonly module: 'dejavu-sans';
    readonly binding: 'dejavuSans';
}, {
    readonly id: 'DejaVu Sans:700';
    readonly family: 'DejaVu Sans';
    readonly weight: 700;
    readonly module: 'dejavu-sans-bold';
    readonly binding: 'dejavuSansBold';
}, {
    readonly id: 'DejaVu Serif:400';
    readonly family: 'DejaVu Serif';
    readonly weight: 400;
    readonly module: 'dejavu-serif';
    readonly binding: 'dejavuSerif';
}, {
    readonly id: 'DejaVu Serif:700';
    readonly family: 'DejaVu Serif';
    readonly weight: 700;
    readonly module: 'dejavu-serif-bold';
    readonly binding: 'dejavuSerifBold';
}, {
    readonly id: 'Inter:400';
    readonly family: 'Inter';
    readonly weight: 400;
    readonly module: 'inter-regular';
    readonly binding: 'interRegular';
}, {
    readonly id: 'Inter:500';
    readonly family: 'Inter';
    readonly weight: 500;
    readonly module: 'inter-medium';
    readonly binding: 'interMedium';
}, {
    readonly id: 'Inter:600';
    readonly family: 'Inter';
    readonly weight: 600;
    readonly module: 'inter-semibold';
    readonly binding: 'interSemibold';
}, {
    readonly id: 'Inter:700';
    readonly family: 'Inter';
    readonly weight: 700;
    readonly module: 'inter-bold';
    readonly binding: 'interBold';
}];
export type CatalogEntry = (typeof FACE_CATALOG)[number];
/** "Family:weight" of a shipped face. */
export type FaceId = CatalogEntry['id'];
/** One face as its module (mpl/fonts/<name>) exports it: metadata plus encoded tables. */
export type BakedFace = {
    readonly id: FaceId;
    readonly upm: number;
    readonly typo: readonly [number, number, number];
    readonly cmap: string;
    readonly cover: string;
    readonly glyphs: string;
    readonly outlines: string;
    readonly offsets: string;
    readonly kern: string;
    readonly gsub: {
        readonly order: readonly number[];
        readonly lookups: Readonly<Record<string, {
            readonly flag: number;
            readonly subs: readonly SubTable[];
        }>>;
        readonly gclass: Readonly<Record<string, number>>;
    };
};
export declare const VLQ_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** base64 VLQ → integers. */
export declare function decodeVlq(s: string): Int32Array;
/** The baked FaceData of an encoded face, exactly as it was baked. */
export declare function decodeFace(b: BakedFace, entry: CatalogEntry): FaceData;
/** gid → contours: outline points (flat [x, y, tag]) or a composite's component offsets. */
export type Contours = readonly (readonly number[])[];
/**
 * The outlines or offsets table of a face, decoded per glyph on first use. A chart draws a few dozen
 * of a face's ~1200 glyphs, so building every glyph's arrays up front (decodeFace) is most of a face's
 * load time, paid by every cold isolate. The first lookup decodes the table's integers and records
 * where each gid starts; a glyph's arrays are built, exactly as decodeFace builds them, when first asked.
 */
export declare class GlyphContours {
    private readonly src;
    private readonly points;
    private ints;
    private readonly start;
    private indexed;
    private readonly memo;
    /** points: an outlines table (per point 3·Δx + tag, Δy); else an offsets table (per contour, length then values). */
    constructor(src: string, points: boolean);
    private index;
    /** The gids the table has, ascending. */
    gids(): readonly number[];
    get(gid: number): Option<Contours>;
}
/** A face's lookup tables straight from its encoded form: the Maps getFace needs, without decodeFace's records. */
export type FaceTables = {
    readonly cmap: ReadonlyMap<string, number>;
    readonly cover: readonly (readonly [number, number])[];
    readonly glyphs: ReadonlyMap<number, readonly [number, number, number, number, number]>;
    readonly kern: ReadonlyMap<number, number>;
    readonly outlines: GlyphContours;
    readonly offsets: GlyphContours;
};
export declare function decodeTables(b: BakedFace): FaceTables;
