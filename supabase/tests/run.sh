#!/usr/bin/env bash
# يختبر الـ migrations والصلاحيات على Postgres محلي (يحتاج pgvector)
set -euo pipefail
cd "$(dirname "$0")/.."
DB=saey_test
PSQL="psql -v ON_ERROR_STOP=1 -q -U postgres"
$PSQL -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$PSQL -d $DB -f tests/auth_stub.sql
for f in migrations/*_core.sql migrations/*_logic.sql migrations/*_rls.sql; do $PSQL -d $DB -f "$f"; done
$PSQL -d $DB -f seed.sql >/dev/null
$PSQL -d $DB -f tests/rls_test.sql
