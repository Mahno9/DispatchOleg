# Build stage: install all workspaces, build server + web apps + minigames
FROM node:24-slim AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/player/package.json web/player/
COPY web/admin/package.json web/admin/
COPY minigames/rescue-catch/package.json minigames/rescue-catch/
COPY minigames/task-sort/package.json minigames/task-sort/
COPY minigames/three-mazes/package.json minigames/three-mazes/
COPY minigames/safe-crack/package.json minigames/safe-crack/
COPY minigames/cooking-orders/package.json minigames/cooking-orders/
COPY minigames/tetris-fill/package.json minigames/tetris-fill/
RUN npm ci

COPY tsconfig.base.json ./
COPY scripts/ scripts/
COPY minigames/ minigames/
COPY server/ server/
COPY web/ web/
RUN npm run build

# Prune to production deps only (keeps the linux-built better-sqlite3 binary)
RUN npm prune --omit=dev

# Runtime stage
FROM node:24-slim
# ffmpeg is required: server/src/routes/assets.ts shells out to it to transcode
# uploaded FLAC audio to Ogg Vorbis before storing it.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080
WORKDIR /app

COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/server/dist ./server/dist
COPY --from=build /repo/server/static ./server/static
# Schema-only system minigames (onboarding) — served straight from the source tree.
COPY --from=build /repo/server/system-minigames ./server/system-minigames
COPY --from=build /repo/server/package.json ./server/
COPY --from=build /repo/web/player/dist ./web/player/dist
COPY --from=build /repo/web/admin/dist ./web/admin/dist

VOLUME /data
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
