// IOList: Elixir-iodata-shaped output. Renderers compose nested fragments
// without copying; flattening happens once at the boundary, or never (streaming).
                                                

export function* iolistChunks(io        )                    {
  if (typeof io === 'string') { if (io.length > 0) yield io; return; }
  for (const part of io) yield* iolistChunks(part);
}
export function iolistSize(io        )         {
  if (typeof io === 'string') return io.length;
  let n = 0;
  for (const part of io) n += iolistSize(part);
  return n;
}
export function iolistToString(io        )         {
  let out = '';
  for (const c of iolistChunks(io)) out += c;   // V8 ropes: linear
  return out;
}
/** Web ReadableStream<Uint8Array>; each leaf string becomes one chunk. */
export function iolistToStream(io        )                             {
  const it = iolistChunks(io), enc = new TextEncoder();
  return new ReadableStream            ({
    pull(c)       { const r = it.next(); if (r.done === true) c.close(); else c.enqueue(enc.encode(r.value)); },
  });
}
