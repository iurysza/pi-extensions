export const PERMISSION_REQUEST_EVENT = "permissions:request";
export const PERMISSION_RESOLVED_EVENT = "permissions:resolved";

export interface PermissionRequestPayload {
  sessionId: string;
  cwd: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface PermissionResolvedPayload extends PermissionRequestPayload {
  response: "allow" | "reject";
}
