#!/usr/bin/env bash
# يختبر الـ migrations والصلاحيات على Postgres محلي (يحتاج pgvector)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=saey_test
PSQL="psql -v ON_ERROR_STOP=1 -q -U postgres"
$PSQL -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$PSQL -d $DB -f tests/auth_stub.sql
# كل الملفات عدا التخزين (يحتاج Supabase)، مرتين للتأكد أنها آمنة لإعادة التشغيل
for pass in 1 2; do
  for f in migrations/*.sql; do
    case "$f" in *_storage.sql) continue;; esac
    $PSQL -d $DB -f "$f" >/dev/null
  done
  $PSQL -d $DB -f seed.sql >/dev/null
done
$PSQL -d $DB -f tests/rls_test.sql
