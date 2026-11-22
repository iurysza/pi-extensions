export type IOList = string | readonly IOList[];
export declare function iolistChunks(io: IOList): Generator<string>;
export declare function iolistSize(io: IOList): number;
export declare function iolistToString(io: IOList): string;
/** Web ReadableStream<Uint8Array>; each leaf string becomes one chunk. */
export declare function iolistToStream(io: IOList): ReadableStream<Uint8Array>;
