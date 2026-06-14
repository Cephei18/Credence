# Credence — production image for the Next.js app (frontend + API/CRE bridge).
# Self-contained via Next "standalone" output; works on any Docker host.
# Build context = repo root (npm workspaces). Smart contracts are deployed
# separately to the chain — they are NOT part of this image.

# 1 · install workspace deps
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
COPY contracts/package.json contracts/
RUN npm ci

# 2 · build the web app
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm --workspace @agent-passport/web run build

# 3 · minimal runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# standalone server + the static assets / public files it serves
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static
COPY --from=builder /app/web/public ./web/public
EXPOSE 3000
# Provide at runtime: NEXT_PUBLIC_PRIVY_APP_ID, OPERATOR_PRIVATE_KEY,
# BASE_SEPOLIA_RPC_URL (see DEPLOYMENT.md).
CMD ["node", "web/server.js"]
