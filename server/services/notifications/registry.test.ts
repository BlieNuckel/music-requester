import { describe, it, expect, beforeEach } from "vitest";
import {
  clearTransports,
  describeSelectableTransports,
  getTransport,
  listSelectableTransports,
  listTransports,
  registerTransport,
} from "./registry";
import type { NotificationTransport } from "./types";

function makeTransport(
  id: string,
  overrides: Partial<NotificationTransport> = {}
): NotificationTransport {
  return {
    id,
    label: id,
    isConfigured: () => true,
    send: () => Promise.resolve(),
    ...overrides,
  };
}

beforeEach(() => {
  clearTransports();
});

describe("registry", () => {
  it("registers and looks up transports by id", () => {
    const transport = makeTransport("email");
    registerTransport(transport);

    expect(getTransport("email")).toBe(transport);
    expect(listTransports()).toEqual([transport]);
  });

  it("returns undefined for an unknown transport", () => {
    expect(getTransport("nope")).toBeUndefined();
  });

  it("replaces a transport registered twice under the same id", () => {
    registerTransport(makeTransport("email", { label: "first" }));
    registerTransport(makeTransport("email", { label: "second" }));

    expect(listTransports()).toHaveLength(1);
    expect(getTransport("email")?.label).toBe("second");
  });

  it("hides internal transports from the selectable list", () => {
    registerTransport(makeTransport("log", { internal: true }));
    registerTransport(makeTransport("email"));

    expect(listTransports()).toHaveLength(2);
    expect(listSelectableTransports().map((t) => t.id)).toEqual(["email"]);
  });

  it("describes selectable transports with their configured state", () => {
    registerTransport(makeTransport("log", { internal: true }));
    registerTransport(
      makeTransport("email", { label: "Email", isConfigured: () => false })
    );

    expect(describeSelectableTransports()).toEqual([
      { id: "email", label: "Email", configured: false },
    ]);
  });
});
