# ---- Stage 1: run the tests. If they fail, the image does not build. ----
FROM node:22-alpine AS test
WORKDIR /app
COPY package.json ./
COPY backend ./backend
RUN npm test

# ---- Stage 2: serve the dashboard with nginx ----
FROM nginx:1.27-alpine

# Same folder layout as the project, so the page works exactly like it does locally.
COPY frontend /usr/share/nginx/html/frontend
RUN printf '<!DOCTYPE html><meta charset="UTF-8"><meta http-equiv="refresh" content="0; url=frontend/"><a href="frontend/">Open ClimateGuard</a>' > /usr/share/nginx/html/index.html

# Copying from the test stage is what forces the tests to run before this image exists.
COPY --from=test /app/backend/risk-engine.js /usr/share/nginx/html/backend/risk-engine.js

# The live API only accepts requests from the CloudFront site (CORS), so the container
# runs in "local mode": the browser fetches weather directly and uses the same risk engine.
COPY docker/config.local.js /usr/share/nginx/html/frontend/config.js

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/frontend/ >/dev/null || exit 1