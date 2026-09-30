# Niveshaay Deal Pipeline: production image.
# Next.js standalone server + LibreOffice (PPTX → PDF) + a self-contained Prisma CLI for migrations.

ARG NODE_IMAGE=node:22-bookworm-slim

# ─── Dependencies (incl. dev deps needed to build) ───────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

# ─── Build ───────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma needs OpenSSL to pick its engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time placeholders only; real values come from the runtime environment.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate \
 && DATABASE_URL="postgresql://build:build@localhost:5432/build" AUTH_SECRET=build ALLOWED_EMAIL_DOMAIN=build.invalid npm run build

# ─── Migrator: Prisma CLI with all its dependencies, isolated from the app ───
FROM ${NODE_IMAGE} AS migrator
WORKDIR /migrate
RUN npm init -y >/dev/null \
 && npm pkg set overrides.mysql2=^3.24.5 overrides.deepmerge-ts=^8.0.2 \
 && npm install --no-audit --no-fund prisma@7.10.0 dotenv@18 \
 && npm cache clean --force
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY prisma/migrations ./prisma/migrations
COPY prisma.config.ts ./

# ─── Runtime ─────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=Asia/Kolkata STORAGE_DIR=/data/files
# LibreOffice (headless) converts PPTX decks to PDF so the model can read charts and images (SPEC §9.1).
RUN apt-get update \
 && apt-get install -y --no-install-recommends libreoffice-impress fonts-dejavu-core ca-certificates curl openssl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -r app && useradd -r -g app -m -d /home/app app \
 && mkdir -p /data/files && chown -R app:app /data /app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=migrator --chown=app:app /migrate /migrate
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
# Apply pending migrations, then start. `exec` makes node PID 1's child receive SIGTERM for a clean shutdown.
CMD ["sh", "-c", "cd /migrate && node node_modules/prisma/build/index.js migrate deploy && cd /app && exec node server.js"]
