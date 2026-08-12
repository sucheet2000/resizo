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
              //
              // 'wasm-unsafe-eval' is what lets WebAssembly.compile/instantiate
              // run at all. Without it every image codec in lib/image-client is
              // dead on arrival — the browser blocks the module before it is
              // instantiated. Despite the name it grants nothing to JavaScript:
              // it permits WASM compilation only, and is the narrow replacement
              // for having to open up 'unsafe-eval'.
              "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              // `https:` is gone: it was blanket permission for remote images
              // and the site loads none — every image on a tool page is now
              // either a bundled asset or a blob: URL the engine produced in
              // this tab. data: covers the inline SVG marks.
              "img-src 'self' data: blob:",
              // Still 'self', but for the opposite reason than before. It used
              // to be the widest the app needed because uploads went to our own
              // routes; nothing is uploaded now, and what actually needs it is
              // the engine fetching its own codecs — /wasm/*.wasm and the
              // worker script, both same-origin. Left as 'self' rather than
              // 'none' for that reason, and it is worth having as a mechanical
              // guarantee: a page that tried to post a photo to any other host
              // would be blocked here rather than merely promised not to.
              "connect-src 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
