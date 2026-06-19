import type { NextConfig } from "next";

// In production (`next build` for coders.kr) we pre-render to ./out/ as a
// static export served by nginx — no Node runtime, identity + data fetched
// client-side via /api/* which nginx proxies to the backend.
//
// In local dev (`next dev`) there is no nginx, so we proxy /api/* to the
// backend ourselves via rewrites (BACKEND_URL is set by compose). Rewrites
// aren't compatible with output:"export", so we only enable export in prod.
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  ...(isDev ? {} : { output: "export" }),
  trailingSlash: false,
  ...(isDev
    ? {
        async rewrites() {
          const backend = process.env.BACKEND_URL ?? "http://localhost:8000";
          return [
            { source: "/api/:path*", destination: `${backend}/api/:path*` },
          ];
        },
      }
    : {}),
};

export default nextConfig;
