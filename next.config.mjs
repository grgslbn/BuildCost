/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // ESLint runs separately; don't block Vercel builds on lint errors
    ignoreDuringBuilds: true,
  },
  // mupdf ships a WASM binary that Next.js's bundler can't handle.
  // Mark it (and sharp) as external so they're loaded from node_modules at runtime.
  serverExternalPackages: ["mupdf", "sharp"],
};

export default nextConfig;
