#!/usr/bin/env bash
set -euo pipefail

fixtures=$(cd -- "$(dirname -- "$0")/files" && pwd)
cp "$fixtures"/{manifest.json,poc.yaml,l1.drawio,l3-1.drawio,'Карта сетевой фильтрации.drawio','записка.txt'} .
