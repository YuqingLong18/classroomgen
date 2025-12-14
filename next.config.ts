import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit"],
  // Disable static page caching in production to ensure fresh content
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },
};

export default nextConfig;
