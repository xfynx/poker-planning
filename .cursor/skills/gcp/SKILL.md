---
name: gcp
description: >-
  Runs git commit and push for the workspace repository; reminds to bump the VERSION
  file when a release-style bump was not applied yet. Use when the user
  says /gcp, gcp, or clearly asks to commit and push without
  forgetting the version file.
---

# Git commit + push (/gcp)

## When to apply

- User message contains `/gcp`, `gcp`, or an explicit ask to **commit** and **push** together.
- Project uses a `VERSION` file (see repo `README.md`).

## Steps

1. **Status**: `git status` and optionally `git diff --stat` — understand scope before the message.
2. **Message**: короткий императивный commit message по сути правок (на англ. или как принято в репо).
3. **Stage + commit + push**:
   ```bash
   git add -A
   git commit -m "..."
   git push
   ```
4. **VERSION**: если в корне есть `VERSION` и в этом заходе ещё не поднимали патч — увеличь **patch** (например `1.1.0` → `1.1.1`) по правилам из `README` (семвер). Если пользователь сказал не трогать версию — пропусти.

## Не делать

- Пуш без согласия пользователя в чужом репозитории.
- Ломать семвер без согласования (мажор без нужды).
