#!/bin/sh
# Backup diário (cron da VPS):  0 3 * * * /caminho/finances/backup.sh >> /var/log/razao-backup.log 2>&1
# Para o app por alguns segundos (cópia consistente do SQLite), arquiva o volume e sobe de novo.
# Mantém 30 dias em ./backups. Copie essa pasta para fora da VPS de vez em quando.
set -e
cd "$(dirname "$0")"
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M)
VOLUME=$(docker compose config --volumes >/dev/null && docker volume ls -q | grep 'razao-data$' | head -1)
docker compose stop app
docker run --rm -v "$VOLUME":/data:ro -v "$PWD/backups":/out alpine tar czf "/out/razao-$STAMP.tar.gz" -C /data .
docker compose start app
find backups -name 'razao-*.tar.gz' -mtime +30 -delete
echo "ok: backups/razao-$STAMP.tar.gz"
