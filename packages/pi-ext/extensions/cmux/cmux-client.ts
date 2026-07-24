/**
 * cmux socket client — persistent connection to the cmux Unix domain socket.
 * Speaks v2 newline-delimited JSON protocol.
 *
 * Gracefully degrades: if CMUX_SOCKET_PATH is unset or the socket is
 * unreachable, every method returns null. No errors, no noise.
 */

import * as net from "node:net";
import * as crypto from "node:crypto";

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingV1 {
  resolve: (value: string | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CmuxClient {
  private socket: net.Socket | null = null;
  private pending = new Map<string, PendingRequest>();
  private pendingV1: PendingV1[] = [];
  private buffer = "";
  private socketPath: string | undefined;
  private connecting = false;
  private verbose: boolean;

  constructor() {
    this.socketPath = process.env.CMUX_SOCKET_PATH;
    this.verbose = process.env.PI_CMUX_VERBOSE === "1";
  }

  /** True if CMUX_SOCKET_PATH is set (cmux might be available). */
  get available(): boolean {
    return !!this.socketPath && process.env.PI_CMUX_DISABLE !== "1";
  }

  /** True if we have an active socket connection. */
  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed;
  }

  /** Connect to the cmux socket. Returns true on success. */
  async connect(): Promise<boolean> {
    if (!this.available) return false;
    if (this.isConnected()) return true;
    if (this.connecting) return false;

    this.connecting = true;

    try {
      return await new Promise<boolean>((resolve) => {
        const sock = net.createConnection(this.socketPath!, () => {
          this.socket = sock;
          this.connecting = false;
          if (this.verbose) console.error("[pi-cmux] connected");
          resolve(true);
        });

        sock.on("data", (data) => this.onData(data));

        sock.on("error", (err) => {
          if (this.verbose) console.error("[pi-cmux] socket error:", err.message);
          this.connecting = false;
          this.cleanup();
          resolve(false);
        });

        sock.on("close", () => {
          if (this.verbose) console.error("[pi-cmux] socket closed");
          this.cleanup();
        });

        // Connection timeout
        sock.setTimeout(3000, () => {
          if (this.verbose) console.error("[pi-cmux] connection timeout");
          sock.destroy();
          this.connecting = false;
          resolve(false);
        });
      });
    } catch {
      this.connecting = false;
      return false;
    }
  }

  /** Default timeouts by method category (ms). */
  private static readonly TIMEOUT_FAST = 5_000;    // metadata queries
  private static readonly TIMEOUT_NORMAL = 15_000;  // interactions, snapshots
  private static readonly TIMEOUT_NAV = 30_000;     // navigation, page loads

  /** Determine timeout for a given method. */
  private timeoutFor(method: string): number {
    // Fast: pure metadata, no page interaction needed
    if (method.startsWith("browser.tab.") ||
        method === "browser.url.get" ||
        method.startsWith("browser.cookies.") ||
        method.startsWith("browser.storage.") ||
        method === "browser.console.list" ||
        method === "browser.errors.list" ||
        method === "browser.network.requests" ||
        method.startsWith("browser.is.") ||
        method.startsWith("browser.find.") ||
        method === "browser.get.title") {
      return CmuxClient.TIMEOUT_FAST;
    }
    // Slow: page loads
    if (method === "browser.navigate" ||
        method === "browser.open_split" ||
        method === "browser.reload" ||
        method === "browser.back" ||
        method === "browser.forward" ||
        method === "browser.wait" ||
        method === "browser.download.wait") {
      return CmuxClient.TIMEOUT_NAV;
    }
    // Everything else: normal
    return CmuxClient.TIMEOUT_NORMAL;
  }

  /** Consecutive timeout counter for circuit-breaker logic. */
  private consecutiveTimeouts = 0;
  private static readonly CIRCUIT_BREAKER_THRESHOLD = 3;

  /** Send a v2 JSON request. Returns the result or null on failure. */
  async request(method: string, params?: Record<string, any>, timeoutOverride?: number): Promise<any | null> {
    // Circuit breaker: if we've had too many consecutive timeouts, fail fast
    // (but allow tab_list / url.get through — they're diagnostic)
    if (this.consecutiveTimeouts >= CmuxClient.CIRCUIT_BREAKER_THRESHOLD &&
        !method.startsWith("browser.tab.") && method !== "browser.url.get") {
      if (this.verbose) console.error("[pi-cmux] circuit breaker open, skipping:", method);
      return null;
    }

    // Auto-reconnect
    if (!this.isConnected()) {
      const ok = await this.connect();
      if (!ok) return null;
    }

    const id = crypto.randomUUID();
    const payload = JSON.stringify({ id, method, params: params ?? {} });
    const timeout = timeoutOverride ?? this.timeoutFor(method);

    if (this.verbose) console.error("[pi-cmux] ->", payload, `(timeout: ${timeout}ms)`);

    return new Promise<any | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.consecutiveTimeouts++;
        if (this.verbose) console.error("[pi-cmux] request timeout:", method, `(consecutive: ${this.consecutiveTimeouts})`);
        resolve(null);
      }, timeout);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          this.pending.delete(id);
          this.consecutiveTimeouts = 0; // reset circuit breaker on success
          resolve(value);
        },
        reject: (reason) => {
          clearTimeout(timer);
          this.pending.delete(id);
          if (this.verbose) console.error("[pi-cmux] request error:", reason);
          resolve(null);
        },
        timer,
      });

      try {
        this.socket!.write(payload + "\n");
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  /**
   * Send a v1 raw text command (e.g. set_status, clear_status).
   * V1 commands are plain text lines that return "OK\n" or an error.
   * Returns the response string or null on failure.
   *
   * V1 responses are queued FIFO — non-JSON lines from the socket are
   * resolved in order against pending v1 commands.
   */
  async v1(command: string): Promise<string | null> {
    // Auto-reconnect
    if (!this.isConnected()) {
      const ok = await this.connect();
      if (!ok) return null;
    }

    if (this.verbose) console.error("[pi-cmux] v1 ->", command);

    return new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => {
        // Remove from queue
        const idx = this.pendingV1.findIndex((p) => p.resolve === resolve);
        if (idx !== -1) this.pendingV1.splice(idx, 1);
        if (this.verbose) console.error("[pi-cmux] v1 timeout:", command);
        resolve(null);
      }, 15_000);

      this.pendingV1.push({ resolve, timer });

      try {
        this.socket!.write(command + "\n");
      } catch {
        const idx = this.pendingV1.findIndex((p) => p.resolve === resolve);
        if (idx !== -1) this.pendingV1.splice(idx, 1);
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  /**
   * Send multiple requests in parallel over the same socket.
   * All requests are written immediately (pipelined) and resolved concurrently.
   * Returns results in the same order as the input.
   */
  async parallel(requests: Array<{ method: string; params?: Record<string, any> }>): Promise<Array<any | null>> {
    return Promise.all(requests.map((r) => this.request(r.method, r.params)));
  }

  /** Reset the circuit breaker (e.g. after recovery via tab_new). */
  resetCircuitBreaker(): void {
    this.consecutiveTimeouts = 0;
  }

  /** True if the circuit breaker is currently open (too many consecutive timeouts). */
  get circuitBreakerOpen(): boolean {
    return this.consecutiveTimeouts >= CmuxClient.CIRCUIT_BREAKER_THRESHOLD;
  }

  /** Close the connection. */
  close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.cleanup();
  }

  // --- internals ---

  private onData(data: Buffer | string): void {
    this.buffer += data.toString();
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;

      // Try JSON first (v2 response)
      if (line.trimStart().startsWith("{")) {
        try {
          const msg = JSON.parse(line);
          if (this.verbose) console.error("[pi-cmux] <-", line);

          const pending = this.pending.get(msg.id);
          if (pending) {
            if (msg.ok === false) {
              pending.reject(msg.error?.message ?? "unknown error");
            } else {
              pending.resolve(msg.result ?? null);
            }
          }
          continue;
        } catch {
          // Fall through to v1 handling
        }
      }

      // Non-JSON line — v1 response. Resolve the oldest pending v1 command.
      if (this.verbose) console.error("[pi-cmux] v1 <-", line);
      const v1 = this.pendingV1.shift();
      if (v1) {
        clearTimeout(v1.timer);
        v1.resolve(line.trim());
      }
    }
  }

  private cleanup(): void {
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
      req.resolve(null);
    }
    this.pending.clear();
    for (const v1 of this.pendingV1) {
      clearTimeout(v1.timer);
      v1.resolve(null);
    }
    this.pendingV1 = [];
    this.buffer = "";
    this.socket = null;
  }
}
