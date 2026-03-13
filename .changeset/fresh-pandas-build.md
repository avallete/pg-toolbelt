---
"@supabase/pg-delta": minor
---

Refactor the pg-delta library into explicit `effect`, `node`, and `bun` entrypoints, and rebuild the core database orchestration around the published `@effect/sql-pg@4.0.0-beta.31` client.
