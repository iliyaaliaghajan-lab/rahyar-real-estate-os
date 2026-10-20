/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Static export was removed to support multi-tenant features:
  // - API Routes / Server Actions
  // - Secure authentication callbacks
  // - Middleware for session & organization checks
  //
  // PWA capabilities (manifest + service worker) remain intact.
  // trailingSlash is kept for compatibility with existing offline routes.

  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
