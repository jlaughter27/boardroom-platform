# Synthetic Obsidian vault (RD-7 fixture)

Invented content for the vault-import regression guard: no real person, company
or note. Used by `scripts/tests/vault-import.test.mjs` (the plan) and
`tests/e2e/live/checks/vault-import.mjs` (import, links, graph, search, prune).
`expected.json` is the hand-written answer key; it is not derived from the
importer. The importer reads only `wiki/` and `.raw/`, so this README and
`expected.json` are never imported.
