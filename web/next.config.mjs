import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  webpack: (config, { isServer }) => {
    // Phaser requires some specific handling
    config.module.rules.push({
      test: /\.m?js$/,
      resolve: {
        fullySpecified: false,
      },
    });

    // Stub out optional dependencies from wagmi/RainbowKit connectors
    config.resolve.fallback = {
      ...config.resolve.fallback,
      'pino-pretty': false,
    };

    // Phaser 3.80 has a truncated phaser.js dist — use the ESM build instead
    config.resolve.alias = {
      ...config.resolve.alias,
      phaser: path.resolve(__dirname, 'node_modules/phaser/dist/phaser.esm.js'),
      '@react-native-async-storage/async-storage': false,
    };

    return config;
  },
  async rewrites() {
    const apiTarget = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    return [
      {
        source: '/api/:path*',
        destination: `${apiTarget}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
