const { withSentryConfig } = require('@sentry/nextjs');

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
              // Upstash is only ever called server-side from route handlers, so
              // listing its origin granted the browser nothing and disclosed
              // the instance to anyone reading the response headers.
              // Sentry ingest is the org-scoped host o<org>.ingest.<region>.sentry.io;
              // the three regional wildcards cover the legacy, US and EU DSN forms.
              // (Widening connect-src rather than tunnelRoute keeps this file the one
              // place third parties are declared and avoids a proxy.js matcher change.)
              "connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

// Source maps upload and the Sentry build plugin only do work when an auth token
// is present; a missing token (local, CI without the secret, this build) is a
// clean no-op, so the wrap is always safe.
module.exports = withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: !process.env.SENTRY_AUTH_TOKEN,
    sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
    telemetry: false,
});
