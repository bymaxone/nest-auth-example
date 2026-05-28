# Releases

Which version of `@bymax-one/nest-auth` each tag of this example tracks. This example does **not** maintain backwards compatibility across library majors — each major gets its own long-lived branch (see [versioning policy](#branch-per-major-policy)).

---

## How to read this table

- **Example tag** — a git tag on this repository (`vX.Y.Z`).
- **Library version** — the exact `@bymax-one/nest-auth` version that tag was built and tested against.
- **Date** — when the tag was cut.
- **Notes** — one-line summary; deeper detail in [`CHANGELOG.md`](../CHANGELOG.md).
- **Upgrade** — link to the per-version upgrade notes.

| Example tag | Library version              | Date       | Notes                 | Upgrade                      |
| ----------- | ---------------------------- | ---------- | --------------------- | ---------------------------- |
| `v1.0.0`    | `@bymax-one/nest-auth@1.0.0` | 2026-05-28 | Initial reference app | [CHANGELOG](../CHANGELOG.md) |

---

## How entries are added

- **Automatically (preferred).** The release workflow added in Phase 19 (`.github/workflows/release.yml`) triggers on a `v*` tag, builds the production images, and appends a new row to this file via a bot commit. This keeps the table authoritative without manual edits.
- **Manually.** Until that workflow lands, add a row by hand when tagging: copy the most recent row, bump the example tag and library version, set the date, and link the matching `CHANGELOG.md` section.

---

## Branch-per-major policy

Mirrors [OVERVIEW §15](./OVERVIEW.md#15-versioning--release-tracking):

| Branch | Tracks library version | Notes                                 |
| ------ | ---------------------- | ------------------------------------- |
| `main` | `^1.0.0`               | Current stable.                       |
| `next` | `^2.0.0` (when out)    | Pre-release; expect breaking changes. |

When `@bymax-one/nest-auth` ships a new major, a new branch is created from `main`, the dependency is bumped, and breaking-change notes are recorded in `CHANGELOG.md`. The `main` branch keeps tracking the current major until the next is stable.

---

## Further reading

- [`CHANGELOG.md`](../CHANGELOG.md) — full change history with per-version detail.
- [Deployment](./DEPLOYMENT.md) — what to verify on each release.
- [`@bymax-one/nest-auth`](https://github.com/bymax-one/nest-auth) — the library this example tracks.
