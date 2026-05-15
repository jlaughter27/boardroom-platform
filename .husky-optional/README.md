# Optional Husky + lint-staged pre-commit hook

This directory ships a **template** pre-commit hook that runs ESLint
(via lint-staged) on the files you staged. It is **not** active by
default — Wave 3 Track G deliberately leaves this opt-in.

## Why opt-in?

Two reasons:

1. **Friction.** Pre-commit hooks slow `git commit` by 200–2000 ms even on
   tiny changes, and they fire on every commit including WIP / "save my
   work" pushes. Some teammates hate that; others love it. We don't want
   to litigate it via this PR.
2. **CI already catches the bug.** The `lint` job in `.github/workflows/
   ci.yml` plus the `grep` gate already block PRs that contain a bad
   class string. The pre-commit hook is a UX accelerator (catch-it-on-
   the-laptop), not a correctness gate.

## How to opt in (one-time, per-clone)

```bash
# 1. Install husky + lint-staged (only the dev who wants the hook needs
#    these; CI doesn't run husky)
pnpm add -Dw husky lint-staged

# 2. Move the template into the real .husky/ dir Husky uses
mkdir -p .husky
cp .husky-optional/pre-commit .husky/pre-commit
chmod +x .husky/pre-commit

# 3. Initialize Husky (installs the .git/hooks/pre-commit shim)
pnpm exec husky install

# 4. Tell git to look at .husky/_
git config core.hooksPath .husky

# 5. Add this to package.json (under the top-level keys)
#    "lint-staged": {
#      "packages/boardroom-ai/client/src/**/*.{ts,tsx}": [
#        "eslint --max-warnings=0"
#      ],
#      "packages/boardroom-ai/server/src/**/*.ts": [
#        "eslint --max-warnings=0"
#      ]
#    }
```

## How to opt out (after opting in)

```bash
git config --unset core.hooksPath
rm -rf .husky
# (and remove "lint-staged" / husky from package.json if you want)
```

## Tradeoffs documented

| Pro | Con |
|-----|-----|
| Catches the Wave-2 class-string typo before push (saves a CI roundtrip) | Adds 0.2–2 s to every commit |
| Stops `git commit --amend` typo churn | Can't commit a deliberately broken WIP without `--no-verify` |
| Free once installed | One extra setup step per clone |
