FROM oven/bun:1.3.14-alpine

WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile \
 && bun run --cwd apps/dashboard db:generate \
 && DATABASE_URL=postgresql://build:build@127.0.0.1/build \
    RONIN_SESSION_SECRET=build-only-secret-that-is-at-least-32-characters \
    RONIN_ALLOWED_GITHUB_USERS=build \
    bun run build \
 && chown -R bun:bun apps/dashboard/.next apps/docs/.next

ENV NODE_ENV=production
USER bun
EXPOSE 3000 3005
CMD ["bun", "run", "--cwd", "apps/dashboard", "start", "--", "-H", "0.0.0.0"]
