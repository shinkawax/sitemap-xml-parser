# sitemap-xml-parser

Parses sitemap XML files and returns all listed URLs. Supports sitemap index files and gzip (.gz) compression.

## Installation

```
npm install sitemap-xml-parser
```

## Usage

```js
const SitemapXMLParser = require('sitemap-xml-parser');

const parser = new SitemapXMLParser('https://example.com/sitemap.xml');

(async () => {
    const urls = await parser.fetch();
    urls.forEach(entry => {
        console.log(entry.loc[0]);
    });
})();
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

## Options

| Option      | Type       | Default | Description                                                                 |
|-------------|------------|---------|-----------------------------------------------------------------------------|
| `delay`     | `number`   | `3000`  | Milliseconds to wait between batches when following a sitemap index. Default is 3000 to avoid overloading the target server; set to `0` to disable. CLI: `--delay`   |
| `limit`     | `number`   | `5`     | Number of child sitemaps to fetch concurrently per batch. CLI: `--limit`              |
| `timeout`   | `number`   | `30000` | Milliseconds before a request is aborted. CLI: `--timeout`                            |
| `onError`   | `function` | —       | Called as `onError(url, error)` when a URL fails. The URL is skipped regardless. **Library only.** |
| `onEntry`   | `function` | —       | Called as `onEntry(entry)` each time a URL entry is parsed. `entry` has the same shape as the objects returned by `fetch()`. **Library only.** |
| `tsv`     | —          | —       | Output results as tab-separated values. Prints a header row (`loc`, `lastmod`, `changefreq`, `priority`) followed by one row per entry. Missing fields are output as empty strings. **CLI only.** |

## Return value

`fetch()` resolves to an array of URL entry objects. Each object reflects the fields present in the sitemap:

```js
[
  {
    loc:        ['https://example.com/page1'],
    lastmod:    ['2024-01-01'],
    changefreq: ['weekly'],
    priority:   ['0.8'],
  },
  // ...
]
```

All field values are arrays (xml2js convention). Use `entry.loc[0]` to get the URL string, `entry.lastmod?.[0]` for optional fields, and so on.

Fields other than `loc` (`lastmod`, `changefreq`, `priority`, etc.) are included only when present in the source XML.

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

### Examples

```sh
# Print all URLs
npx sitemap-xml-parser https://example.com/sitemap.xml

# No delay, higher concurrency
npx sitemap-xml-parser https://example.com/sitemap.xml --delay 0 --limit 10

# Save URLs to a file, errors to a log
npx sitemap-xml-parser https://example.com/sitemap.xml > urls.txt 2> errors.log

# Custom timeout
npx sitemap-xml-parser https://example.com/sitemap.xml --timeout 10000

# Output as TSV (includes lastmod, changefreq, priority)
npx sitemap-xml-parser https://example.com/sitemap.xml --tsv

# Save TSV to a file
npx sitemap-xml-parser https://example.com/sitemap.xml --tsv > urls.tsv
```

## Limitations

- **HTTP redirects are followed up to 5 times.** Status codes 301, 302, 303, 307, and 308 are handled automatically by following the `Location` header (relative URLs are resolved against the current URL). If the redirect chain exceeds 5 hops, an error is raised via `onError`.
