FROM node:20-alpine

WORKDIR /app

# Manifest first so dependency installs are cached across source changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Application source
COPY src/ ./src/
COPY proto/ ./proto/

# stdio MCP server entrypoint. Env vars (LARK_COOKIE / LARK_APP_ID /
# LARK_APP_SECRET / LARK_USER_ACCESS_TOKEN / LARK_USER_REFRESH_TOKEN) are
# supplied by the MCP client at process spawn time.
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
