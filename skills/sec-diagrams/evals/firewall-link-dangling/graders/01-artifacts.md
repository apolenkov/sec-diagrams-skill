---
type: script
command: node evals/grade.ts firewall-link-dangling "$OUTPUT_DIR" 1
weight: 1
---

Исходные схема и манифест совпадают по байтам с входными. YAML остался прежним до уточнения или изменился в одном поле link, где указан номер существующей связи для событий шлюза.
