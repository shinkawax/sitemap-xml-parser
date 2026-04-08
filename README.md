# sitemap-xml-parser

Parses sitemap XML files and returns all listed URLs. Supports sitemap index files and gzip (.gz) compression.

## Installation

```
npm install sitemap-xml-parser
```

## CLI

Run without installing via `npx`:

```sh
npx sitemap-xml-parser <url> [options]
```

Or, after installing globally (`npm install -g sitemap-xml-parser`):

```sh
sitemap-xml-parser <url> [options]
```

Fetched URLs are printed to stdout, one per line. Errors are printed to stderr. See [Options](#options) for available flags.

## Examples

```sh
# Print all URLs
npx sitemap-xml-parser https://example.com/sitemap.xml

# Count URLs
npx sitemap-xml-parser https://example.com/sitemap.xml --count

# Filter by substring
npx sitemap-xml-parser https://example.com/sitemap.xml --filter "blog"

# Filter by regular expression
npx sitemap-xml-parser https://example.com/sitemap.xml --filter-regex "blog/[0-9]{4}/"

# Filter and count
npx sitemap-xml-parser https://example.com/sitemap.xml --filter "blog" --count

# Output as TSV
npx sitemap-xml-parser https://example.com/sitemap.xml --tsv > urls.tsv

# Save URLs to a file, errors to a log
npx sitemap-xml-parser https://example.com/sitemap.xml > urls.txt 2> errors.log
```

## Options

| Option              | Type       | Default | Description                                                                 |
|---------------------|------------|---------|-----------------------------------------------------------------------------|
| `delay`             | `number`   | `1000`  | Milliseconds to wait between batches when following a sitemap index. `limit` URLs are fetched in parallel per batch; after each batch completes, the process waits `delay` ms before starting the next. Set to `0` to disable. CLI: `--delay`   |
| `limit`             | `number`   | `10`    | Number of child sitemaps to fetch concurrently per batch. CLI: `--limit`              |
| `timeout`           | `number`   | `30000` | Milliseconds before a request is aborted. CLI: `--timeout`                            |
| `onError`           | `function` | —       | Called as `onError(url, error)` when a URL fails. The URL is skipped regardless. **Library only.** |
| `onEntry`           | `function` | —       | Called as `onEntry(entry)` each time a URL entry is parsed. `entry` has the same shape as the objects returned by `fetch()`. **Library only.** |
| `filter`            | `string`   | —       | Only output URLs whose `loc` contains the given string (substring match). Can be combined with `--count` or `--tsv`. **CLI only.** |
| `filter-regex`      | `string`   | —       | Only output URLs whose `loc` matches the given regular expression (evaluated with `new RegExp(value)`). Invalid patterns exit with a non-zero code and an error on stderr. Can be combined with `--count` or `--tsv`. **CLI only.** |
| `tsv`               | —          | —       | Output results as tab-separated values. Prints a header row (`loc`, `lastmod`, `changefreq`, `priority`) followed by one row per entry. Missing fields are output as empty strings. **CLI only.** |
| `count`             | —          | —       | Print only the total number of URLs instead of listing them. **CLI only.** |

## Features

- Follows Sitemap Index files recursively, including nested indexes (Index within an Index)
- Automatically decompresses gzip: supports both `.gz` URLs and `Content-Encoding: gzip` responses
- Batch processing: fetches `limit` child sitemaps in parallel per batch, then waits `delay` ms after each batch completes
- Automatically follows redirects (301/302/303/307/308) up to 5 hops; errors beyond that are reported via `onError`

## Usage

```js
const SitemapXMLParser = require('sitemap-xml-parser');

const parser = new SitemapXMLParser('https://example.com/sitemap.xml');

(async () => {
    const urls = await parser.fetch();
    urls.forEach(entry => {
        console.log(entry.loc);
    });
})();
```

Or with ES modules:

```js
import SitemapXMLParser from 'sitemap-xml-parser';

const parser = new SitemapXMLParser('https://example.com/sitemap.xml');

const urls = await parser.fetch();
urls.forEach(entry => {
    console.log(entry.loc);
});
```

### Error handling with `onError`

Failed URLs (network errors, non-2xx responses, malformed XML) are skipped by default. Provide an `onError` callback to inspect them:

```js
const parser = new SitemapXMLParser('https://example.com/sitemap.xml', {
    onError: (url, err) => {
        console.error(`Skipped ${url}: ${err.message}`);
    },
});
```

## Return value

`fetch()` resolves to an array of URL entry objects. Each object reflects the fields present in the sitemap:

```js
[
  {
    loc:        'https://example.com/page1',
    lastmod:    '2024-01-01',
    changefreq: 'weekly',
    priority:   '0.8',
  },
  // ...
]
```

`loc` is always a string. Use `entry.loc` to get the URL. Optional fields (`lastmod`, `changefreq`, `priority`) are strings when present, or `undefined` when absent from the source XML.

Fields other than `loc` (`lastmod`, `changefreq`, `priority`, etc.) are included only when present in the source XML.

