export type Backend = 'app' | 'legacy' | 'tmux' | 'cmux' | 'none';
export interface AdapterError { code: string; message: string; cleanup?: AdapterError }
export type Result<T> = { ok: true; value: T } | { ok: false; error: AdapterError };
export type Caller =
  | { backend: 'app'; terminal: string; pane: string; tab: string; space: string; appHome: string }
  | { backend: 'legacy'; pane: string; workspace: string }
  | { backend: 'tmux' | 'cmux' | 'none' };
export type OwnedTarget = { id: string; placement: 'split' | 'tab' | 'popup'; ownership: string } & (
  | { backend: 'app'; terminal: string; appHome: string }
  | { backend: 'legacy' | 'tmux' | 'cmux' }
);
export interface LaunchRequest { cwd: string; argv: string[]; placement: 'split' | 'tab'; direction?: 'right' | 'down'; name?: string }
export interface ViewerRequest { cwd: string; argv: string[]; name?: string; legacy?: { plugin: string; entrypoint: string; root: string; env?: Record<string, string> } }
export interface HerdrUi {
  resolveCaller(): Result<Caller>;
  launch(request: LaunchRequest): Result<OwnedTarget>;
  openViewer(request: ViewerRequest): Result<OwnedTarget>;
  send(target: OwnedTarget, text: string): Result<unknown>;
  close(target: OwnedTarget): Result<null>;
}
export function createHerdrUi(options?: { env?: NodeJS.ProcessEnv }): HerdrUi;
