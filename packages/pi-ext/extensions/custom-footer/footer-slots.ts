import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export const FOOTER_SLOT_PROTOCOL_VERSION = 1 as const;
export const FOOTER_SLOT_HOST_READY = "@iurysza/pi-ext/footer-slot/ready/v1";
export const FOOTER_SLOT_REGISTER = "@iurysza/pi-ext/footer-slot/register/v1";
export const FOOTER_SLOT_UNREGISTER = "@iurysza/pi-ext/footer-slot/unregister/v1";

export interface FooterSlotRegistration {
  protocolVersion: typeof FOOTER_SLOT_PROTOCOL_VERSION;
  id: string;
  priority: number;
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
  ) return undefined;
  return candidate as FooterSlotRegistration;
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
  const disposeRegister = events.on(FOOTER_SLOT_REGISTER, (data) => {
    const registration = registrationFrom(data);
    if (registration) priorities.set(registration.id, registration.priority);
  });
  const disposeUnregister = events.on(FOOTER_SLOT_UNREGISTER, (data) => {
    const registration = unregistrationFrom(data);
    if (registration) priorities.delete(registration.id);
  });

  return {
    priorities,
    announceHost() {
      events.emit(FOOTER_SLOT_HOST_READY, { protocolVersion: FOOTER_SLOT_PROTOCOL_VERSION });
    },
    clear() {
      priorities.clear();
    },
    dispose() {
      disposeRegister();
      disposeUnregister();
      priorities.clear();
    },
  };
}

function sanitizeStatus(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim();
}

export function packFooterStatuses(
  statuses: ReadonlyMap<string, string>,
  priorities: ReadonlyMap<string, number>,
  width: number,
  separator: string,
): string | null {
  if (width <= 0 || statuses.size === 0) return null;
  const slots = [...statuses.entries()]
    .map(([id, value]) => ({ id, value: sanitizeStatus(value), priority: priorities.get(id) ?? 0 }))
    .filter(({ value }) => value.length > 0)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  if (slots.length === 0) return null;

  const prefix = " ";
  const first = `${prefix}${slots[0].value}`;
  if (visibleWidth(first) > width) return truncateToWidth(first, width, "…");

  let packed = first;
  for (const slot of slots.slice(1)) {
    const candidate = `${packed}${separator}${slot.value}`;
    if (visibleWidth(candidate) > width) break;
    packed = candidate;
  }
  return packed;
}
