FROM node:22-bookworm-slim

# Deps MuseScore 4 AppImage + headless (xvfb)
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xauth wget ca-certificates libopengl0 libgl1 libegl1 \
    libxcb1 libxkbcommon0 libjack-jackd2-0 libnss3 libasound2 \
    libfontconfig1 libfreetype6 libglib2.0-0 libsm6 libxrender1 libxext6 \
    libx11-6 libdbus-1-3 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# MuseScore Studio 4.4.1 (pine, reproductible)
WORKDIR /opt/musescore
RUN wget -q -O ms.appimage "https://cdn.jsdelivr.net/musescore/v4.4.1/MuseScore-Studio-4.4.1.242490810-x86_64.AppImage" \
    && chmod +x ms.appimage \
    && ./ms.appimage --appimage-extract \
    && mv squashfs-root /opt/mscore \
    && rm ms.appimage \
    && ls /opt/mscore/bin/

# Wrapper xvfb -> binaire reel
RUN printf '#!/bin/sh\nexec xvfb-run -a /opt/mscore/bin/mscore4portable "$@"\n' > /usr/local/bin/mscore-wrapper \
    && chmod +x /usr/local/bin/mscore-wrapper

ENV MUSESCORE_BIN=/usr/local/bin/mscore-wrapper
ENV QT_QPA_PLATFORM=offscreen
ENV PORT=8000

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

EXPOSE 8000
CMD ["node", "dist/server.js"]
