# Shadowplay: one container serves the app, the story-sharing API and Live rooms.

# --- build the web app
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# --- runtime: Node runs server/*.ts directly (type stripping); only `ws` is needed
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/dist
RUN echo '{"type":"module","private":true}' > package.json && npm install --no-save --omit=dev ws@8.22.0 && npm cache clean --force
COPY server ./server
# The voice-command phrases, shared with the app (phrase hints for speech-to-text).
COPY src/voice-commands.ts ./src/voice-commands.ts
# Mo the coach's fact words, shared with the app.
COPY src/coach-vocab.ts ./src/coach-vocab.ts
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "server/main.ts"]
