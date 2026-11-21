import type { XY } from './path.js';
export type Box = {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
};
export type ObstacleIndex = {
    readonly badness: (box: Box, limit: number) => number;
    readonly cells: number;
    readonly segCells: number;
};
export declare const overlaps: (a: Box, b: Box) => boolean;
export declare function buildObstacleIndex(counted: readonly XY[], points: readonly XY[], bboxes: readonly Box[], W: number, H: number, cell: number, paths?: readonly XY[]): ObstacleIndex;
