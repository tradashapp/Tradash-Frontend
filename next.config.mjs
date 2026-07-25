/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // bulk-keychain ships as a WASM module; allow it to be bundled for the browser.
  webpack: (config) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
};

export default nextConfig;
