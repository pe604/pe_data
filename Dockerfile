# Niveshaay Deal Pipeline: production image (Next.js standalone + LibreOffice for PPTX decks).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --ignore-scripts

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma generate needs a syntactically valid URL at build time only.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate
ENV NEXT_TELEMETRY_DISABLED=1
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" AUTH_SECRET=build ALLOWED_EMAIL_DOMAIN=build.invalid npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=Asia/Kolkata
# LibreOffice (headless) converts PPTX decks to PDF so Gemini can read charts and images (SPEC §9.1).
RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-impress fonts-dejavu-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd -r app && useradd -r -g app -m -d /home/app app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Migrations run on start (prisma migrate deploy).
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/node_modules/dotenv ./node_modules/dotenv
RUN mkdir -p /data/files && chown -R app:app /data /app
USER app
ENV STORAGE_DIR=/data/files
EXPOSE 3000
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
