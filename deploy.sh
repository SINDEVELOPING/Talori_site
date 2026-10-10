#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo ".env not found"
  exit 1
fi

DB_PASS=$(grep -E '^DB_PASS=' .env | head -1 | cut -d= -f2-)

MYSQL_PWD="$DB_PASS" mysql -u root <<'SQL'
CREATE DATABASE IF NOT EXISTS modbot   CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS eco      CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS economy  CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS clans    CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS giveaway CHARACTER SET utf8mb4;
CREATE DATABASE IF NOT EXISTS apps     CHARACTER SET utf8mb4;
SQL

npm install --no-audit --no-fund

command -v pm2 >/dev/null 2>&1 || npm install -g pm2
pm2 delete talori >/dev/null 2>&1 || true
pm2 start ecosystem.config.js
pm2 save
