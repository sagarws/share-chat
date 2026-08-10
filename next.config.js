/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  // better-sqlite3 has native bindings; Next must load it from node_modules
  // at runtime instead of bundling it into the route handler.
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3'],
  },
};
