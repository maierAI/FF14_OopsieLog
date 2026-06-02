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
NODE_MAJOR_EXPECTED="${NODE_VERSION%%.*}"

load_node_runtime() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
    if [ "$NODE_MAJOR" = "$NODE_MAJOR_EXPECTED" ]; then
      NODE_BIN="$(command -v node)"
      return 0
    fi
  fi

  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh"
    if nvm use "$NODE_VERSION" >/dev/null 2>&1; then
      NODE_BIN="$(command -v node)"
      return 0
    fi
  fi

  if [ -x "$SHARED_DIR/node/bin/node" ] && [ -x "$SHARED_DIR/node/bin/npm" ]; then
    export PATH="$SHARED_DIR/node/bin:$PATH"
    NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
    if [ "$NODE_MAJOR" = "$NODE_MAJOR_EXPECTED" ]; then
      NODE_BIN="$(command -v node)"
      return 0
    fi
  fi

  return 1
}

install_node_runtime() {
  case "$(uname -m)" in
    x86_64 | amd64)
      NODE_PLATFORM="x64"
      ;;
    aarch64 | arm64)
      NODE_PLATFORM="arm64"
      ;;
    *)
      echo "Unsupported CPU architecture for Node.js binary install: $(uname -m)" >&2
      exit 1
      ;;
  esac

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to install a local Node.js runtime." >&2
    exit 1
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "python3 is required to resolve the latest Node.js ${NODE_MAJOR_EXPECTED} release." >&2
    exit 1
  fi

  mkdir -p "$RELEASES_DIR" "$SHARED_DIR" "$LOG_DIR" "$DATA_DIR"
  NODE_DIST_VERSION="$(python3 - "$NODE_MAJOR_EXPECTED" "$NODE_PLATFORM" <<'PY'
import json
import sys
import urllib.request

major = sys.argv[1]
platform = sys.argv[2]
file_id = f"linux-{platform}"

with urllib.request.urlopen("https://nodejs.org/dist/index.json", timeout=30) as response:
    releases = json.load(response)

for release in releases:
    version = release.get("version", "")
    if version.startswith(f"v{major}.") and file_id in release.get("files", []):
        print(version)
        break
else:
    raise SystemExit(f"Unable to find a Node.js {major} release for {file_id}.")
PY
)"

  NODE_URL="https://nodejs.org/dist/$NODE_DIST_VERSION/node-$NODE_DIST_VERSION-linux-$NODE_PLATFORM.tar.xz"
  NODE_TMP_DIR="$(mktemp -d)"
  NODE_INSTALL_DIR="$SHARED_DIR/node-$NODE_DIST_VERSION"
  trap 'rm -rf "$NODE_TMP_DIR"' RETURN

  curl -fsSL "$NODE_URL" -o "$NODE_TMP_DIR/node.tar.xz"
  tar -xJf "$NODE_TMP_DIR/node.tar.xz" -C "$NODE_TMP_DIR"
  rm -rf "$NODE_INSTALL_DIR"
  mv "$NODE_TMP_DIR/node-$NODE_DIST_VERSION-linux-$NODE_PLATFORM" "$NODE_INSTALL_DIR"
  ln -sfn "$NODE_INSTALL_DIR" "$SHARED_DIR/node"
  export PATH="$SHARED_DIR/node/bin:$PATH"
  NODE_BIN="$(command -v node)"
}

mkdir -p "$RELEASES_DIR" "$SHARED_DIR" "$LOG_DIR" "$DATA_DIR"
if ! load_node_runtime; then
  install_node_runtime
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" != "$NODE_MAJOR_EXPECTED" ]; then
  echo "Expected Node major $NODE_MAJOR_EXPECTED, but found $(node -v)." >&2
  exit 1
fi

rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"

cd "$RELEASE_DIR"

# Build native addons against the target host to avoid glibc mismatches
# from prebuilt binaries downloaded on newer CI environments.
npm_config_build_from_source=true npm ci --omit=dev

cat > "$ENV_FILE" <<EOF
HOST=$APP_HOST
PORT=$APP_PORT
DB_PATH=$DB_PATH
NODE_ENV=production
EOF

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

health_check() {
  if command -v curl >/dev/null 2>&1; then
    curl --fail --silent --show-error "http://$HEALTH_HOST:$APP_PORT/api/health" >/dev/null
  else
    "$NODE_BIN" -e "fetch('http://$HEALTH_HOST:$APP_PORT/api/health').then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
  fi
}

HEALTH_TIMEOUT_SECONDS=30
HEALTH_ATTEMPT_INTERVAL=2
HEALTH_DEADLINE=$((SECONDS + HEALTH_TIMEOUT_SECONDS))

until health_check; do
  if [ "$SECONDS" -ge "$HEALTH_DEADLINE" ]; then
    echo "Health check failed for http://$HEALTH_HOST:$APP_PORT/api/health after ${HEALTH_TIMEOUT_SECONDS}s" >&2
    systemctl --no-pager --full status "$SERVICE_NAME" | sed -n '1,40p' >&2 || true
    if [ -f "$LOG_DIR/app-error.log" ]; then
      echo "--- app-error.log ---" >&2
      tail -n 80 "$LOG_DIR/app-error.log" >&2 || true
    fi
    if [ -f "$LOG_DIR/app.log" ]; then
      echo "--- app.log ---" >&2
      tail -n 40 "$LOG_DIR/app.log" >&2 || true
    fi
    exit 1
  fi
  sleep "$HEALTH_ATTEMPT_INTERVAL"
done

echo "Deployment completed: $RELEASE_DIR"
