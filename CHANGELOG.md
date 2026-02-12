# Changelog

## [Unreleased]

### Added

- Builds and CICD verify Linux, MacOS and Windows compat

### Fixed

- Windows paths support

## [v0.0.4] - 2026-02-04

### Added

- Scripts can import Workers with relative paths like `new Worker('./worker.ts')`
  and the URL will be rewritten to the website's output path for `worker.ts`
- Contents of HTML partials imported within HTML comments using a syntax
  like: `<!-- {{ ./meta_tags.html }} -->` are inserted into webpages
- `dank.config.ts` configures dev services with an HTTP port for proxying
  HTTP requests to backend APIs and services during development
- `defineConfig` in `dank.config.ts` can configure HTTP ports for frontend
  dev server and esbuild context with environment variables `DANK_PORT` and
  `ESBUILD_PORT` as overrides
- esbuild.BuildOptions `loaders` and `plugins` can be configured with
  `defineConfig` in `dank.config.ts`
- Page routes configuring HtmlEntrypoints in `dank.config.ts` can use a PageMapping
  with a `pattern: RegExp` to simulate CDN url rewriting when running `dank serve`

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

[Unreleased]: https://github.com/eighty4/dank/compare/v0.0.4...HEAD
[v0.0.4]: https://github.com/eighty4/dank/compare/v0.0.3...v0.0.4
[v0.0.3]: https://github.com/eighty4/dank/compare/v0.0.2...v0.0.3
[v0.0.2]: https://github.com/eighty4/dank/compare/v0.0.1...v0.0.2
[v0.0.1]: https://github.com/eighty4/dank/releases/tag/v0.0.1
