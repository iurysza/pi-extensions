import type { Option } from './core/types.js';
export type AttrValue = string | number | boolean;
export type Attrs = Readonly<Record<string, AttrValue>>;
export type Status = {
    readonly kind: 'unset';
} | {
    readonly kind: 'error';
    readonly message: string;
};
export type SpanEvent = {
    readonly name: string;
    readonly timeMs: number;
    readonly attrs: Attrs;
};
export type FinishedSpan = {
    readonly traceId: string;
    readonly spanId: string;
    readonly parent: Option<string>;
    readonly name: string;
    readonly startMs: number;
    readonly endMs: number;
    readonly durationMs: number;
    readonly attrs: Attrs;
    readonly events: readonly SpanEvent[];
    readonly status: Status;
};
export interface SpanHandle {
    setAttribute(key: string, value: AttrValue): SpanHandle;
    addEvent(name: string, attrs: Attrs): SpanHandle;
    recordException(e: unknown): SpanHandle;
    end(): void;
    /** End at an explicit performance.now() time (work measured outside the span's own call). */
    endAt(ms: number): void;
}
declare class LiveSpan implements SpanHandle {
    readonly tracer: Tracer;
    readonly traceId: string;
    readonly spanId: string;
    readonly parent: Option<string>;
    readonly name: string;
    readonly startMs: number;
    readonly attrs: Record<string, AttrValue>;
    readonly events: SpanEvent[];
    status: Status;
    constructor(tracer: Tracer, traceId: string, parent: Option<string>, name: string, attrs: Attrs, startMs: number);
    setAttribute(key: string, value: AttrValue): SpanHandle;
    addEvent(name: string, attrs: Attrs): SpanHandle;
    recordException(e: unknown): SpanHandle;
    end(): void;
    endAt(ms: number): void;
}
export declare class Tracer {
    enabled: boolean;
    serviceName: string;
    private finished;
    private stack;
    private traceId;
    enable(): this;
    disable(): this;
    /** A new trace (one per top-level run). Inside an open span it joins that span's trace as a
     *  child instead, as OTel libraries do with the active context, so a caller's own span (a
     *  request, a frame) parents the library's work. */
    startTrace(name: string, attrs: Attrs): SpanHandle;
    /** startTrace with an explicit start (e.g. an input event's timeStamp, or navigation start = 0). */
    startTraceAt(name: string, attrs: Attrs, startMs: number): SpanHandle;
    startSpan(name: string, attrs: Attrs): SpanHandle;
    startSpanAt(name: string, attrs: Attrs, startMs: number): SpanHandle;
    /** A finished child of the open span, from times measured elsewhere (resource timing, a
     *  timestamp taken before tracing was on). */
    record(name: string, attrs: Attrs, startMs: number, endMs: number): void;
    /** Run fn inside a span; exceptions are recorded and rethrown; the span always ends. */
    span<T>(name: string, attrs: Attrs, fn: (s: SpanHandle) => T): T;
    finish(s: LiveSpan, endMs: number): void;
    spans(): readonly FinishedSpan[];
    clear(): void;
    /** OTLP/JSON ExportTraceServiceRequest. */
    toOTLP(): object;
    /** Append one OTLP Span JSON per line (Node only); returns the count and clears. */
    flush(path: string): Promise<number>;
}
export declare const tracer: Tracer;
/** Spans as an indented tree with durations and attributes, for humans. */
export declare function renderTree(spans: readonly FinishedSpan[], width: number): string;
export {};
