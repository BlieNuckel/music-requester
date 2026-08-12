import type { NotificationTransport, TransportInfo } from "./types";

const transports = new Map<string, NotificationTransport>();

export function registerTransport(transport: NotificationTransport): void {
  transports.set(transport.id, transport);
}

export function clearTransports(): void {
  transports.clear();
}

export function getTransport(id: string): NotificationTransport | undefined {
  return transports.get(id);
}

export function listTransports(): NotificationTransport[] {
  return [...transports.values()];
}

/** Transports a user can express a preference about (internal ones excluded). */
export function listSelectableTransports(): NotificationTransport[] {
  return listTransports().filter((transport) => !transport.internal);
}

export function describeSelectableTransports(): TransportInfo[] {
  return listSelectableTransports().map((transport) => ({
    id: transport.id,
    label: transport.label,
    configured: transport.isConfigured(),
  }));
}
