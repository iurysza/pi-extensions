// Minimal OpenTelemetry-shaped tracer. Off by default: every span is a shared
// no-op until enable(), and a disabled tracer never reads the clock (performance.now()
// was 3–4.5 % of a re-render). Spans keep performance.now() doubles; export converts
// to OTLP/JSON (traceId/spanId hex, Unix-nano strings, typed attribute values).
// Cloudflare Workers caveat: clocks advance only at I/O boundaries there, so
// intra-request durations read as 0 by design; structure and attrs still work.
                                              
import { none, some } from './core/types.js';
import { lookup } from './core/std.js';

                                                  
                                                        
                                                                                                       
                                                                                                  
                            
                                                                                                            
                                                                                
                                                                                        
  

                             
                                                          
                                                   
                                          
              
                                                                                               
                          
 

// IDs: xorshift128 seeded once; two 32-bit words per 64-bit id.
let rs0 = (Math.random() * 0xffffffff) >>> 0 || 1, rs1 = (Math.random() * 0xffffffff) >>> 0 || 2;
const rnd32 = ()         => { let t = rs0; const s = rs1; rs0 = s; t ^= t << 11; t ^= t >>> 8; rs1 = (t ^ s ^ (s >>> 19)) >>> 0; return rs1; };
const hex = (bytes        )         => { let o = ''; for (let i = 0; i < bytes; i += 4) o += rnd32().toString(16).padStart(8, '0'); return o; };
const now = ()         => performance.now();
const message = (e         )         => (e instanceof Error ? e.message : String(e));

const NOOP             = {
  setAttribute: () => NOOP, addEvent: () => NOOP, recordException: () => NOOP, end: () => {}, endAt: () => {},
};

class LiveSpan                       {
           tracer        ;          traceId        ;          spanId        ;          parent                ;
           name        ;          startMs        ;
           attrs                           ;          events              = [];
  status         = { kind: 'unset' };
  constructor(tracer        , traceId        , parent                , name        , attrs       , startMs        ) {
    this.tracer = tracer; this.traceId = traceId; this.spanId = hex(8); this.parent = parent;
    this.name = name; this.startMs = startMs; this.attrs = { ...attrs };
  }
  setAttribute(key        , value           )             { this.attrs[key] = value; return this; }
  addEvent(name        , attrs       )             { this.events.push({ name, timeMs: now(), attrs }); return this; }
  recordException(e         )             {
    this.status = { kind: 'error', message: message(e) };
    return this.addEvent('exception', { 'exception.message': message(e) });
  }
  end()       { this.tracer.finish(this, now()); }
  endAt(ms        )       { this.tracer.finish(this, ms); }
}

export class Tracer {
  enabled = false;
  serviceName = 'mpl';
          finished                 = [];
          stack             = [];
          traceId = hex(16);

  enable()       { this.enabled = true; return this; }
  disable()       { this.enabled = false; return this; }

