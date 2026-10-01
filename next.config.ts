import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Open-access portal (no login yet): keep it out of search engines.
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Other sites can't embed or fetch our files/images.
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // Production is served over HTTPS only (behind the reverse proxy). Not sent in dev (plain http://localhost).
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];
// The Content-Security-Policy (with a per-request nonce) is set in src/proxy.ts.

const nextConfig: NextConfig = {
  output: "standalone",
  // The E2E server runs alongside the normal dev server, so it builds into its own folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  // exceljs, archiver and the Prisma pg adapter are Node-only.
  serverExternalPackages: ["exceljs", "archiver", "@prisma/adapter-pg", "pg", "unpdf"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
