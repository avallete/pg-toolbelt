---
"@supabase/pg-topo": minor
---

Add a `WorkingDirectory` Effect service for file-based analysis so the filesystem adapter no longer reads ambient cwd throughout the codepath.

Effect consumers of `analyzeAndSortFromFilesEffect` can now inject cwd explicitly with `makeWorkingDirectoryLayer`, making relative-root resolution deterministic in tests and other non-default runtimes.
