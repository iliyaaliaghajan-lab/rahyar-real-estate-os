/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export: no server needed, every page is cacheable by the service worker (offline-first).
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
};
export default nextConfig;
