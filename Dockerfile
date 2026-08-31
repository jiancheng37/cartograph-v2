FROM node:24-alpine AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY apps/server apps/server
COPY packages/shared packages/shared
RUN npm run build -w @cartograph/shared && npm run build -w @cartograph/server

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /workspace/apps/server/dist apps/server/dist
COPY --from=build /workspace/packages/shared/dist packages/shared/dist
USER node
CMD ["node", "apps/server/dist/http.js"]
