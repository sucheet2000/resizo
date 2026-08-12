/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output is for self-hosting (the Docker image runs
  // `node server.js` from it). Vercel builds Next natively and does NOT want
  // it — with Next 16.3 it fails tracing (missing next-server.js.nft.json) —
  // and `next start`/E2E cannot serve it either. So it is on only off-platform.
  output: (process.env.VERCEL || process.env.E2E_BUILD) ? undefined : 'standalone',
  reactCompiler: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // 'unsafe-inline' stays for the Next runtime bootstrap, which is
              // inline. 'unsafe-eval' is not needed. No third-party script hosts:
              // the app ships no ads or analytics.
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https:",
              // Upstash is only ever called server-side from route handlers, and
              // the site ships no analytics or other third-party scripts, so the
              // browser never makes a cross-origin request at all.
              "connect-src 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
