#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Esegui con sudo: sudo bash install-docker.sh"
  exit 1
fi

. /etc/os-release
if [[ "${ID:-}" != "ubuntu" ]]; then
  echo "Questo script è destinato a Ubuntu."
  exit 1
fi

echo "==> Installazione prerequisiti..."
apt-get update
apt-get install -y ca-certificates curl

echo "==> Configurazione repository ufficiale Docker..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
ARCH="$(dpkg --print-architecture)"

echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

echo "==> Installazione Docker..."
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

echo "==> Avvio automatico di Docker..."
systemctl enable --now docker

echo "==> Verifica installazione..."
docker --version
docker compose version
docker run --rm hello-world

if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
  echo "==> Aggiunta di $SUDO_USER al gruppo docker..."
  usermod -aG docker "$SUDO_USER"
  echo "Esci e rientra per usare docker senza sudo."
fi

echo "Installazione completata!"
