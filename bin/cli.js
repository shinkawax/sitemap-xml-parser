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
        '  --cap <n>      Stop after collecting this many URL entries',
        '  --header <Name: Value> Add a request header (repeatable)',
        '  --filter <str>         Only output URLs that contain <str>',
        '  --filter-regex <regex> Only output URLs matching the given regular expression',
        '  --format <fmt>         Output format: "tsv" or "json"',
        '  --count                Print only the total number of URLs',
        '  --help                 Show this help message',
        '',
    ].join('\n'));
}

function parseArgs(argv) {
    const args = argv.slice(2);
    const opts = { delay: 1000, limit: 10, timeout: 30000 };
    let url = null;
    let format = null;
    let count = false;
    let filter = null;
    let filterRegex = null;
    const headers = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        } else if (arg === '--format') {
            if (++i >= args.length) {
                process.stderr.write(`Error: --format requires a value\n`);
                process.exit(1);
            }
            const val = args[i];
            if (val !== 'tsv' && val !== 'json') {
                process.stderr.write(`Error: --format must be "tsv" or "json"\n`);
                process.exit(1);
            }
            format = val;
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
        } else if (arg === '--header') {
            if (++i >= args.length) {
                process.stderr.write(`Error: --header requires a value\n`);
                process.exit(1);
            }
            const sep = args[i].indexOf(':');
            if (sep < 1) {
                process.stderr.write(`Error: --header value must be in "Name: Value" format\n`);
                process.exit(1);
            }
            const name  = args[i].slice(0, sep).trim();
            const value = args[i].slice(sep + 1).trim();
            headers[name] = value;
        } else if (arg === '--cap') {
            if (++i >= args.length) {
                process.stderr.write(`Error: --cap requires a value\n`);
                process.exit(1);
            }
            const val = Number(args[i]);
            if (!Number.isInteger(val) || val < 1) {
                process.stderr.write(`Error: --cap must be a positive integer\n`);
                process.exit(1);
            }
            opts.cap = val;
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

    if (Object.keys(headers).length > 0) opts.headers = headers;

    return { url, opts, format, count, filter, filterRegex };
}

(async () => {
    const { url, opts, format, count, filter, filterRegex } = parseArgs(process.argv);

    const red   = process.stderr.isTTY ? '\x1b[31m' : '';
    const reset = process.stderr.isTTY ? '\x1b[0m'  : '';

    if (format === 'tsv' && !count) {
        process.stdout.write('loc\tlastmod\tchangefreq\tpriority\n');
    }

    let hasError = false;
    let filteredCount = 0;
    const jsonEntries = [];

    const hasFilter = filter !== null || filterRegex !== null;

    // onEntry is only skipped when count mode has no filter (result.length is sufficient).
    const needsOnEntry = !count || hasFilter;

    // When a filter is active, cap must apply to post-filter results.
    // Remove cap from library options and manage it via abort() in onEntry instead.
    const filterCapActive = hasFilter && opts.cap !== undefined;
    const libOpts = filterCapActive ? { ...opts, cap: undefined } : opts;

    let parser;
    parser = new SitemapXMLParser(url, {
        ...libOpts,
        onEntry: needsOnEntry ? (entry) => {
            const loc = entry.loc ?? '';
            if (filter !== null && !loc.includes(filter)) return;
            if (filterRegex !== null && !filterRegex.test(loc)) return;

            filteredCount++;
            if (filterCapActive && filteredCount >= opts.cap) parser.abort();

            if (count) return;

            if (format === 'json') {
                const obj = { loc: loc };
                if (entry.lastmod)    obj.lastmod    = entry.lastmod;
                if (entry.changefreq) obj.changefreq = entry.changefreq;
                if (entry.priority)   obj.priority   = entry.priority;
                jsonEntries.push(obj);
                return;
            }

            if (format === 'tsv') {
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
    if (count) {
        process.stdout.write((hasFilter ? filteredCount : result.length) + '\n');
    } else if (format === 'json') {
        process.stdout.write(JSON.stringify(jsonEntries, null, 2) + '\n');
    }
    if (hasError) process.exit(1);
})();
