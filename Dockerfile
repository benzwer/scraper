# Runs the scraper in watch mode with a virtual screen (Xvfb): the browser stays a normal, visible
# one, which portals block less often than a headless one. See README, "Running with Docker".
# The image tag must match the Playwright version in package-lock.json.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

# openbox: a minimal window manager, without it --start-maximized has no effect and the browser
# opens at about half the screen (portals would show a narrower layout than on your computer).
RUN apt-get update \
    && apt-get install -y --no-install-recommends xvfb openbox tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

# Starts as root only to take the uid of the owner of user/, then runs as that user.
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
ENV DISPLAY=:99

# Stale X files (left by a stopped container) would stop Xvfb from starting again. node is exec'd
# so that it receives the stop signal (SIGINT) and saves before exiting.
CMD ["sh", "-c", "rm -f /tmp/.X99-lock /tmp/.X11-unix/X99; (Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/dev/null 2>&1 &); sleep 1; (openbox >/dev/null 2>&1 &); sleep 1; exec node src/index.js --watch"]
