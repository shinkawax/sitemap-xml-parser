#!/usr/bin/env node
'use strict';

const SitemapXMLParser = require('../index.js');

function printUsage() {
    process.stdout.write([
        'Usage: sitemap-xml-parser <url> [options]',
        '',
        'Options:',
        '  --delay <ms>           Delay between batches in milliseconds (default: 1000)',
        '  --limit <n>            Concurrent fetches per batch (default: 10)',
        '  --timeout <ms>         Request timeout in milliseconds (default: 30000)',
        '  --filter <str>         Only output URLs that contain <str>',
        '  --filter-regex <regex> Only output URLs matching the given regular expression',
        '  --tsv                  Output as tab-separated values with a header row',
        '  --count                Print only the total number of URLs',
        '  --help                 Show this help message',
        '',
    ].join('\n'));
}

function parseArgs(argv) {
    const args = argv.slice(2);
    const opts = { delay: 1000, limit: 10, timeout: 30000 };
    let url = null;
    let tsv = false;
    let count = false;
    let filter = null;
    let filterRegex = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        } else if (arg === '--tsv') {
            tsv = true;
        } else if (arg === '--count') {
            count = true;
        } else if (arg === '--filter') {
            if (++i >= args.length) {
                process.stderr.write(`Error: --filter requires a value\n`);
                process.exit(1);
            }
            filter = args[i];
        } else if (arg === '--filter-regex') {
            if (++i >= args.length) {
                process.stderr.write(`Error: --filter-regex requires a value\n`);
                process.exit(1);
            }
            try {
                filterRegex = new RegExp(args[i]);
            } catch (e) {
                process.stderr.write(`Error: --filter-regex invalid regular expression: ${e.message}\n`);
                process.exit(1);
            }
        } else if (arg === '--delay') {
            if (++i >= args.length) {
                process.stderr.write(`Error: --delay requires a value\n`);
                process.exit(1);
            }
            const val = Number(args[i]);
            if (!Number.isFinite(val) || val < 0) {
                process.stderr.write(`Error: --delay must be a non-negative number\n`);
                process.exit(1);
            }
            opts.delay = val;
        } else if (arg === '--limit') {
            if (++i >= args.length) {
                process.stderr.write(`Error: --limit requires a value\n`);
                process.exit(1);
            }
            const val = Number(args[i]);
            if (!Number.isInteger(val) || val < 1) {
                process.stderr.write(`Error: --limit must be a positive integer\n`);
                process.exit(1);
            }
            opts.limit = val;
        } else if (arg === '--timeout') {
            if (++i >= args.length) {
                process.stderr.write(`Error: --timeout requires a value\n`);
                process.exit(1);
            }
            const val = Number(args[i]);
            if (!Number.isFinite(val) || val < 0) {
                process.stderr.write(`Error: --timeout must be a non-negative number\n`);
                process.exit(1);
            }
            opts.timeout = val;
        } else if (arg.startsWith('--')) {
            process.stderr.write(`Error: unknown option ${arg}\n`);
            process.exit(1);
        } else {
            if (url !== null) {
                process.stderr.write(`Error: unexpected argument: ${arg}\n`);
                process.exit(1);
            }
            url = arg;
        }
    }

    if (!url) {
        printUsage();
        process.exit(1);
    }

    return { url, opts, tsv, count, filter, filterRegex };
}

(async () => {
    const { url, opts, tsv, count, filter, filterRegex } = parseArgs(process.argv);

    const red   = process.stderr.isTTY ? '\x1b[31m' : '';
    const reset = process.stderr.isTTY ? '\x1b[0m'  : '';

    if (tsv && !count) {
        process.stdout.write('loc\tlastmod\tchangefreq\tpriority\n');
    }

    let hasError = false;
    let filteredCount = 0;

    const hasFilter = filter !== null || filterRegex !== null;

    // onEntry is only skipped when count mode has no filter (result.length is sufficient).
    const needsOnEntry = !count || hasFilter;

    const parser = new SitemapXMLParser(url, {
        ...opts,
        onEntry: needsOnEntry ? (entry) => {
            const loc = entry.loc ?? '';
            if (filter !== null && !loc.includes(filter)) return;
            if (filterRegex !== null && !filterRegex.test(loc)) return;

            if (count) {
                filteredCount++;
                return;
            }

            if (tsv) {
                const lastmod    = entry.lastmod    ?? '';
                const changefreq = entry.changefreq ?? '';
                const priority   = entry.priority   ?? '';
                process.stdout.write(`${loc}\t${lastmod}\t${changefreq}\t${priority}\n`);
            } else {
                process.stdout.write(loc + '\n');
            }
        } : null,
        onError: (failedUrl, err) => {
            hasError = true;
            const msg = err.message.replace(/\r?\n/g, ' ').trim();
            process.stderr.write(`${red}Error: ${failedUrl} — ${msg}${reset}\n`);
        },
    });

    const result = await parser.fetch();
    if (count) process.stdout.write((hasFilter ? filteredCount : result.length) + '\n');
    if (hasError) process.exit(1);
})();
