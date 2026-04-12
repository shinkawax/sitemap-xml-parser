## [1.4.1] - 2026-04-11

### Breaking Changes
- `--format json` now outputs all fields from the source XML (previously only `loc`, `lastmod`, `changefreq`, `priority` were included)

### Added
- `--fields <f1,f2,...>` CLI option to select output columns (requires `--format`). Defaults to `loc,lastmod,changefreq,priority` for TSV and all fields for JSON. Nested values are serialized as JSON strings in TSV output.
- `--list-fields` CLI option to print all field names found across every entry, one per line. Scans the entire sitemap and outputs the union of all keys. Compatible with `--filter` and `--filter-regex`. Cannot be combined with `--format`, `--fields`, `--cap`, or `--count`.
- `SitemapEntry` now typed with `[key: string]: unknown` to reflect that sitemap extension fields (e.g. `image:image`, `news:news`) are passed through as-is from the XML parser.

---

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
