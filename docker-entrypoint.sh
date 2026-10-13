#!/bin/sh
set -e
# миграции применяются при каждом запуске (повторно — безопасно)
node dist-scripts/migrate.mjs
if [ "$RUN_SEED" = "true" ]; then node dist-scripts/seed.mjs; fi
exec node server.js
