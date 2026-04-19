# Agent Handoff Guidelines

How to pass work between AI agents — or from an agent to a human — without losing intent, constraints, or context.

- **Audience**: Claude Code, Codex, Cursor, and any SDK-based sub-agents this repo uses.
- **Companion docs**: [CLAUDE.md](../../CLAUDE.md), [AGENTS.md](../../AGENTS.md), [pr-review.md](pr-review.md).

---

## When to read this

Before **dispatching** a task to another agent (sub-agent, background task, multi-turn handoff) or **receiving** one. Keep open for the whole handoff; close once the receiving agent has confirmed completion.

---

## The handoff contract

Every handoff carries, at minimum:

1. **Goal** — one sentence, outcome-oriented.
2. **Scope** — what's in, what's explicitly out.
3. **Constraints** — non-negotiables from this repo (typing, layering, guidelines).
4. **Context pointers** — files, docs, guidelines the receiver should load.
5. **Acceptance criteria** — how to know the task is done.
6. **Return channel** — what artifact the receiver produces and where.

Missing any of the six is a handoff that will fail silently.

---

## Template

```markdown
# Task: <short imperative subject>

## Goal

<One sentence. What outcome do we want?>

## Scope

- In: <bullet list>
- Out: <bullet list — what NOT to touch>

## Constraints

- TypeScript strict, zero `any`, zero suppressions.
- Follow `docs/guidelines/<relevant>-guidelines.md`.
- Do not `git commit` or `git push`; leave the diff staged or unstaged.
- <Any other task-specific rule>

## Context to load

- `docs/OVERVIEW.md` §<N> for feature framing
- `docs/guidelines/<X>-guidelines.md`
- `apps/<api|web>/src/<path/to/file>.ts`

## Deliverable

- Files touched: <list>
- Tests added: <list>
- Short write-up of what changed + why, ≤ 200 words.

## Acceptance

- [ ] `pnpm lint && pnpm typecheck && pnpm test` all pass.
- [ ] <Feature works end-to-end in browser / curl>.
- [ ] <No regression in <related flow>>.

## Return

- Summarize on completion in this thread.
- If blocked, surface the blocker instead of improvising.
```

Use this template **as-is**. Skipping sections invites drift.

---

## Rules for the sending agent

1. **Write the prompt like a brief for a smart colleague** who just walked in. State the goal, the constraints, what you've already ruled out, and the specific files to touch.
2. **Load only the minimum context** the receiver needs. Pointers beat paste-ins — receiver should open the guideline themselves.
3. **Name the receiver's tools explicitly** when the task maps to a specialized agent (code-reviewer, security-reviewer, database-reviewer, typescript-reviewer). See [CLAUDE.md](../../CLAUDE.md) for the project's preferred agents.
4. **Request a concise return** ("report in under 200 words") — raw tool output pollutes context.
5. **Never delegate understanding**. "Based on your findings, implement the fix" pushes synthesis onto the receiver. Write prompts that prove you already understood: file paths, line numbers, the specific change.
6. **Parallelize when independent.** Two agents running the same search waste effort; two agents tackling unrelated checks halve wall time.

---

## Rules for the receiving agent

1. **Re-state the goal** in your first action. If the goal isn't clear, ask before coding.
2. **Read the linked guidelines** before editing anything they govern. Loading the whole `docs/guidelines/` tree is forbidden; load on demand.
3. **Respect scope.** Do not "while you're at it" your way into unrelated refactors.
4. **Surface blockers early.** If a constraint contradicts the task, stop and report — do not silently relax the constraint.
5. **Do not commit or push.** Prepare the change; let the user review and commit.
6. **Close the loop** — produce the requested artifact, in the requested shape, in the requested channel. Summaries describe what happened, not what you _meant_ to do.

---

## Project-specific invariants

Non-negotiable regardless of task:

- No `any`, `@ts-ignore`, `eslint-disable`.
- No hex colors outside `@theme` in `apps/web/app/globals.css`.
- No cross-feature imports.
- No logging of secrets, tokens, OTPs, or `passwordHash`.
- No direct `process.env.*` reads — always through `ConfigService` (api) or `env` (web).
- No `git commit` / `git push` by any agent.
- No `--no-verify` or hook bypasses.
- Every new exported symbol has JSDoc; every new non-trivial file has a header; every new `it` has a scenario comment.

If the task seems to require breaking one of these, the correct move is **stop + ask**.

---

## Handoff patterns we use

### Research → Implement

- Sender runs an Explore agent to find context, then launches an implement agent with the findings.
- Sender produces the _synthesis_; implement agent executes.

### Implement → Review

- Implement agent finishes and writes a short report.
- Sender launches `code-reviewer` (and `security-reviewer` / `typescript-reviewer` as relevant) on the diff.
- Findings applied by the implement agent or the sender.

### Task stalls

- Receiver surfaces the blocker with: current state, what was tried, what guideline says, the specific ambiguity.
- Sender decides: relax scope, change approach, fetch more context, or defer.

### Breakage during a task

- Receiver stops at the first broken guideline. No cascading workarounds.
- Reports: "Blocked — applying X would require breaking Y in `docs/guidelines/Z-guidelines.md`. Options: …"

---

## Common pitfalls

1. **Wall-of-text prompts that dump files** — the receiver drowns in context. Pointers + summaries instead.
2. **Vague goals** — "clean up auth" has no done criterion. Always produce a scoped outcome.
3. **Skipping the "out of scope" list** — receiver invents opportunistic changes.
4. **No acceptance criteria** — the receiver stops when it feels done; reviewer disagrees.
5. **Passing raw diffs as state** — diffs drift once another commit lands. Reference files + sha where possible.
6. **Agent chaining without a human checkpoint** — three agents later, the goal has mutated. Fewer hops or explicit reconciliation at the end.
7. **Letting the receiver commit** — see [git-workflow.md](git-workflow.md). Never.

---

## References

- [CLAUDE.md](../../CLAUDE.md) — quick rules + task → guideline map
- [AGENTS.md](../../AGENTS.md) — full spec for AI agents
- [pr-review.md](pr-review.md)
- [git-workflow.md](git-workflow.md)
- Claude Code agent prompt guidance: https://docs.claude.com/en/docs/claude-code
