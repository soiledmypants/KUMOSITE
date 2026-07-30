# ---- build stage: full node image has the toolchain better-sqlite3 may need
FROM node:22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---- runtime stage
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY panel ./panel
COPY projects.json ./projects.json
COPY package.json ./package.json
# DATA_DIR should point at a mounted volume in production (e.g. /data on Railway)
CMD ["node", "dist/index.js"]
