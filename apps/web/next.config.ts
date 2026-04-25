import type { NextConfig } from "next";
import { resolve } from "path";

// NEXT_PUBLIC_API_URL is required — dev reads it from apps/web/.env,
// production reads it from the CI/Docker build arg. No fallbacks.
if (!process.env.NEXT_PUBLIC_API_URL) {
  throw new Error("[FATAL] NEXT_PUBLIC_API_URL must be set. Dev: check apps/web/.env. Prod: check CI build args.");
}

// NOTE: Content-Security-Policy is emitted by middleware.ts with a per-request
// nonce. Keeping CSP out of next.config.ts headers() avoids shipping a static
// CSP with 'unsafe-inline' — a stored-XSS-to-redirect amplifier.

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname, "../../"),
  images: {
    // Modern formats first — Next.js negotiates based on Accept header
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "jadwal-assets.s3.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "jadwal-assets.s3.me-south-1.amazonaws.com",
      },
      {
        protocol: "https",
        hostname: "cdn.jadwal.app",
      },
      // Dev-only: API serves uploads from localhost:4000/uploads/*
      ...(process.env.NODE_ENV === "development"
        ? [
            {
              protocol: "http" as const,
              hostname: "localhost",
              port: "4000",
              pathname: "/uploads/**",
            },
          ]
        : []),
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            // Deny powerful browser APIs by default. Nothing on this frontend
            // requests geolocation (we use IP-based detection), camera, mic,
            // or clipboard — so shut them off so a stored-XSS payload can't
            // either. If a future feature needs one, allow-list its origin
            // here: e.g. `geolocation=(self)`.
            key: "Permissions-Policy",
            value:
              "geolocation=(), camera=(), microphone=(), payment=(), " +
              "clipboard-read=(), clipboard-write=(), usb=(), magnetometer=(), " +
              "gyroscope=(), accelerometer=(), ambient-light-sensor=(), " +
              "autoplay=(), encrypted-media=(), fullscreen=(self), " +
              "picture-in-picture=(), display-capture=(), midi=()",
          },
          {
            // Isolates the top-level browsing context so a malicious opener
            // (opened tab, popup, or window.open from an attacker page) can
            // NOT access our window.opener. Pairs with rel="noopener" on
            // target=_blank links as defence in depth.
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            // Prevents other origins from embedding our resources as <img>,
            // <script>, or <link>. Blocks cross-origin data theft if a
            // malicious page tries to load our endpoints as scripts or pixels.
            key: "Cross-Origin-Resource-Policy",
            value: "same-site",
          },
          // Content-Security-Policy is set per-request in middleware.ts
          // with a cryptographic nonce — see middleware for the full policy.
        ],
      },
    ];
  },
};

export default nextConfig;
