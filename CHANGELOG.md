# Changelog

## [Unreleased]

- ???

## [v0.0.2] - 2025-10-10

### Added

- Delegating to package `mime` for comprehensive file support when developing
  with `dank serve`

## [v0.0.1] - 2025-10-10

### Added

- `dank build` and `dank serve` commands delegate to esbuild for website development
- `dank.config.ts` configures api/web service commands that are started with `dank serve`
  using the `DankConfig['services']` field of `defineConfig`

[Unreleased]: https://github.com/eighty4/dank/compare/v0.0.2...HEAD
[v0.0.2]: https://github.com/eighty4/dank/compare/v0.0.1...v0.0.2
[v0.0.1]: https://github.com/eighty4/dank/releases/tag/v0.0.1