  /** A new trace (one per top-level run). Inside an open span it joins that span's trace as a
   *  child instead, as OTel libraries do with the active context, so a caller's own span (a
   *  request, a frame) parents the library's work. */
  startTrace(name        , attrs       )             { return this.enabled ? this.startTraceAt(name, attrs, now()) : NOOP; }
  /** startTrace with an explicit start (e.g. an input event's timeStamp, or navigation start = 0). */
  startTraceAt(name        , attrs       , startMs        )             {
    if (!this.enabled) return NOOP;
    if (this.stack.length === 0) this.traceId = hex(16);
    return this.startSpanAt(name, attrs, startMs);
  }
  startSpan(name        , attrs       )             { return this.enabled ? this.startSpanAt(name, attrs, now()) : NOOP; }
  startSpanAt(name        , attrs       , startMs        )             {
    if (!this.enabled) return NOOP;
    const parent = this.stack.length > 0 ? some(this.stack[this.stack.length - 1].spanId) : none;
    const s = new LiveSpan(this, this.traceId, parent, name, attrs, startMs);
    this.stack.push(s);
    return s;
  }
  /** A finished child of the open span, from times measured elsewhere (resource timing, a
   *  timestamp taken before tracing was on). */
  record(name        , attrs       , startMs        , endMs        )       {
    if (!this.enabled) return;
    this.startSpanAt(name, attrs, startMs).endAt(endMs);
  }
  /** Run fn inside a span; exceptions are recorded and rethrown; the span always ends. */
  span   (name        , attrs       , fn                      )    {
    const s = this.startSpan(name, attrs);
    try { return fn(s); } catch (e) { s.recordException(e); throw e; } finally { s.end(); }
  }
  finish(s          , endMs        )       {
    const i = this.stack.lastIndexOf(s);
    if (i >= 0) this.stack.splice(i, 1);
    this.finished.push({ traceId: s.traceId, spanId: s.spanId, parent: s.parent, name: s.name, startMs: s.startMs, endMs,
                         durationMs: endMs - s.startMs, attrs: s.attrs, events: s.events, status: s.status });
  }
  spans()                          { return this.finished.slice(); }
  clear()       { this.finished = []; }
  /** OTLP/JSON ExportTraceServiceRequest. */
  toOTLP()         {
    return { resourceSpans: [{ resource: { attributes: [otlpAttr('service.name', this.serviceName)] },
      scopeSpans: [{ scope: { name: 'mpl' }, spans: this.finished.map(otlpSpan) }] }] };
  }
  /** Append one OTLP Span JSON per line (Node only); returns the count and clears. */
  async flush(path        )                  {
    const spans = this.finished; this.clear();
    if (spans.length === 0) return 0;
    const fs = await import('node:fs/promises');
    await fs.appendFile(path, spans.map((s) => JSON.stringify(otlpSpan(s))).join('\n') + '\n');
    return spans.length;
  }
}

const toUnixNano = (ms        )         => (BigInt(Math.round((performance.timeOrigin + ms) * 1000)) * 1000n).toString();
function otlpAttr(key        , v           )         {
  switch (typeof v) {
    case 'string': return { key, value: { stringValue: v } };
    case 'boolean': return { key, value: { boolValue: v } };
    case 'number': return { key, value: Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v } };
  }
}
const otlpAttrs = (a       )           => Object.entries(a).map(([k, v]) => otlpAttr(k, v));
function otlpSpan(s              )         {
  return {
    traceId: s.traceId, spanId: s.spanId, ...(s.parent.kind === 'some' ? { parentSpanId: s.parent.value } : {}),
    name: s.name, kind: 1, startTimeUnixNano: toUnixNano(s.startMs), endTimeUnixNano: toUnixNano(s.endMs),
    attributes: otlpAttrs(s.attrs),
    events: s.events.map((e) => ({ name: e.name, timeUnixNano: toUnixNano(e.timeMs), attributes: otlpAttrs(e.attrs) })),
    status: s.status.kind === 'error' ? { code: 2, message: s.status.message } : { code: 0 },
  };
}

export const tracer         = new Tracer();

const kv = ([k, v]                              )         => `${k}=${String(v)}`;

/** Spans as an indented tree with durations and attributes, for humans. */
export function renderTree(spans                         , width        )         {
  if (spans.length === 0) return '(no spans)';
  const ids = new Set(spans.map((s) => s.spanId));
  const children = new Map                        ();
  const roots                 = [];
  const kids = (id        )                          => { const v = lookup(children, id); return v.kind === 'some' ? v.value : []; };
  for (const s of spans) {
    if (s.parent.kind === 'some' && ids.has(s.parent.value)) children.set(s.parent.value, [...kids(s.parent.value), s]);
    else roots.push(s);
  }
  const t0 = Math.min(...spans.map((s) => s.startMs));
  const lines = [`trace ${spans[0].traceId}  ${spans.length} spans`];
  const walk = (level                         , depth        )       => {
    for (const s of level.toSorted((a, b) => a.startMs - b.startMs)) {
      const left = `${'  '.repeat(depth)}${s.name}`.padEnd(26) + `${(s.startMs - t0).toFixed(3).padStart(8)} +${s.durationMs.toFixed(3).padStart(7)} ms`;
      const flag = s.status.kind === 'error' ? ` ✗ ${s.status.message}` : '';
      lines.push(`${left}  ${Object.entries(s.attrs).map(kv).join(' ')}${flag}`.slice(0, width));
      for (const e of s.events) lines.push(`${'  '.repeat(depth + 1)}· ${e.name} ${Object.entries(e.attrs).map(kv).join(' ')}`.slice(0, width));
      walk(kids(s.spanId), depth + 1);
    }
  };
  walk(roots, 0);
  return lines.join('\n');
}
