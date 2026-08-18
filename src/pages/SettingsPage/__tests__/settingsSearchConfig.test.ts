import { filterSections, SECTION_META } from "../settingsSearchConfig";
import { Permission } from "@shared/permissions";

describe("filterSections", () => {
  it("returns empty array for empty query", () => {
    expect(filterSections("")).toEqual([]);
    expect(filterSections("   ")).toEqual([]);
  });

  it("matches by label", () => {
    const result = filterSections("Theme");
    expect(result).toContain("theme");
  });

  it("matches by keyword", () => {
    const result = filterSections("dark");
    expect(result).toContain("theme");
  });

  it("matches case insensitively", () => {
    const result = filterSections("LIDARR");
    expect(result).toContain("lidarrConnection");
    expect(result).toContain("lidarrOptions");
  });

  it("matches plex section", () => {
    const result = filterSections("plex");
    expect(result).toContain("plex");
  });

  it("matches slskd by soulseek keyword", () => {
    const result = filterSections("soulseek");
    expect(result).toContain("slskd");
  });

  it("matches account section by logout keyword", () => {
    const result = filterSections("logout");
    expect(result).toContain("account");
  });

  it("matches account section by label", () => {
    const result = filterSections("account");
    expect(result).toContain("account");
  });

  it("returns no matches for gibberish", () => {
    expect(filterSections("zzzzzzz")).toEqual([]);
  });
});

describe("SECTION_META", () => {
  it("assigns theme to general tab", () => {
    expect(SECTION_META.theme.tab).toBe("general");
  });

  it("assigns import to integrations tab", () => {
    expect(SECTION_META.import.tab).toBe("integrations");
  });

  it("restricts import to admins", () => {
    expect(SECTION_META.import.permission).toBe(Permission.ADMIN);
  });

  it("assigns lidarrConnection to integrations tab", () => {
    expect(SECTION_META.lidarrConnection.tab).toBe("integrations");
  });

  it("assigns account to general tab", () => {
    expect(SECTION_META.account.tab).toBe("general");
  });

  it("assigns plex to integrations tab", () => {
    expect(SECTION_META.plex.tab).toBe("integrations");
  });

  it("has users section assigned to admin tab", () => {
    expect(SECTION_META.users).toBeDefined();
    expect(SECTION_META.users.tab).toBe("admin");
    expect(SECTION_META.users.label).toBe("User Management");
  });

  it("users section requires MANAGE_USERS permission", () => {
    expect(SECTION_META.users.permission).toBe(Permission.MANAGE_USERS);
  });
});

describe("filterSections with permissions", () => {
  it("returns users section when searching with MANAGE_USERS permission", () => {
    const result = filterSections("user", Permission.MANAGE_USERS);
    expect(result).toContain("users");
  });

  it("returns users section for admin users", () => {
    const result = filterSections("manage", Permission.ADMIN);
    expect(result).toContain("users");
  });

  it("hides users section when user lacks MANAGE_USERS permission", () => {
    const result = filterSections("user", Permission.REQUEST);
    expect(result).not.toContain("users");
  });

  it("hides admin-only sections from non-admin users", () => {
    const result = filterSections("lidarr", Permission.REQUEST);
    expect(result).not.toContain("lidarrConnection");
    expect(result).not.toContain("lidarrOptions");
  });

  it("shows admin-only sections to admin users", () => {
    const result = filterSections("lidarr", Permission.ADMIN);
    expect(result).toContain("lidarrConnection");
    expect(result).toContain("lidarrOptions");
  });

  it("does not filter by permission when userPermissions is undefined", () => {
    const result = filterSections("lidarr");
    expect(result).toContain("lidarrConnection");
    expect(result).toContain("lidarrOptions");
  });

  it("shows sections without permission requirements to all users", () => {
    const result = filterSections("theme", Permission.REQUEST);
    expect(result).toContain("theme");
  });

  it("finds the taste profile inspector by what it is about", () => {
    for (const query of ["taste", "profile", "signals", "genres"]) {
      expect(filterSections(query, Permission.ADMIN)).toContain(
        "tasteProfiles"
      );
    }
  });

  it("keeps the taste profile inspector away from non-admins", () => {
    expect(filterSections("taste", Permission.REQUEST)).not.toContain(
      "tasteProfiles"
    );
  });
});
