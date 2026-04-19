# Git Workflow

Conventional Commits, short-lived branches, review-gated merges. Agents **never** commit or push — the user does.

- **Conventional Commits** config: `commitlint.config.mjs`
- **Branch protection**: `main` is reviewed; no direct push.
- **Repo host**: GitHub (`bymaxone/nest-auth-example`).

---

## When to read this

Before opening or closing a piece of work, naming a branch, writing a commit message, preparing a PR.

---

## The golden rule for AI agents

**Never run `git commit` or `git push`.** Prepare the commands, output them for the user, and wait for explicit approval before any state change. The user reviews each change and commits manually.

If an agent is asked to "commit" or "push" directly:

1. Confirm the user explicitly authorized it (not just implied).
2. Still prefer to surface the intended command for one-shot approval.
3. Never bypass hooks (`--no-verify`, `--no-gpg-sign`) unless the user has said so in durable instructions.

This is the single most load-bearing rule in this doc. Do not relax.

---

## Branch naming

```
<type>/<short-slug>
```

Types mirror commit types:

- `feat/…` — new feature (`feat/mfa-recovery-codes-modal`)
- `fix/…` — bug fix (`fix/login-double-submit`)
- `refactor/…`, `docs/…`, `chore/…`, `test/…`, `perf/…`, `ci/…`

Rules:

- Lower-case, kebab-case slug.
- Include the scope when it matters (`feat/web/invite-form`, `fix/api/rate-limit-header`).
- No personal prefixes (`max/…`) — anyone should be able to pick up the branch.
- Under ~60 chars total.

---

## Commits

Conventional Commits format:

```
<type>(<scope>): <subject>

<optional body>

<optional footer>
```

- `type`: `feat` | `fix` | `docs` | `chore` | `refactor` | `test` | `perf` | `ci` | `build`.
- `scope`: workspace or area — `api`, `web`, `infra`, `docs`, `deps`, `release`, `auth`, `prisma`, `redis`, ….
- `subject`: lower-case, imperative mood, no trailing period, ≤ 72 chars.
- `body`: wrap at 100; explain **why**. Link issues (`Refs #123`, `Closes #123`).
- `footer`: `BREAKING CHANGE: …` when relevant; `Co-Authored-By: …` for pairing.

Examples:

```
feat(web): add MFA recovery codes modal

Surfaces the library's recovery codes exactly once, gated behind the
confirmation step. Adds a print-friendly layout and copy-to-clipboard.

Closes #42
```

```
fix(api): restore X-Request-Id propagation on 4xx responses

The exception filter swallowed the header; re-inject it before returning.
Regression introduced in #31.
```

**Rules**:

- **Small commits**, one idea each. Ten files change because a refactor renamed something → one commit. Ten features → ten commits (or PRs).
- **Never commit generated files** unless the repo explicitly includes them (`prisma/migrations`, shadcn-copied components).
- **Never commit secrets.** `.env`, private keys, credentials. `.gitignore` + human review both enforce.
- **Amending** is fine on an unpublished branch; avoid once pushed. Create a follow-up commit instead.
- **Never skip hooks** with `--no-verify`. Fix the hook failure.

---

## Pull requests

### Opening

- Title mirrors the top commit subject (`feat(web): add MFA recovery codes modal`).
- Description uses the template:

```markdown
## Summary

- Bullet 1
- Bullet 2

## Test plan

- [ ] Ran `pnpm lint && pnpm typecheck && pnpm test`
- [ ] Exercised the happy path in the browser
- [ ] Verified the regression case in docs/FEATURES.md §N

## Screenshots / recordings

<attach>

## Risks & follow-ups

- …
```

### Size

- **Target**: < 400 lines of diff, under 8 files.
- **If larger**: split. Chain PRs with `Depends on #N` in the description when the split cannot be independent.
- **Reference PRs** (a whole feature demonstrated end to end) may exceed the limit; justify in the description.

### CI

- Must go green before review is requested. Don't burn reviewer time on a red branch.
- Re-run flaky jobs **once**. If it flakes twice, investigate — do not merge on a flake.

### Reviews

See [pr-review.md](pr-review.md) for reviewer expectations.

### Merging

- **Squash and merge** is the default — keeps `main` linear and each PR one commit.
- Preserve the Conventional Commits subject on the squash.
- Rebase before merge if `main` has moved; do not use the "merge commit" button.

---

## Hotfixes

- Branch from `main` with `fix/<short-slug>`.
- Minimum diff; no opportunistic refactors.
- Two approvals encouraged for auth-path fixes.
- Tag `v<x.y.z>` after merge if the project is publishing releases.

---

## Reverts

- Use `git revert <sha>` — never force-push over the commit.
- Revert commit keeps the Conventional Commits format: `revert: <original subject>`.
- Document the incident in the revert PR body; link follow-up issue.

---

## Tags & releases

Not wired yet. When releases start:

- Semver tags `v1.0.0`, `v1.1.0`, …
- `docs/RELEASES.md` notes the `@bymax-one/nest-auth` version pinned.
- GitHub Release body mirrors CHANGELOG entry.

---

## Force-push rules

- **Never force-push `main` or any shared branch.**
- Force-push on a **personal, not-yet-reviewed** branch is fine (`git push --force-with-lease`).
- `--force-with-lease` always — never `--force`. Prevents overwriting a teammate's push you didn't know about.

---

## Secrets and large files

- **Never add `.env`, credentials, private keys.** Pre-commit should block; human also blocks.
- **Large binary assets** (`> 1 MB` image, recordings) — discuss before committing. Consider an external host or Git LFS.
- If a secret slipped in: `git filter-repo` / BFG, **then rotate the secret**. Removing it from history is not sufficient.

---

## Agent behaviour summary

| Action                         | Allowed for agent?                                     |
| ------------------------------ | ------------------------------------------------------ |
| Propose a commit message       | ✅                                                     |
| Run `git status` / `git diff`  | ✅                                                     |
| Run `git log`, `git show`      | ✅                                                     |
| Run `git add`                  | Only when the user has authorized for the current task |
| Run `git commit`               | ❌ (user does this)                                    |
| Run `git push`                 | ❌ (user does this)                                    |
| Run `git reset --hard`         | ❌ without explicit OK                                 |
| Run `git rebase -i`            | ❌ — requires interactive input                        |
| `--no-verify`, `--no-gpg-sign` | ❌ unless explicit user request                        |

---

## Common pitfalls

1. **Merging your own PR** — review gate exists for a reason.
2. **Force-pushing a shared branch** to "clean up commits" — destroys reviewers' anchors.
3. **Amending a pushed commit** — bypasses review, breaks others' local branches.
4. **Long-lived feature branches** — merge hell. Rebase daily or split the work.
5. **Committing generated files** — Prisma client, `.next/`, `dist/`.
6. **`feat: wip`** commits landing on `main` — squash merge should catch, but don't let them through in the first place.
7. **Agent running `git commit` automatically** — top of this doc; re-read.

---

## References

- Conventional Commits: https://www.conventionalcommits.org
- `commitlint.config.mjs` in this repo
- GitHub flow: https://docs.github.com/get-started/using-github/github-flow
- [pr-review.md](pr-review.md)
- [agent-handoff.md](agent-handoff.md)
