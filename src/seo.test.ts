/**
 * src/seo.test.ts — search-engine files and page head (T109–T113)
 *
 * Covers: robots.txt (pages allowed, data folders not, sitemap pointer), sitemap.xml (the one
 * indexable URL), and src/index.html: Korean title and description within snippet lengths, canonical
 * link, Open Graph tags with an absolute image that exists, valid JSON-LD, and a static introduction
 * inside #root. No tracking or third-party scripts.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DISALLOWED_PATHS, robotsTxt, sitemapXml, withSiteUrl } from "../vite.seo.ts";

const SITE = "https://example.test";
const file = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url));
// Without the header comment (it describes the tags).
const html = withSiteUrl(readFileSync(file("./index.html"), "utf8"), SITE).replace(/^<!--[\s\S]*?-->/, "");
const meta = (key: string): string | null =>
  new RegExp(`<meta\\s+(?:name|property)="${key}"\\s+content="([^"]*)"`).exec(html)?.[1] ?? null;

describe("robots.txt and sitemap.xml", () => {
  it("lets crawlers read the pages but not the model and dictionary data, and names the sitemap", () => {
    const lines = robotsTxt(SITE).split("\n");
    expect(lines.slice(0, 2)).toEqual(["User-agent: *", "Allow: /"]);
    expect(DISALLOWED_PATHS).toEqual(["/models/", "/dict/"]);
    for (const p of DISALLOWED_PATHS) expect(lines).toContain(`Disallow: ${p}`);
    expect(lines).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it("lists the one indexable URL (hash routes are the same page)", () => {
    const xml = sitemapXml(SITE, "2026-11-25");
    expect(xml.match(/<loc>/g)).toHaveLength(1);
    expect(xml).toContain(`<loc>${SITE}/</loc>`);
    expect(xml).toContain("<lastmod>2026-11-25</lastmod>");
  });
});

describe("index.html", () => {
  it("has a Korean title and description that fit a search result", () => {
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
    expect(title).toContain("Enparse");
    expect(title).toContain("영어 구문분석");
    expect(title.length).toBeLessThanOrEqual(40);
    const description = meta("description") ?? "";
    expect(description).toContain("무료");
    expect(description.length).toBeGreaterThan(40);
    expect(description.length).toBeLessThanOrEqual(110);
    // One natural mention, not a keyword list.
    expect(description.match(/구문분석/g)).toHaveLength(1);
    expect(html).not.toMatch(/<meta\s+name="keywords"/);
  });

  it("names its canonical address and link-preview data with absolute URLs", () => {
    expect(html).toContain(`<link rel="canonical" href="${SITE}/" />`);
    expect(meta("og:url")).toBe(`${SITE}/`);
    expect(meta("og:title")).toContain("Enparse");
    expect(meta("og:description")).toBeTruthy();
    expect(meta("og:image")).toBe(`${SITE}/og-image.png`);
    expect(existsSync(file("../public/og-image.png"))).toBe(true);
    expect(meta("twitter:card")).toBe("summary_large_image");
    expect(html).not.toContain("%SITE_URL%");
  });

  it("describes the app as a free web application in valid JSON-LD, without ratings", () => {
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    const data = JSON.parse(json) as Record<string, unknown>;
    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Enparse",
      url: `${SITE}/`,
      isAccessibleForFree: true,
      offers: { price: "0" },
    });
    expect(data).not.toHaveProperty("aggregateRating");
    expect(data).not.toHaveProperty("review");
  });

  it("carries a static introduction inside #root for crawlers that do not run scripts", () => {
    const root = /<div id="root">([\s\S]*?)<\/div>\s*<script type="module"/.exec(html)?.[1] ?? "";
    expect(root).toMatch(/<h1>Enparse – 무료 영어 구문분석 툴<\/h1>/);
    expect(root).toContain("서버로 보내지 않습니다");
    expect(root).toContain("<noscript>");
  });

  it("loads no third-party script, font, or tracker", () => {
    const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1] as string);
    for (const u of urls) expect(u.startsWith("./") || u.startsWith(`${SITE}/`)).toBe(true);
  });
});
