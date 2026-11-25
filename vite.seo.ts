/**
 * vite.seo.ts — search-engine files and the site address in the page head (T109–T113)
 *
 * Description:
 *   One place for the public site address (SITE_URL). At build time:
 *     - `%SITE_URL%` in src/index.html (canonical link, Open Graph and
 *       Twitter tags, JSON-LD) becomes the address;
 *     - dist/robots.txt: everything may be crawled except the model and
 *       dictionary data (/models/, /dict/: large files, no page content),
 *       with a pointer to the sitemap;
 *     - dist/sitemap.xml: the one indexable URL. The app uses hash routes
 *       (#/input, …), which search engines treat as the same page.
 *   In dev the placeholder is replaced too; robots.txt and sitemap.xml are
 *   build output only. No request is made and nothing is tracked.
 *
 * Changing the address (custom domain): set SITE_URL below, or build with
 *   the environment variable SITE_URL=https://example.com.
 *
 * Layer: build tooling (Vite plugin).
 * Used by: vite.config.ts. Tests: src/seo.test.ts.
 *
 * Status: implemented (T109–T113).
 */

import type { Plugin } from "vite";

/** Public address of the deployed site, without a trailing slash (PUBLISHING.md → step 3). */
export const SITE_URL = (process.env.SITE_URL ?? "https://enparse.pages.dev").replace(/\/+$/, "");

/** Paths crawlers should skip: data files served from R2, not pages. */
export const DISALLOWED_PATHS: readonly string[] = ["/models/", "/dict/"];

export function robotsTxt(siteUrl: string = SITE_URL): string {
  return [
    "User-agent: *",
    "Allow: /",
    ...DISALLOWED_PATHS.map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${siteUrl}/sitemap.xml`,
    "",
  ].join("\n");
}

/** Sitemap with the single indexable URL; `lastmod` is the build date (YYYY-MM-DD). */
export function sitemapXml(
  siteUrl: string = SITE_URL,
  lastmod: string = new Date().toISOString().slice(0, 10),
): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url>",
    `    <loc>${siteUrl}/</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    "  </url>",
    "</urlset>",
    "",
  ].join("\n");
}

/** Replace the site-address placeholder of index.html. */
export function withSiteUrl(html: string, siteUrl: string = SITE_URL): string {
  return html.replaceAll("%SITE_URL%", siteUrl);
}

export function seo(): Plugin {
  return {
    name: "enparse-seo",
    transformIndexHtml: (html) => withSiteUrl(html),
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robotsTxt() });
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemapXml() });
    },
  };
}
