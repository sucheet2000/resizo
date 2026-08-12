FROM node:20-alpine AS base

FROM base AS deps
# libc6-compat is glibc shimming for native node modules on musl. It was here
# for sharp, which was a RUNTIME dependency and was traced into the standalone
# output. Sharp no longer does any of this app's image work — the browser does —
# and the shipped server has no native module at all. It survives as a
# devDependency for the test fixtures and the brand-asset scripts, and `npm ci`
# below still installs devDependencies because the Next build needs Tailwind and
# the React compiler plugin. So this line stays until that install stops pulling
# sharp in; it no longer protects anything that runs in production.
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# node:20-alpine ships neither curl nor wget, but Node has global fetch. Hits
# the liveness probe, which is now the only route the app serves and touches
# nothing external, so a wedged-but-alive process is recycled and nothing else
# can trip the check.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
