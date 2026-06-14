/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle (.next/standalone) for Docker / any Node
  // host. Harmless on Vercel (ignored there). Ensures server code + traced files
  // ship without relying on the repo layout at runtime.
  output: "standalone",
};

export default nextConfig;
