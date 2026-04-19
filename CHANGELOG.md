# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial scaffolding.
- Phase 2: library linking scripts (`scripts/link-library.sh`, `scripts/unlink-library.sh`) and workspace probe package (`packages/_probe`).
- Phase 3 follow-up: delete `packages/_probe` (introduced by Phase 2; verifies subpath typings).
- Phase 3 follow-up: replace stub `apps/api/tsconfig.json` and `apps/web/tsconfig.json` with full configuration.
