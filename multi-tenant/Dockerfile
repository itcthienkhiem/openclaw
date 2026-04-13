FROM node:24-bookworm-slim

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --prod

COPY . .

# Compile TypeScript
RUN pnpm build

EXPOSE 3000
ENV NODE_ENV=production

CMD ["node", "dist/src/index.js"]
