import type { NextConfig } from "next";

// Every authenticated screen in WeddingFlow AI is per-user and per-studio, so we
// render on each request instead of using Cache Components / partial prerendering.
const nextConfig: NextConfig = {
  cacheComponents: false,
  poweredByHeader: false,
  serverExternalPackages: ["pg", "nodemailer", "pdf-lib"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
