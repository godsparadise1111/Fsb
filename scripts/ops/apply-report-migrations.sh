#!/usr/bin/env sh
set -eu
echo "Compatibility wrapper: the checksum-ledger runner applies the complete ordered SQL migration set, including report migrations 024 and 025."
exec sh scripts/ops/migrate.sh
