export type Backend = 'app' | 'legacy' | 'rex' | 'tmux' | 'cmux' | 'none';
export interface AdapterError { code: string; message: string; cleanup?: AdapterError }
/** `warning` is set when openViewer fell back to an app tab after a failed float. */
export type Result<T> = { ok: true; value: T; warning?: AdapterError } | { ok: false; error: AdapterError };
export type Caller =
  | { backend: 'app'; terminal: string; pane: string; tab: string; space: string; appHome: string }
  | { backend: 'legacy'; pane: string; workspace: string }
  | { backend: 'rex'; session: string; block: string }
  | { backend: 'tmux' | 'cmux' | 'none' };
export type OwnedTarget = { id: string; placement: 'split' | 'tab' | 'popup' | 'float'; ownership: string } & (
  | { backend: 'app'; terminal: string; appHome: string }
  | { backend: 'rex'; session: string }
  | { backend: 'legacy' | 'tmux' | 'cmux' }
);
export interface LaunchRequest { cwd: string; argv: string[]; placement: 'split' | 'tab'; direction?: 'right' | 'down'; name?: string }
/** width and height are fractions of the window (default 0.8); the Herdr app ignores them. */
export interface FloatRequest { cwd: string; argv: string[]; name?: string; width?: number; height?: number }
export interface ViewerRequest { cwd: string; argv: string[]; name?: string; legacy?: { plugin: string; entrypoint: string; root: string; env?: Record<string, string> } }
export interface HerdrUi {
  resolveCaller(): Result<Caller>;
  launch(request: LaunchRequest): Result<OwnedTarget>;
  float(request: FloatRequest): Result<OwnedTarget>;
  openViewer(request: ViewerRequest): Result<OwnedTarget>;
  send(target: OwnedTarget, text: string): Result<unknown>;
  close(target: OwnedTarget): Result<null>;
}
export function createHerdrUi(options?: { env?: NodeJS.ProcessEnv; floatTimeoutMs?: number }): HerdrUi;
