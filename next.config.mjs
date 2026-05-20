/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // ESLint runs separately; don't block Vercel builds on lint errors
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
