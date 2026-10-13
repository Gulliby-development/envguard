<p align="center"><img src="docs/logo.svg" width="96" alt="" /></p>

# envguard

A TypeScript CLI for developers and CI pipelines that compares `.env` with `.env.example` and reports missing keys, extra keys and empty values, without printing any values.

[![CI](https://github.com/Gulliby-development/envguard/actions/workflows/ci.yml/badge.svg)](https://github.com/Gulliby-development/envguard/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Why

You reach for envguard when a new teammate's `.env` is missing a variable, or a
deploy fails because one is empty. It checks the file against the committed
`.env.example` in a second and never prints a secret value.

## Who it is for

Developers and teams that use a committed `.env.example` to document required
environment variables. Run it locally or in CI to catch configuration gaps
before starting the application.

## Install

From a checkout, install the development dependencies with Bun:

```sh
bun install
bun run src/cli.ts --help
```

To build the JavaScript CLI for Node.js:

```sh
bun run build
node dist/cli.js --help
```

Bun is needed to build from source; the built file runs with Node.js and has no
third-party runtime dependencies. Use a current Node.js LTS release.

For an optional local command on your PATH, run these commands from the built
checkout with npm installed:

```sh
npm link
envguard --help
```

This links the local checkout; it does not require an npm-published package.
Use `npm unlink --global envguard` to remove the link.

## Usage

By default, envguard reads `.env` and `.env.example` in the current working
directory:

```sh
bun run src/cli.ts
node dist/cli.js
```

All examples below use the built Node.js entry point. The same options work with
`bun run src/cli.ts` or the locally linked `envguard` command.

Treat extra keys as errors instead of warnings:

```sh
node dist/cli.js --strict
```

Print one JSON document for scripts or CI:

```sh
node dist/cli.js --json
node dist/cli.js --strict --json
```

Use custom files (quote paths containing spaces):

```sh
node dist/cli.js --env "config/local.env" --example "config/template.env"
```

Relative paths are resolved from the current working directory.

| Option | Purpose |
| --- | --- |
| `--env <path>` | Environment file; defaults to `.env` |
| `--example <path>` | Template file; defaults to `.env.example` |
| `--strict` | Fail on extra keys as well as missing or empty keys |
| `--json` | Print JSON instead of the human-readable report |
| `--github` | Print GitHub Actions annotations instead of the human-readable report; cannot be combined with `--json` |
| `--help`, `-h` | Show usage and exit successfully |
| `--version`, `-v` | Show the package version and exit successfully |
| `--allow-empty <KEY>` | Keys that may be empty; repeatable or comma-separated; `PREFIX*` matches by prefix |
| `--ignore-extra <KEY>` | Extra keys to leave out of the report; repeatable or comma-separated; `PREFIX*` matches by prefix |

Positional file arguments are not supported; use `--env` and `--example`.

### What is checked

- **Missing:** a key in `.env.example` that is absent from `.env`.
- **Extra:** a key in `.env` that is absent from `.env.example`.
- **Empty:** a key shared by both files whose `.env` value is empty or
  whitespace-only after unquoting. Template values are not checked for emptiness.

For intentionally blank variables, allow selected keys to be empty. With
this `.env.example`:

```text
A=
SENTRY_DSN=
```

and this `.env`:

```text
A=1
SENTRY_DSN=
```

running `envguard` prints:

```text
Environment problems found.
Empty values (errors): SENTRY_DSN
```

It exits 1. Running `envguard --allow-empty SENTRY_DSN` with the same files
prints:

```text
Success: required environment keys are present and non-empty.
```

and exits 0.

To silence known extra keys such as CI variables or a time zone, use
`--ignore-extra`. With this `.env.example`:

```text
A=
```

and this `.env`:

```text
A=1
CI=true
CI_JOB_ID=42
TZ=UTC
```

running `envguard` prints:

```text
Success: required environment keys are present and non-empty.
Extra keys (warnings): CI, CI_JOB_ID, TZ
```

It exits 0. With `--strict` the same extra keys are errors:

```text
Environment problems found.
Extra keys (errors): CI, CI_JOB_ID, TZ
```

It exits 1. Running `envguard --strict --ignore-extra "CI*,TZ"` prints:

```text
Success: required environment keys are present and non-empty.
```

and exits 0.

Key lists are sorted alphabetically. Extra keys are warnings by default and
errors with `--strict`. Human-readable output contains no ANSI colour codes and
includes a success line when the check passes.

For example, with `A=1`, `C=` and `D=4` in `.env`, and keys `A`, `B` and
`C` in `.env.example`, `--json` produces:

```json
{"ok":false,"strict":false,"env":"/home/alice/project/.env","example":"/home/alice/project/.env.example","missing":["B"],"extra":["D"],"empty":["C"]}
```

The `env` and `example` fields hold the absolute resolved paths of the files
that were read, so they differ per machine (on Windows they are like
`C:\Users\alice\project\.env`). The paths above are illustrative. Take that
into account if you upload the JSON output as a CI log or artifact.

The same files give this human-readable report (exit code 1):

```text
Environment problems found.
Missing keys (errors): B
Empty values (errors): C
Extra keys (warnings): D
```

When everything is fine, envguard prints
`Success: required environment keys are present and non-empty.` and exits 0.

### GitHub Actions annotations

In a GitHub Actions job, `--github` makes each problem an annotation on the run and pull request. For example, with this `.env.example`:

```text
A=
B=
C=
```

and this `.env`:

```text
A=1
C=
CI=true
```

`envguard --github` prints (exit 1):

```text
::error file=.env,title=envguard::Missing key B (required by .env.example)
::error file=.env,title=envguard::Empty value for key C
::warning file=.env,title=envguard::Extra key CI (not in .env.example)
```

Missing and empty keys are errors; extra keys are warnings, or errors with `--strict`. Annotation paths are exactly the paths given on the command line. Nothing is printed when there is nothing to report. `--json` and `--github` cannot be combined (exit 2).

### Exit codes

| Code | Meaning |
| --- | --- |
| 0 | No problems; extra-key warnings are allowed unless strict mode is enabled |
| 1 | Missing or empty required values, or extra keys in strict mode |
| 2 | Usage or file IO error |

Unknown options, missing option values, positional arguments and unreadable
files produce a message on stderr and no stdout, including with `--json` and `--github`.

### Parsing and limits

The parser supports LF and CRLF, a leading UTF-8 BOM, `export KEY=value`,
whitespace around assignments, single- and double-quoted values, blank lines,
full-line comments and whitespace-separated inline comments on unquoted values.
Keys match `[A-Za-z_][A-Za-z0-9_.]*`; duplicate keys use the last value.
Unrecognized lines are ignored.

Variable interpolation, command substitution, multi-line quoted values, file
cascades and value-type validation are not supported. envguard never fixes or
writes environment files.

## Development

Install dependencies with `bun install`, then run:

```sh
bun test
bun run typecheck
bun run lint
bun run build
```

Tests cover parsing, comparison, formatting, CLI behaviour and project
documentation. The build writes `dist/cli.js` with a Node.js shebang. Source,
scripts and tests are intended for Windows, macOS and Linux.

## License

MIT, see [LICENSE](LICENSE).

---

Built with BAKED, an open-source coding agent (bench loop round 02, BAKED ac45a9c).
