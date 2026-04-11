## [1.4.0] - 2026-04-09

### Breaking Changes
- `--tsv` flag removed. Use `--format tsv` and `--format json` instead.

### Added
- `headers` library option to pass custom HTTP headers with every request
- `cap` library option to stop collecting after a given number of entries
- `--format <tsv|json>` CLI option unifying output format selection
- `--cap <n>` CLI option corresponding to `cap`

---

## [1.3.0] - 2026-04-08

### Breaking Changes
- `loc` changed from `string[]` to `string`

### Added
- `--filter-regex` CLI option for regex-based URL filtering
