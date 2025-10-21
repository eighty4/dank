# Changelog

## [Unreleased]

### Added

- Contents of HTML partials imported within HTML comments using a syntax
  like: `<!-- {{ ./meta_tags.html }} -->` are inserted into webpages
- `dank.config.ts` configures dev services with an HTTP port for proxying
  HTTP requests to backend APIs and services during development

## [v0.0.3] - 2025-10-13

### Added

- `dank serve --log-http` prints HTTP access logs during development

### Fixed

- Bugfix for webpage paths during `dank serve`

## [v0.0.2] - 2025-10-10

### Added

- Delegating to package `mime` for comprehensive file support when developing
  with `dank serve`

## [v0.0.1] - 2025-10-10

### Added

- `dank build` and `dank serve` commands delegate to esbuild for website development
- `dank.config.ts` configures api/web service commands that are started with `dank serve`
  using the `DankConfig['services']` field of `defineConfig`

[Unreleased]: https://github.com/eighty4/dank/compare/v0.0.3...HEAD
[v0.0.3]: https://github.com/eighty4/dank/compare/v0.0.2...v0.0.3
[v0.0.2]: https://github.com/eighty4/dank/compare/v0.0.1...v0.0.2
[v0.0.1]: https://github.com/eighty4/dank/releases/tag/v0.0.1
