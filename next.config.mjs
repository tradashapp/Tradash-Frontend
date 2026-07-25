/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next 16 runs on Turbopack by default. Empty config silences the
  // webpack/turbopack mismatch warning. When we wire bulk-keychain (WASM) in
  // Phase 2 we'll add any Turbopack-specific loader rules here.
  turbopack: {},
};

export default nextConfig;
