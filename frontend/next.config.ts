import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the dev badge sits on top of the sidebar footer
  devIndicators: false,
  // a self-contained server bundle for the Docker image (deploy/tower-ui.Dockerfile)
  output: "standalone",
};

export default nextConfig;
