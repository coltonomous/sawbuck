#!/bin/sh
# Postgres → S3 backup loop.
# Runs pg_dump on an interval, uploads gzipped dumps to S3, and prunes old ones.
# Intended to run as a sidecar container (see docker-compose.yml `backup` service).
set -eu

if [ -z "${BACKUP_S3_BUCKET:-}" ]; then
  echo "BACKUP_S3_BUCKET not set — backups disabled. Exiting." >&2
  exit 0
fi

INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
S3_PREFIX="${BACKUP_S3_PREFIX:-sawbuck/db}"
PGHOST="${PGHOST:-postgres}"
PGUSER="${PGUSER:-postgres}"
PGDATABASE="${PGDATABASE:-sawbuck}"
export PGPASSWORD="${POSTGRES_PASSWORD:-}"

SLEEP_SECONDS=$((INTERVAL_HOURS * 3600))

# aws-cli is installed once on container startup; pg_dump ships with the base image.
if ! command -v aws >/dev/null 2>&1; then
  echo "Installing aws-cli..."
  apk add --no-cache aws-cli >/dev/null
fi

while true; do
  TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
  FILE="/tmp/sawbuck-${TS}.sql.gz"
  S3_KEY="s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/sawbuck-${TS}.sql.gz"

  echo "[$(date -u +%FT%TZ)] starting backup → ${S3_KEY}"
  if pg_dump -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" --no-owner --no-privileges \
       | gzip -c > "${FILE}"; then
    if aws s3 cp "${FILE}" "${S3_KEY}" --only-show-errors; then
      echo "[$(date -u +%FT%TZ)] uploaded $(stat -c %s "${FILE}" 2>/dev/null || wc -c <"${FILE}") bytes"
    else
      echo "[$(date -u +%FT%TZ)] upload failed" >&2
    fi
  else
    echo "[$(date -u +%FT%TZ)] pg_dump failed" >&2
  fi
  rm -f "${FILE}"

  # Prune anything older than RETENTION_DAYS. S3 `ls` is flat within the prefix.
  CUTOFF_EPOCH=$(( $(date -u +%s) - RETENTION_DAYS * 86400 ))
  aws s3 ls "s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/" 2>/dev/null \
    | awk '{print $1" "$2" "$4}' \
    | while read -r d t key; do
        [ -z "${key}" ] && continue
        ts_epoch=$(date -u -d "${d} ${t}" +%s 2>/dev/null || echo 0)
        if [ "${ts_epoch}" -gt 0 ] && [ "${ts_epoch}" -lt "${CUTOFF_EPOCH}" ]; then
          echo "[$(date -u +%FT%TZ)] pruning old backup ${key}"
          aws s3 rm "s3://${BACKUP_S3_BUCKET}/${S3_PREFIX}/${key}" --only-show-errors || true
        fi
      done

  echo "[$(date -u +%FT%TZ)] sleeping ${INTERVAL_HOURS}h"
  sleep "${SLEEP_SECONDS}"
done
