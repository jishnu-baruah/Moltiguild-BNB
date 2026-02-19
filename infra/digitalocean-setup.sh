#!/bin/bash
# DigitalOcean Droplet Setup — MoltiGuild-BNB
# Target: $12/mo (2 vCPU, 2GB RAM) Ubuntu 24.04
#
# Usage: ssh root@DROPLET_IP < infra/digitalocean-setup.sh
#   or:  scp this file to the droplet and run it there

set -euo pipefail

echo "═══════════════════════════════════════"
echo "  MoltiGuild-BNB — Droplet Setup"
echo "═══════════════════════════════════════"

# --- System updates ---
apt-get update && apt-get upgrade -y
apt-get install -y curl git ufw

# --- Swap (2GB for 2GB RAM droplet) ---
if [ ! -f /swapfile ]; then
  echo "[setup] Creating 2GB swap..."
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Tune swappiness for low-memory server
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
fi

# --- Docker ---
if ! command -v docker &>/dev/null; then
  echo "[setup] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
fi

# --- Docker Compose (v2, plugin) ---
if ! docker compose version &>/dev/null; then
  echo "[setup] Installing Docker Compose plugin..."
  apt-get install -y docker-compose-plugin
fi

# --- Firewall (only SSH — Cloudflare Tunnel handles ingress) ---
ufw allow OpenSSH
ufw --force enable
echo "[setup] Firewall: only SSH allowed (Cloudflare Tunnel handles web traffic)"

# --- Clone repo ---
REPO_DIR=/opt/moltiguild-bnb
if [ ! -d "$REPO_DIR" ]; then
  echo "[setup] Cloning MoltiGuild-BNB..."
  git clone https://github.com/your-org/MoltiGuild-BNB.git "$REPO_DIR"
else
  echo "[setup] Repo exists, pulling latest..."
  cd "$REPO_DIR" && git pull
fi

cd "$REPO_DIR"

# --- Environment file ---
if [ ! -f .env ]; then
  echo ""
  echo "═══════════════════════════════════════"
  echo "  IMPORTANT: Copy your .env file"
  echo "═══════════════════════════════════════"
  echo ""
  echo "  scp .env root@DROPLET_IP:$REPO_DIR/.env"
  echo ""
  echo "  Then run:"
  echo "  cd $REPO_DIR && docker compose --env-file .env -f infra/docker-compose.yml --profile full --profile agents up -d --build"
  echo ""
  exit 0
fi

# --- Build and start ---
echo "[setup] Building and starting containers..."
docker compose --env-file .env -f infra/docker-compose.yml --profile full --profile agents up -d --build

echo ""
echo "═══════════════════════════════════════"
echo "  Setup complete!"
echo "═══════════════════════════════════════"
echo ""
echo "  Services: docker compose --env-file .env -f infra/docker-compose.yml ps"
echo "  Logs:     docker compose --env-file .env -f infra/docker-compose.yml logs -f"
echo "  Stop:     docker compose --env-file .env -f infra/docker-compose.yml down"
echo ""
echo "  Next steps:"
echo "  1. Configure Cloudflare Tunnel routes:"
echo "     moltiguild.fun    → http://web:3000"
echo "     api.moltiguild.fun → http://api:3001"
echo "     gateway.moltiguild.fun → http://openclaw:18789"
echo ""
