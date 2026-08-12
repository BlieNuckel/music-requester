import manifestJson from "../../public/manifest.json?raw";
import indexHtml from "../../index.html?raw";

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
};

type Manifest = {
  id: string;
  name: string;
  short_name: string;
  description: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
  shortcuts: { name: string; url: string }[];
};

const manifest = JSON.parse(manifestJson) as Manifest;

const publicFiles = new Set(
  Object.keys(import.meta.glob("../../public/*", { eager: true })).map((file) =>
    file.replace("../../public/", "")
  )
);

describe("manifest.json", () => {
  it("declares the fields an installable app needs", () => {
    expect(manifest.id).toBeTruthy();
    expect(manifest.name).toBe("Tunearr");
    expect(manifest.short_name).toBe("Tunearr");
    expect(manifest.description).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
  });

  it("ships both any and maskable icons at 192 and 512", () => {
    const bySize = (purpose: string, size: string) =>
      manifest.icons.find(
        (icon) => icon.purpose === purpose && icon.sizes === size
      );

    expect(bySize("any", "192x192")).toBeDefined();
    expect(bySize("any", "512x512")).toBeDefined();
    expect(bySize("maskable", "192x192")).toBeDefined();
    expect(bySize("maskable", "512x512")).toBeDefined();
  });

  it("points every icon at a file that exists", () => {
    for (const icon of manifest.icons) {
      expect(publicFiles.has(icon.src.replace(/^\//, ""))).toBe(true);
    }
  });

  it("agrees with the theme-color declared in index.html", () => {
    const match = indexHtml.match(/<meta name="theme-color" content="([^"]+)"/);

    expect(match?.[1]?.toLowerCase()).toBe(manifest.theme_color.toLowerCase());
  });

  it("only links shortcuts to real app routes", () => {
    for (const shortcut of manifest.shortcuts) {
      expect(shortcut.url.startsWith("/")).toBe(true);
    }
  });
});

describe("index.html", () => {
  it("links the manifest and the apple touch icon", () => {
    expect(indexHtml).toContain('rel="manifest" href="/manifest.json"');
    expect(indexHtml).toContain('rel="apple-touch-icon"');
  });

  it("carries the iOS standalone meta tags a home-screen install needs", () => {
    expect(indexHtml).toContain('name="apple-mobile-web-app-capable"');
    expect(indexHtml).toContain('name="apple-mobile-web-app-title"');
    expect(indexHtml).toContain('name="apple-mobile-web-app-status-bar-style"');
  });

  it("no longer ships the create-react-app description", () => {
    expect(indexHtml).not.toContain("create-react-app");
  });
});
