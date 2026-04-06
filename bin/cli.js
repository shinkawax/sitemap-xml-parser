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
        '  --help          Show this help message',
        '',
    ].join('\n'));
}

function parseArgs(argv) {
    const args = argv.slice(2);
    const opts = { delay: 3000, limit: 5, timeout: 30000 };
    let url = null;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
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

    return { url, opts };
}

(async () => {
    const { url, opts } = parseArgs(process.argv);

    let hasError = false;
    const parser = new SitemapXMLParser(url, {
        ...opts,
        onError: (failedUrl, err) => {
            hasError = true;
            process.stderr.write(`Error: ${failedUrl} — ${err.message}\n`);
        },
    });

    const entries = await parser.fetch();
    for (const entry of entries) {
        process.stdout.write(entry.loc[0] + '\n');
    }
    if (hasError) process.exit(1);
})();
