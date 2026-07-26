import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROTOCOL_VERSION = 1 as const;
const HOST_READY = "@iurysza/pi-ext/footer-slot/ready/v1";
const REGISTER = "@iurysza/pi-ext/footer-slot/register/v1";
const UNREGISTER = "@iurysza/pi-ext/footer-slot/unregister/v1";

export function createFooterSlotRegistration(
  events: ExtensionAPI["events"],
  id: string,
  priority: number,
) {
  const payload = { protocolVersion: PROTOCOL_VERSION, id, priority };
  const register = () => events.emit(REGISTER, payload);
  const disposeReady = events.on(HOST_READY, (data) => {
    if ((data as { protocolVersion?: unknown } | undefined)?.protocolVersion === PROTOCOL_VERSION) register();
  });
  register();

  return {
    register,
    dispose() {
      events.emit(UNREGISTER, { protocolVersion: PROTOCOL_VERSION, id });
      disposeReady();
    },
  };
}
