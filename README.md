# sitemap-xml-parser

Parses sitemap XML files and returns all listed URLs. Supports sitemap index files, gzip (.gz) compression, and custom request headers.

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

# Stop after 100 entries
npx sitemap-xml-parser https://example.com/sitemap.xml --cap 100

# Filter by regular expression
npx sitemap-xml-parser https://example.com/sitemap.xml --filter-regex "blog/[0-9]{4}/"

# Filter and count
npx sitemap-xml-parser https://example.com/sitemap.xml --filter "blog" --count

# Output as JSON (all fields)
npx sitemap-xml-parser https://example.com/sitemap.xml --format json

# Output as TSV (loc, lastmod, changefreq, priority)
npx sitemap-xml-parser https://example.com/sitemap.xml --format tsv

# Output as TSV with custom columns (e.g. image sitemap extension)
npx sitemap-xml-parser https://example.com/sitemap.xml --format tsv --fields loc,image:image

# Save URLs to a file, errors to a log
npx sitemap-xml-parser https://example.com/sitemap.xml > urls.txt 2> errors.log
```

## Options

### CLI

| Flag                    | Default | Description                                                                 |
|-------------------------|---------|-----------------------------------------------------------------------------|
| `--delay <ms>`          | `1000`  | Milliseconds to wait between batches when following a sitemap index. `--limit` URLs are fetched in parallel per batch; after each batch completes, the process waits `--delay` ms before starting the next. Set to `0` to disable. |
| `--limit <n>`           | `10`    | Number of child sitemaps to fetch concurrently per batch. |
| `--timeout <ms>`        | `30000` | Milliseconds before a request is aborted. |
| `--cap <n>`             | —       | Stop collecting after this many URL entries. Useful for sampling large sitemaps. |
| `--header <Name: Value>`| —       | Add a request header. Repeatable. Single: `--header "User-Agent: MyBot/1.0"`. Multiple: `--header "User-Agent: MyBot/1.0" --header "Authorization: Bearer token"` |
| `--filter <str>`        | —       | Only output URLs whose `loc` contains the given string (substring match). Can be combined with `--count` or `--format`. |
| `--filter-regex <regex>`| —       | Only output URLs whose `loc` matches the given regular expression. Invalid patterns exit non-zero. Can be combined with `--count` or `--format`. |
| `--format <fmt>`        | —       | Output format: `tsv` prints a header row followed by one tab-separated row per entry; `json` outputs a JSON array of entry objects including all fields from the source XML. |
| `--fields <f1,f2,...>`  | —       | Comma-separated list of fields to include in the output. Requires `--format`. For `tsv`, defaults to `loc,lastmod,changefreq,priority`. For `json`, defaults to all fields. Nested values are serialized as JSON in TSV output. |
| `--count`               | —       | Print only the total number of URLs. |

### Library

| Option    | Type       | Default | Description                        |
|-----------|------------|---------|------------------------------------|
| `delay`   | `number`   | `1000`  | Same as `--delay`.                 |
| `limit`   | `number`   | `10`    | Same as `--limit`.                 |
| `timeout` | `number`   | `30000` | Same as `--timeout`.               |
| `cap`     | `number`   | —       | Same as `--cap`. |
| `headers` | `object`   | —       | Key-value map of request headers. Same as repeated `--header`. |
| `onError` | `function` | —       | Called as `onError(url, error)` when a fetch or parse fails. The entry is skipped regardless. |
| `onEntry` | `function` | —       | Called as `onEntry(entry)` each time a URL entry is parsed. `entry` has the same shape as the objects returned by `fetch()`. |

## Features

- Follows Sitemap Index files recursively, including nested indexes (Index within an Index)
- Automatically decompresses gzip: supports both `.gz` URLs and `Content-Encoding: gzip` responses
- Batch processing: fetches `limit` child sitemaps in parallel per batch, then waits `delay` ms after each batch completes
- Automatically follows redirects (301/302/303/307/308) up to 5 hops; errors beyond that are reported via `onError`. Custom request headers are forwarded only when the redirect stays on the same origin (same scheme, host, and port); they are stripped on cross-origin redirects.

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

### Custom headers

```js
const parser = new SitemapXMLParser('https://example.com/sitemap.xml', {
    headers: {
        'User-Agent': 'MyBot/2.0',
        'Authorization': 'Bearer my-token',
    },
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

`loc` is always a string. Standard fields (`lastmod`, `changefreq`, `priority`) are strings when present, or `undefined` when absent from the source XML.

Sitemap extension fields (e.g. `image:image`, `news:news`, `video:video`) are also preserved as-is when present in the source XML. Their values reflect the structure parsed by the underlying XML parser — nested elements become objects.

