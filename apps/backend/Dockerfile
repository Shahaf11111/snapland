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
COPY apps/backend apps/backend
RUN pnpm --filter @snapland/backend build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/pnpm-workspace.yaml /repo/package.json /repo/
COPY --from=build /repo/packages/shared /repo/packages/shared
COPY --from=build /repo/apps/backend /repo/apps/backend
WORKDIR /repo
EXPOSE 4000
CMD ["node", "apps/backend/dist/main.js"]
