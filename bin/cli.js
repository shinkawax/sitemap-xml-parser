#!/usr/bin/env node
'use strict';

const SitemapXMLParser = require('../index.js');

function printUsage() {
    process.stdout.write([
        'Usage: sitemap-xml-parser <url> [options]',
        '',
        'Options:',
        '  --delay <ms>    Delay between batches in milliseconds (default: 3000)',
        '  --limit <n>     Concurrent fetches per batch (default: 5)',
        '  --timeout <ms>  Request timeout in milliseconds (default: 30000)',
        '  --tsv           Output as tab-separated values with a header row',
        '  --help          Show this help message',
        '',
    ].join('\n'));
}

function parseArgs(argv) {
    const args = argv.slice(2);
    const opts = { delay: 3000, limit: 5, timeout: 30000 };
    let url = null;
    let tsv = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        } else if (arg === '--tsv') {
            tsv = true;
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

    return { url, opts, tsv };
}

(async () => {
    const { url, opts, tsv } = parseArgs(process.argv);

    const red   = process.stderr.isTTY ? '\x1b[31m' : '';
    const reset = process.stderr.isTTY ? '\x1b[0m'  : '';

    if (tsv) {
        process.stdout.write('loc\tlastmod\tchangefreq\tpriority\n');
    }

    let hasError = false;
    const parser = new SitemapXMLParser(url, {
        ...opts,
        onEntry: (entry) => {
            if (tsv) {
                const loc        = entry.loc?.[0]        ?? '';
                const lastmod    = entry.lastmod?.[0]    ?? '';
                const changefreq = entry.changefreq?.[0] ?? '';
                const priority   = entry.priority?.[0]   ?? '';
                process.stdout.write(`${loc}\t${lastmod}\t${changefreq}\t${priority}\n`);
            } else {
                process.stdout.write(entry.loc[0] + '\n');
            }
        },
        onError: (failedUrl, err) => {
            hasError = true;
            const msg = err.message.replace(/\r?\n/g, ' ').trim();
            process.stderr.write(`${red}Error: ${failedUrl} — ${msg}${reset}\n`);
        },
    });

    await parser.fetch();
    if (hasError) process.exit(1);
})();
