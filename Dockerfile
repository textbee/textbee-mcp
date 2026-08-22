# Builds the stdio MCP server from source. Used by directory checkers (Glama)
# that start the server in a container and speak MCP to it, and usable by
# anyone who prefers Docker over npx:
#
#   docker build -t textbee-mcp .
#   docker run -i --rm -e TEXTBEE_API_KEY=your-key textbee-mcp
#
# The server boots without a key (tools then explain what to set), so an
# introspection-only run needs no secrets.

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
ENTRYPOINT ["node", "dist/bin.js"]
