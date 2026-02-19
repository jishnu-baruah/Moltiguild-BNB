#!/bin/bash
set -e

# Copy config from mounted volume or use bundled default
if [ -f /config/openclaw.config.json ]; then
  cp /config/openclaw.config.json /app/openclaw.config.json
  mkdir -p /root/.openclaw
  cp /config/openclaw.config.json /root/.openclaw/config.json
  echo "[openclaw] Using mounted config from /config/openclaw.config.json"
fi

# Verify config exists
if [ ! -f /app/openclaw.config.json ]; then
  echo "[openclaw] ERROR: No openclaw.config.json found. Mount one at /config/ or include in build."
  exit 1
fi

# Copy agent SOUL.md files to workspace directories
# OpenClaw reads SOUL.md from ~/.openclaw/workspace-<agent>/ not from config
if [ -d /config/agents ]; then
  for agent_dir in /config/agents/*/; do
    agent_name=$(basename "$agent_dir")
    ws_dir="/root/.openclaw/workspace-${agent_name}"
    mkdir -p "$ws_dir"
    if [ -f "${agent_dir}SOUL.md" ]; then
      cp "${agent_dir}SOUL.md" "${ws_dir}/SOUL.md"
      echo "[openclaw] Loaded ${agent_name} SOUL.md"
    fi
  done
fi

echo "[openclaw] Starting gateway on port 18789..."
exec node openclaw.mjs gateway --bind lan
