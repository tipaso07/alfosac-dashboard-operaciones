FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm install
COPY apps/api ./apps/api
RUN npm run build --workspace=@alfosac/dashboard-api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm install --omit=dev
COPY --from=build /app/apps/api/dist ./apps/api/dist
EXPOSE 5100
CMD ["node", "apps/api/dist/server.js"]

