# AccessiBU — Expo web app (development server in a container).
# Gives every teammate the exact same Node version and dependency tree, so
# "works on my machine" problems disappear.

FROM node:22-bookworm-slim

WORKDIR /app

# Install dependencies first (better layer caching). Copy only the manifests so
# this layer is reused unless the lockfile changes.
COPY package.json package-lock.json ./

# Use a clean, reproducible install from the lockfile.
RUN npm ci

# Copy the rest of the source. node_modules is excluded via .dockerignore.
COPY . .

# Expo web dev server + Metro bundler.
EXPOSE 8081

# Bind to 0.0.0.0 so the server is reachable from the host machine, and point
# Metro at the mapped port.
ENV EXPO_NO_TELEMETRY=1
CMD ["npx", "expo", "start", "--web", "--port", "8081", "--host", "lan"]
