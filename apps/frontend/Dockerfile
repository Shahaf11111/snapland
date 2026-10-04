FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
# Full shared source (not just package.json): the root postinstall hook
# builds @snapland/shared during `pnpm install` below, so its tsconfig.json
# and src need to already be present.
COPY packages/shared packages/shared
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
COPY apps/frontend apps/frontend
RUN pnpm --filter @snapland/frontend build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/frontend/dist /usr/share/nginx/html
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
