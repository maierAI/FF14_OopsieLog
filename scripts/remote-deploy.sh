#!/usr/bin/env bash

set -euo pipefail

APP_DIR="${1:?app dir required}"
RELEASE_NAME="${2:?release name required}"
ARCHIVE_PATH="${3:?archive path required}"
SERVICE_NAME="${4:-ff14-oopsie-dev}"
NODE_VERSION="${5:-22}"
APP_PORT="${6:-3101}"
APP_HOST="${7:-127.0.0.1}"

APP_DIR="$(readlink -f "$APP_DIR" 2>/dev/null || echo "$APP_DIR")"
RELEASES_DIR="$APP_DIR/releases"
SHARED_DIR="$APP_DIR/shared"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"
CURRENT_LINK="$APP_DIR/current"
LOG_DIR="$SHARED_DIR/logs"
DATA_DIR="$SHARED_DIR/data"
ENV_FILE="$SHARED_DIR/app.env"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
DB_PATH="$DATA_DIR/data.db"

load_node_runtime() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
    nvm use "$NODE_VERSION" >/dev/null
  fi
}

load_node_runtime

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js and npm are required on the remote host. Install Node ${NODE_VERSION} or configure nvm for the deploy user." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" != "${NODE_VERSION%%.*}" ]; then
  echo "Expected Node major ${NODE_VERSION%%.*}, but found $(node -v)." >&2
  exit 1
fi

mkdir -p "$RELEASES_DIR" "$SHARED_DIR" "$LOG_DIR" "$DATA_DIR"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"

cd "$RELEASE_DIR"
npm ci --omit=dev

cat > "$ENV_FILE" <<EOF
HOST=$APP_HOST
PORT=$APP_PORT
DB_PATH=$DB_PATH
NODE_ENV=production
EOF

NODE_BIN="$(command -v node)"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=FF14 OopsieLog development service
After=network.target

[Service]
Type=simple
WorkingDirectory=$CURRENT_LINK
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN server/server.js
Restart=always
RestartSec=5
StandardOutput=append:$LOG_DIR/app.log
StandardError=append:$LOG_DIR/app-error.log

[Install]
WantedBy=multi-user.target
EOF

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
systemctl restart "$SERVICE_NAME"
systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,20p'

sleep 2
HEALTH_HOST="$APP_HOST"
if [ "$HEALTH_HOST" = "0.0.0.0" ] || [ "$HEALTH_HOST" = "::" ]; then
  HEALTH_HOST="127.0.0.1"
fi

if command -v curl >/dev/null 2>&1; then
  curl --fail --silent --show-error "http://$HEALTH_HOST:$APP_PORT/api/health" >/dev/null
else
  "$NODE_BIN" -e "fetch('http://$HEALTH_HOST:$APP_PORT/api/health').then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
fi

echo "Deployment completed: $RELEASE_DIR"
