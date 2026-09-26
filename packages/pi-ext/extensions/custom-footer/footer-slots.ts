import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const FOOTER_SLOT_PROTOCOL_VERSION = 1 as const;
export const FOOTER_SLOT_HOST_READY = "@iurysza/pi-ext/footer-slot/ready/v1";
export const FOOTER_SLOT_REGISTER = "@iurysza/pi-ext/footer-slot/register/v1";
export const FOOTER_SLOT_UNREGISTER = "@iurysza/pi-ext/footer-slot/unregister/v1";

export type FooterSlotPlacement = "core" | "aux" | "context";

export interface FooterSlotRegistration {
  protocolVersion: typeof FOOTER_SLOT_PROTOCOL_VERSION;
  id: string;
  priority: number;
  placement?: FooterSlotPlacement;
}

interface FooterSlotUnregistration {
  protocolVersion: typeof FOOTER_SLOT_PROTOCOL_VERSION;
  id: string;
}

function registrationFrom(data: unknown): FooterSlotRegistration | undefined {
  if (!data || typeof data !== "object") return undefined;
  const candidate = data as Partial<FooterSlotRegistration>;
  if (
    candidate.protocolVersion !== FOOTER_SLOT_PROTOCOL_VERSION
    || typeof candidate.id !== "string"
    || candidate.id.trim() !== candidate.id
    || candidate.id.length === 0
    || typeof candidate.priority !== "number"
    || !Number.isFinite(candidate.priority)
    || (candidate.placement !== undefined && candidate.placement !== "core"
      && candidate.placement !== "aux" && candidate.placement !== "context")
  ) return undefined;
  return {
    protocolVersion: FOOTER_SLOT_PROTOCOL_VERSION,
    id: candidate.id,
    priority: candidate.priority,
    placement: candidate.placement ?? "aux",
  };
}

function unregistrationFrom(data: unknown): FooterSlotUnregistration | undefined {
  if (!data || typeof data !== "object") return undefined;
  const candidate = data as Partial<FooterSlotUnregistration>;
  if (
    candidate.protocolVersion !== FOOTER_SLOT_PROTOCOL_VERSION
    || typeof candidate.id !== "string"
    || candidate.id.length === 0
  ) return undefined;
  return candidate as FooterSlotUnregistration;
}

export function createFooterSlotRegistry(events: ExtensionAPI["events"]) {
  const priorities = new Map<string, number>();
  const placements = new Map<string, FooterSlotPlacement>();
  const disposeRegister = events.on(FOOTER_SLOT_REGISTER, (data) => {
    const registration = registrationFrom(data);
    if (!registration) return;
    priorities.set(registration.id, registration.priority);
    placements.set(registration.id, registration.placement ?? "aux");
  });
  const disposeUnregister = events.on(FOOTER_SLOT_UNREGISTER, (data) => {
    const unregistration = unregistrationFrom(data);
    if (!unregistration) return;
    priorities.delete(unregistration.id);
    placements.delete(unregistration.id);
  });

  return {
    priorities,
    placements,
    announceHost() {
      events.emit(FOOTER_SLOT_HOST_READY, { protocolVersion: FOOTER_SLOT_PROTOCOL_VERSION });
    },
    clear() {
      priorities.clear();
      placements.clear();
    },
    dispose() {
      disposeRegister();
      disposeUnregister();
      priorities.clear();
      placements.clear();
    },
  };
}

function sanitizeStatus(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

export function partitionFooterStatuses(
  statuses: ReadonlyMap<string, string>,
  placements: ReadonlyMap<string, FooterSlotPlacement>,
): { core: Map<string, string>; aux: Map<string, string>; context: Map<string, string> } {
  const core = new Map<string, string>();
  const aux = new Map<string, string>();
  const context = new Map<string, string>();
  for (const [id, value] of statuses) {
    if (placements.get(id) === "context") context.set(id, value);
    else if (placements.get(id) === "core") core.set(id, value);
    else aux.set(id, value);
  }
  return { core, aux, context };
}

export function orderedStatusValues(
  statuses: ReadonlyMap<string, string>,
  priorities: ReadonlyMap<string, number>,
): string[] {
  return [...statuses.entries()]
    .map(([id, value]) => ({ id, value: sanitizeStatus(value), priority: priorities.get(id) ?? 0 }))
    .filter(({ value }) => value.length > 0)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .map(({ value }) => value);
}

export function packFooterStatuses(
  statuses: ReadonlyMap<string, string>,
  priorities: ReadonlyMap<string, number>,
  width: number,
  separator: string,
): string | null {
  const slots = orderedStatusValues(statuses, priorities);
  if (width <= 0 || slots.length === 0) return null;

  const prefix = " ";
  const first = `${prefix}${slots[0]}`;
  if (visibleWidth(first) > width) return truncateToWidth(first, width, "…");

  let packed = first;
  for (const slot of slots.slice(1)) {
    const candidate = `${packed}${separator}${slot}`;
    if (visibleWidth(candidate) > width) break;
    packed = candidate;
  }
  return packed;
}
