#!/bin/sh
set -eu
exec sh "$(dirname "$0")/../skills/sec-diagrams/scripts/install.sh" "$@"
