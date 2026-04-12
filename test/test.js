'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const SitemapXMLParser = require('../index.js');

const CLI_PATH = path.join(__dirname, '../bin/cli.js');

function runCLI(args) {
    return new Promise((resolve) => {
        const child = spawn(process.execPath, [CLI_PATH, ...args]);
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr += d; });
        child.on('close', code => resolve({ code, stdout, stderr }));
    });
}

// Mock HTTP server
const MOCK_DIR = path.join(__dirname, 'mock');
let BASE_URL;

function startServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const filePath = path.join(MOCK_DIR, req.url.replace(/^\//, ''));
            console.log(`  [server] GET ${req.url}`);

            if (!fs.existsSync(filePath)) {
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            const ext = path.extname(filePath);
            if (ext === '.gz') {
                res.setHeader('Content-Type', 'application/x-gzip');
            } else {
                res.setHeader('Content-Type', 'application/xml');
            }
            fs.createReadStream(filePath).pipe(res);
        });

        server.listen(0, '127.0.0.1', () => {
            BASE_URL = `http://127.0.0.1:${server.address().port}`;
            resolve(server);
        });
    });
}

// Inject BASE_URL into the index XML template
function prepareIndexXml() {
    const src = path.join(MOCK_DIR, 'sitemap_index.xml');
    let xml = fs.readFileSync(src, 'utf8');
    xml = xml.replace(/PLACEHOLDER/g, BASE_URL);
    const dest = path.join(MOCK_DIR, 'sitemap_index_resolved.xml');
    fs.writeFileSync(dest, xml);
}

async function runTests(server) {
    let passed = 0;
    let failed = 0;

    function assert(label, condition, detail = '') {
        if (condition) {
            console.log(`  PASS ${label}`);
            passed++;
        } else {
            console.log(`  FAIL ${label}${detail ? ' : ' + detail : ''}`);
            failed++;
        }
    }

    // --- Test 1: Plain sitemap (single XML) ---
    console.log('\nTest 1: Single sitemap (sitemap_1.xml)');
    {
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_1.xml`, { delay: 0, limit: 5 });
        const result = await parser.fetch();
        assert('retrieves URLs', result.length === 2, `length=${result.length}`);
        assert('first loc is correct', result[0].loc === 'https://example.com/page1');
        assert('lastmod is present', result[0].lastmod === '2024-01-01');
        assert('changefreq is present', result[0].changefreq === 'weekly');
        assert('priority is present', result[0].priority === '0.8');
    }

    // --- Test 2: Sitemap index (multiple XMLs) ---
    console.log('\nTest 2: Sitemap index (sitemap_index.xml -> 2 files)');
    {
        prepareIndexXml();
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_index_resolved.xml`, { delay: 0, limit: 5 });
        const result = await parser.fetch();
        assert('total URL count from child sitemaps', result.length === 3, `length=${result.length}`);
        const locs = result.map(r => r.loc);
        assert('page1 is included', locs.includes('https://example.com/page1'));
        assert('page2 is included', locs.includes('https://example.com/page2'));
        assert('page3 is included', locs.includes('https://example.com/page3'));
    }

    // --- Test 3: Gzipped sitemap ---
    console.log('\nTest 3: Gzipped sitemap (sitemap_2.xml.gz)');
    {
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_2.xml.gz`, { delay: 0, limit: 5 });
        const result = await parser.fetch();
        assert('decompresses gz and retrieves URLs', result.length === 1, `length=${result.length}`);
        assert('page3 loc is correct', result[0].loc === 'https://example.com/page3');
    }

    // --- Test 3b: Content-Encoding: gzip decompression ---
    console.log('\nTest 3b: Content-Encoding: gzip decompression');
    {
        const gzipServer = await new Promise((resolve) => {
            const xml = fs.readFileSync(path.join(MOCK_DIR, 'sitemap_1.xml'));
            const srv = http.createServer((req, res) => {
                zlib.gzip(xml, (err, buf) => {
                    if (err) { res.writeHead(500); res.end(); return; }
                    res.writeHead(200, {
                        'Content-Type': 'application/xml',
                        'Content-Encoding': 'gzip',
                    });
                    res.end(buf);
                });
            });
            srv.listen(0, '127.0.0.1', () => resolve(srv));
        });

        const { port } = gzipServer.address();
        const parser = new SitemapXMLParser(`http://127.0.0.1:${port}/sitemap.xml`, { delay: 0 });
        const result = await parser.fetch();
        gzipServer.close();
        assert('decompresses Content-Encoding: gzip and retrieves URLs', result.length === 2, `length=${result.length}`);
        assert('page1 loc is correct', result[0].loc === 'https://example.com/page1');
    }

    // --- Test 4: Default option values ---
    console.log('\nTest 4: Default option values');
    {
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_1.xml`, {});
        assert('delayTime defaults to 1000', parser.delayTime === 1000);
        assert('limit defaults to 10', parser.limit === 10);
        assert('timeout defaults to 30000', parser.timeout === 30000);
    }

    // --- Test 5: onError callback on bad URL ---
    console.log('\nTest 5: onError callback on unreachable URL');
    {
        const errors = [];
        const parser = new SitemapXMLParser(`${BASE_URL}/does_not_exist.xml`, {
            delay: 0,
            onError: (url, err) => errors.push({ url, err }),
        });
        const result = await parser.fetch();
        assert('returns empty array on error', result.length === 0, `length=${result.length}`);
        assert('onError is called with the URL', errors.length === 1 && errors[0].url === `${BASE_URL}/does_not_exist.xml`);
    }

    // --- Test 6: delay:0 and limit:1 are not treated as falsy ---
    console.log('\nTest 6: Falsy option values (delay:0, limit:1) are respected');
    {
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_1.xml`, { delay: 0, limit: 1 });
        assert('delay:0 sets delayTime to 0', parser.delayTime === 0);
        assert('limit:1 sets limit to 1', parser.limit === 1);
    }

    // --- Test 7: Malformed XML calls onError and returns empty array ---
    console.log('\nTest 7: Malformed XML triggers onError');
    {
        const errors = [];
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_bad.xml`, {
            delay: 0,
            onError: (url, err) => errors.push({ url, err }),
        });
        const result = await parser.fetch();
        assert('returns empty array on parse error', result.length === 0, `length=${result.length}`);
        assert('onError is called', errors.length === 1);
        assert('onError receives the URL', errors[0].url === `${BASE_URL}/sitemap_bad.xml`);
    }

    // --- Test 8: Batch cycling (limit < number of child sitemaps) ---
    console.log('\nTest 8: Batch cycling (limit:1 with 2 child sitemaps)');
    {
        prepareIndexXml();
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_index_resolved.xml`, { delay: 0, limit: 1 });
        const result = await parser.fetch();
        assert('collects all URLs across multiple batches', result.length === 3, `length=${result.length}`);
        const locs = result.map(r => r.loc);
        assert('page1 is included', locs.includes('https://example.com/page1'));
        assert('page2 is included', locs.includes('https://example.com/page2'));
        assert('page3 is included', locs.includes('https://example.com/page3'));
    }

    // --- Test 9: CLI no args prints usage to stdout ---
    console.log('\nTest 9: CLI - no args prints usage to stdout');
    {
        const { code, stdout } = await runCLI([]);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('usage is printed to stdout', stdout.includes('Usage: sitemap-xml-parser'));
        assert('options are listed in stdout', stdout.includes('--delay') && stdout.includes('--limit'));
    }

    // --- Test 10: CLI prints URLs one per line ---
    console.log('\nTest 10: CLI - valid URL prints URLs to stdout');
    {
        const { code, stdout, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('no errors on stderr', !stderr.includes('Error:'), `stderr=${stderr}`);
        const lines = stdout.trim().split('\n');
        assert('outputs 2 lines', lines.length === 2, `lines=${lines.length}`);
        assert('page1 is in stdout', lines.includes('https://example.com/page1'));
        assert('page2 is in stdout', lines.includes('https://example.com/page2'));
    }

    // --- Test 11: CLI prints error to stderr for non-existent URL ---
    console.log('\nTest 11: CLI - non-existent URL prints error to stderr');
    {
        const { code, stdout, stderr } = await runCLI([`${BASE_URL}/does_not_exist.xml`, '--delay', '0']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('stdout is empty', stdout === '', `stdout=${stdout}`);
        assert('error is printed to stderr', stderr.includes(`${BASE_URL}/does_not_exist.xml`));
    }

    // --- Test 12: CLI accepts --delay and --limit ---
    console.log('\nTest 12: CLI - --delay and --limit options are accepted');
    {
        prepareIndexXml();
        const { code, stdout, stderr } = await runCLI([
            `${BASE_URL}/sitemap_index_resolved.xml`,
            '--delay', '0',
            '--limit', '2',
        ]);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('no errors on stderr', !stderr.includes('Error:'), `stderr=${stderr}`);
        const lines = stdout.trim().split('\n');
        assert('outputs 3 URLs', lines.length === 3, `lines=${lines.length}`);
    }

    // --- Test 13: CLI --help prints usage to stdout and exits 0 ---
    console.log('\nTest 13: CLI - --help prints usage to stdout');
    {
        const { code, stdout } = await runCLI(['--help']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('usage is printed to stdout', stdout.includes('Usage: sitemap-xml-parser'));
        assert('options are listed in stdout', stdout.includes('--delay') && stdout.includes('--limit'));
    }

    // --- Test 14: CLI --delay with invalid value exits non-zero with stderr message ---
    console.log('\nTest 14: CLI - invalid --delay value');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', 'abc']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error message mentions --delay', stderr.includes('--delay'));
    }

    // --- Test 15: No onError - errors are silently skipped ---
    console.log('\nTest 15: No onError - errors are silently skipped');
    {
        const parser = new SitemapXMLParser(`${BASE_URL}/does_not_exist.xml`, { delay: 0 });
        let threw = false;
        let result;
        try {
            result = await parser.fetch();
        } catch (e) {
            threw = true;
        }
        assert('does not throw', !threw);
        assert('returns empty array', result !== undefined && result.length === 0, `length=${result?.length}`);
    }

    // --- Test 16: URL entry without <loc> is skipped ---
    console.log('\nTest 16: URL entry without <loc> is skipped');
    {
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_no_loc.xml`, { delay: 0 });
        const result = await parser.fetch();
        assert('only entry with loc is returned', result.length === 1, `length=${result.length}`);
        assert('returned entry has correct loc', result[0].loc === 'https://example.com/page1');
    }

    // --- Test 17: CLI --timeout option is accepted ---
    console.log('\nTest 17: CLI - --timeout option is accepted');
    {
        const { code, stdout, stderr } = await runCLI([
            `${BASE_URL}/sitemap_1.xml`,
            '--delay', '0',
            '--timeout', '10000',
        ]);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('no errors on stderr', !stderr.includes('Error:'), `stderr=${stderr}`);
        const lines = stdout.trim().split('\n');
        assert('outputs 2 URLs', lines.length === 2, `lines=${lines.length}`);
    }

    // --- Test 18: CLI --timeout with invalid value exits non-zero ---
    console.log('\nTest 18: CLI - invalid --timeout value');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--timeout', 'abc']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error message mentions --timeout', stderr.includes('--timeout'));
    }

    // --- Test 19: fetch() called twice on same instance does not accumulate results ---
    console.log('\nTest 19: fetch() called twice returns same result (no accumulation)');
    {
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_1.xml`, { delay: 0 });
        const first = await parser.fetch();
        const second = await parser.fetch();
        assert('first call returns 2 URLs', first.length === 2, `length=${first.length}`);
        assert('second call also returns 2 URLs', second.length === 2, `length=${second.length}`);
    }

    // --- Test 20: CLI --delay / --limit / --timeout without value show specific error ---
    console.log('\nTest 20: CLI - missing value for --delay / --limit / --timeout');
    {
        const { code: c1, stderr: e1 } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay']);
        assert('--delay without value exits non-zero', c1 !== 0, `code=${c1}`);
        assert('--delay error says "requires a value"', e1.includes('requires a value'), `stderr=${e1}`);

        const { code: c2, stderr: e2 } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--limit']);
        assert('--limit without value exits non-zero', c2 !== 0, `code=${c2}`);
        assert('--limit error says "requires a value"', e2.includes('requires a value'), `stderr=${e2}`);

        const { code: c3, stderr: e3 } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--timeout']);
        assert('--timeout without value exits non-zero', c3 !== 0, `code=${c3}`);
        assert('--timeout error says "requires a value"', e3.includes('requires a value'), `stderr=${e3}`);
    }

    // --- Test 22: Single redirect (301) is followed ---
    console.log('\nTest 22: Single redirect (301) is followed');
    {
        const redirectServer = await new Promise((resolve) => {
            let target;
            const srv = http.createServer((req, res) => {
                if (req.url === '/redirect') {
                    res.writeHead(301, { Location: target });
                    res.end();
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/xml' });
                    res.end(fs.readFileSync(path.join(MOCK_DIR, 'sitemap_1.xml')));
                }
            });
            srv.listen(0, '127.0.0.1', () => {
                const { port } = srv.address();
                target = `http://127.0.0.1:${port}/sitemap_1.xml`;
                resolve(srv);
            });
        });

        const { port } = redirectServer.address();
        const parser = new SitemapXMLParser(`http://127.0.0.1:${port}/redirect`, { delay: 0 });
        const result = await parser.fetch();
        redirectServer.close();
        assert('follows 301 redirect and retrieves URLs', result.length === 2, `length=${result.length}`);
        assert('page1 is present after redirect', result[0].loc === 'https://example.com/page1');
    }

    // --- Test 23: Too many redirects triggers onError ---
    console.log('\nTest 23: Too many redirects (> 5) triggers onError');
    {
        const loopServer = await new Promise((resolve) => {
            const srv = http.createServer((req, res) => {
                const { port } = srv.address();
                res.writeHead(302, { Location: `http://127.0.0.1:${port}/loop` });
                res.end();
            });
            srv.listen(0, '127.0.0.1', () => resolve(srv));
        });

        const { port } = loopServer.address();
        const errors = [];
        const parser = new SitemapXMLParser(`http://127.0.0.1:${port}/loop`, {
            delay: 0,
            onError: (url, err) => errors.push({ url, err }),
        });
        const result = await parser.fetch();
        loopServer.close();
        assert('returns empty array on too many redirects', result.length === 0, `length=${result.length}`);
        assert('onError is called', errors.length === 1);
        assert('error message mentions max 5', errors[0].err.message.includes('max 5'));
    }

    // --- Test 24: Relative Location header is resolved correctly ---
    console.log('\nTest 24: Relative Location header in redirect');
    {
        const relServer = await new Promise((resolve) => {
            const srv = http.createServer((req, res) => {
                if (req.url === '/old/sitemap') {
                    res.writeHead(302, { Location: '/sitemap_1.xml' });
                    res.end();
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/xml' });
                    res.end(fs.readFileSync(path.join(MOCK_DIR, 'sitemap_1.xml')));
                }
            });
            srv.listen(0, '127.0.0.1', () => resolve(srv));
        });

        const { port } = relServer.address();
        const parser = new SitemapXMLParser(`http://127.0.0.1:${port}/old/sitemap`, { delay: 0 });
        const result = await parser.fetch();
        relServer.close();
        assert('resolves relative Location and retrieves URLs', result.length === 2, `length=${result.length}`);
    }

    // --- Test 25: onEntry is called for each parsed entry ---
    console.log('\nTest 25: onEntry is called for each parsed entry');
    {
        const seen = [];
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_1.xml`, {
            delay: 0,
            onEntry: (entry) => seen.push(entry),
        });
        const result = await parser.fetch();
        assert('onEntry called twice for 2 entries', seen.length === 2, `count=${seen.length}`);
        assert('onEntry entry matches fetch() result', seen[0] === result[0]);
        assert('fetch() still returns full array', result.length === 2, `length=${result.length}`);
    }

    // --- Test 26: onEntry receives entries in order across sitemap index ---
    console.log('\nTest 26: onEntry fires in order across sitemap index');
    {
        prepareIndexXml();
        const locs = [];
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_index_resolved.xml`, {
            delay: 0,
            onEntry: (entry) => locs.push(entry.loc),
        });
        const result = await parser.fetch();
        assert('onEntry called for all 3 entries', locs.length === 3, `count=${locs.length}`);
        assert('fetch() still returns 3 entries', result.length === 3, `length=${result.length}`);
        assert('page1 received via onEntry', locs.includes('https://example.com/page1'));
        assert('page3 received via onEntry', locs.includes('https://example.com/page3'));
    }

    // --- Test 27: onEntry not set — no error, fetch() works normally ---
    console.log('\nTest 27: onEntry omitted — fetch() works unchanged');
    {
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_1.xml`, { delay: 0 });
        const result = await parser.fetch();
        assert('returns 2 entries without onEntry', result.length === 2, `length=${result.length}`);
    }

    // --- Test 28: entries skipped by loc filter are NOT passed to onEntry ---
    console.log('\nTest 28: Entries without <loc> are not passed to onEntry');
    {
        const seen = [];
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_no_loc.xml`, {
            delay: 0,
            onEntry: (entry) => seen.push(entry),
        });
        const result = await parser.fetch();
        assert('only 1 entry passed to onEntry', seen.length === 1, `count=${seen.length}`);
        assert('fetch() returns 1 entry', result.length === 1, `length=${result.length}`);
    }

    // --- Test 29: CLI --format tsv outputs header and tab-separated entries ---
    console.log('\nTest 29: CLI - --format tsv outputs header and entries as TSV');
    {
        const { code, stdout, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--format', 'tsv']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('no errors on stderr', !stderr.includes('Error:'), `stderr=${stderr}`);
        const lines = stdout.split('\n').slice(0, -1);
        assert('outputs 3 lines (header + 2 entries)', lines.length === 3, `lines=${lines.length}`);
        assert('first line is header', lines[0] === 'loc\tlastmod\tchangefreq\tpriority', `header=${JSON.stringify(lines[0])}`);
        const [loc1, lastmod1, changefreq1, priority1] = lines[1].split('\t');
        assert('entry loc is correct', loc1 === 'https://example.com/page1', `loc=${loc1}`);
        assert('entry lastmod is correct', lastmod1 === '2024-01-01', `lastmod=${lastmod1}`);
        assert('entry changefreq is correct', changefreq1 === 'weekly', `changefreq=${changefreq1}`);
        assert('entry priority is correct', priority1 === '0.8', `priority=${priority1}`);
    }

    // --- Test 30: CLI --format tsv uses empty string for missing fields ---
    console.log('\nTest 30: CLI - --format tsv uses empty string for missing fields');
    {
        const { code, stdout } = await runCLI([`${BASE_URL}/sitemap_minimal.xml`, '--delay', '0', '--format', 'tsv']);
        assert('exits with code 0', code === 0, `code=${code}`);
        const lines = stdout.split('\n').slice(0, -1);
        assert('outputs 2 lines (header + 1 entry)', lines.length === 2, `lines=${lines.length}`);
        const fields = lines[1].split('\t');
        assert('loc is present', fields[0] === 'https://example.com/minimal', `loc=${fields[0]}`);
        assert('lastmod is empty', fields[1] === '', `lastmod=${JSON.stringify(fields[1])}`);
        assert('changefreq is empty', fields[2] === '', `changefreq=${JSON.stringify(fields[2])}`);
        assert('priority is empty', fields[3] === '', `priority=${JSON.stringify(fields[3])}`);
    }

    // --- Test 30b: CLI error is compressed to one line ---
    console.log('\nTest 30b: CLI - multiline error message is compressed to one line');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_bad.xml`, '--delay', '0']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        const errorLines = stderr.split('\n').filter(l => l.startsWith('Error:'));
        assert('error fits on one line', errorLines.length === 1, `errorLines=${JSON.stringify(errorLines)}`);
        assert('error line has no internal newlines', !errorLines[0].includes('\n'));
    }

    // --- Test 31: CLI --filter matches substring of loc ---
    console.log('\nTest 31: CLI - --filter returns only matching URLs');
    {
        const { code, stdout, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--filter', 'page1']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('no errors on stderr', !stderr.includes('Error:'), `stderr=${stderr}`);
        const lines = stdout.trim().split('\n');
        assert('outputs 1 line', lines.length === 1, `lines=${lines.length}`);
        assert('matched URL is page1', lines[0] === 'https://example.com/page1', `line=${lines[0]}`);
    }

    // --- Test 32: CLI --filter with no matches exits 0 and outputs nothing ---
    console.log('\nTest 32: CLI - --filter with no matches outputs nothing');
    {
        const { code, stdout, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--filter', 'blog']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('stdout is empty', stdout === '', `stdout=${JSON.stringify(stdout)}`);
        assert('no errors on stderr', !stderr.includes('Error:'), `stderr=${stderr}`);
    }

    // --- Test 33: CLI --filter matches multiple URLs ---
    console.log('\nTest 33: CLI - --filter matching multiple URLs');
    {
        const { code, stdout } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--filter', 'page']);
        assert('exits with code 0', code === 0, `code=${code}`);
        const lines = stdout.trim().split('\n');
        assert('outputs 2 lines', lines.length === 2, `lines=${lines.length}`);
        assert('page1 is included', lines.includes('https://example.com/page1'));
        assert('page2 is included', lines.includes('https://example.com/page2'));
    }

    // --- Test 34: CLI --filter --count returns filtered count ---
    console.log('\nTest 34: CLI - --filter --count returns filtered count');
    {
        const { code, stdout } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--filter', 'page1', '--count']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('outputs count of 1', stdout.trim() === '1', `stdout=${JSON.stringify(stdout)}`);
    }

    // --- Test 35: CLI --filter --format tsv outputs header and filtered entries ---
    console.log('\nTest 35: CLI - --filter --format tsv outputs filtered entries as TSV');
    {
        const { code, stdout } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--filter', 'page1', '--format', 'tsv']);
        assert('exits with code 0', code === 0, `code=${code}`);
        const lines = stdout.split('\n').slice(0, -1);
        assert('outputs 2 lines (header + 1 entry)', lines.length === 2, `lines=${lines.length}`);
        assert('first line is header', lines[0] === 'loc\tlastmod\tchangefreq\tpriority', `header=${JSON.stringify(lines[0])}`);
        assert('entry loc is page1', lines[1].split('\t')[0] === 'https://example.com/page1');
    }

    // --- Test 36: CLI --filter without value exits non-zero ---
    console.log('\nTest 36: CLI - --filter without value exits non-zero');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--filter']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error message mentions --filter', stderr.includes('--filter'), `stderr=${stderr}`);
        assert('error says "requires a value"', stderr.includes('requires a value'), `stderr=${stderr}`);
    }

    // --- Test 37: CLI --filter-regex matches by regex ---
    console.log('\nTest 37: CLI - --filter-regex returns only matching URLs');
    {
        const { code, stdout, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--filter-regex', 'page[12]']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('no errors on stderr', !stderr.includes('Error:'), `stderr=${stderr}`);
        const lines = stdout.trim().split('\n');
        assert('outputs 2 lines', lines.length === 2, `lines=${lines.length}`);
        assert('page1 is included', lines.includes('https://example.com/page1'));
        assert('page2 is included', lines.includes('https://example.com/page2'));
    }

    // --- Test 38: CLI --filter-regex with no matches outputs nothing ---
    console.log('\nTest 38: CLI - --filter-regex with no matches outputs nothing');
    {
        const { code, stdout, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--filter-regex', '^https://other']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('stdout is empty', stdout === '', `stdout=${JSON.stringify(stdout)}`);
        assert('no errors on stderr', !stderr.includes('Error:'), `stderr=${stderr}`);
    }

    // --- Test 39: CLI --filter-regex with invalid regex exits non-zero ---
    console.log('\nTest 39: CLI - --filter-regex with invalid regex exits non-zero');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--filter-regex', '[invalid']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error mentions --filter-regex', stderr.includes('--filter-regex'), `stderr=${stderr}`);
    }

    // --- Test 40: CLI --filter-regex without value exits non-zero ---
    console.log('\nTest 40: CLI - --filter-regex without value exits non-zero');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--filter-regex']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error says "requires a value"', stderr.includes('requires a value'), `stderr=${stderr}`);
    }

    // --- Test 41: CLI --filter-regex --count returns filtered count ---
    console.log('\nTest 41: CLI - --filter-regex --count returns filtered count');
    {
        const { code, stdout } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--filter-regex', 'page1', '--count']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('outputs count of 1', stdout.trim() === '1', `stdout=${JSON.stringify(stdout)}`);
    }

    // --- Test 42: CLI --filter-regex --count with no matches returns 0 ---
    console.log('\nTest 42: CLI - --filter-regex --count with no matches returns 0');
    {
        const { code, stdout } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--filter-regex', '^https://other', '--count']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('outputs count of 0', stdout.trim() === '0', `stdout=${JSON.stringify(stdout)}`);
    }

    // --- Test 43: headers option — custom User-Agent is sent ---
    console.log('\nTest 43: headers option - custom User-Agent is sent');
    {
        let receivedUA;
        const uaServer = await new Promise((resolve) => {
            const xml = fs.readFileSync(path.join(MOCK_DIR, 'sitemap_1.xml'));
            const srv = http.createServer((req, res) => {
                receivedUA = req.headers['user-agent'];
                res.writeHead(200, { 'Content-Type': 'application/xml' });
                res.end(xml);
            });
            srv.listen(0, '127.0.0.1', () => resolve(srv));
        });

        const { port } = uaServer.address();
        const parser = new SitemapXMLParser(`http://127.0.0.1:${port}/sitemap.xml`, {
            delay: 0,
            headers: { 'User-Agent': 'TestBot/9.9' },
        });
        await parser.fetch();
        uaServer.close();
        assert('custom User-Agent is sent', receivedUA === 'TestBot/9.9', `ua=${receivedUA}`);
    }

    // --- Test 44: headers option — no User-Agent is sent by default ---
    console.log('\nTest 44: headers option - no User-Agent sent when not specified');
    {
        let receivedUA;
        const uaServer = await new Promise((resolve) => {
            const xml = fs.readFileSync(path.join(MOCK_DIR, 'sitemap_1.xml'));
            const srv = http.createServer((req, res) => {
                receivedUA = req.headers['user-agent'];
                res.writeHead(200, { 'Content-Type': 'application/xml' });
                res.end(xml);
            });
            srv.listen(0, '127.0.0.1', () => resolve(srv));
        });

        const { port } = uaServer.address();
        const parser = new SitemapXMLParser(`http://127.0.0.1:${port}/sitemap.xml`, { delay: 0 });
        await parser.fetch();
        uaServer.close();
        assert('no default User-Agent is added', receivedUA === undefined, `ua=${receivedUA}`);
    }

    // --- Test 45: headers option — only user-specified headers are sent ---
    console.log('\nTest 45: headers option - only user-specified headers are sent');
    {
        let received = {};
        const hdrServer = await new Promise((resolve) => {
            const xml = fs.readFileSync(path.join(MOCK_DIR, 'sitemap_1.xml'));
            const srv = http.createServer((req, res) => {
                received = req.headers;
                res.writeHead(200, { 'Content-Type': 'application/xml' });
                res.end(xml);
            });
            srv.listen(0, '127.0.0.1', () => resolve(srv));
        });

        const { port } = hdrServer.address();
        const parser = new SitemapXMLParser(`http://127.0.0.1:${port}/sitemap.xml`, {
            delay: 0,
            headers: { 'User-Agent': 'MyBot/1.0', 'X-Custom': 'hello' },
        });
        await parser.fetch();
        hdrServer.close();
        assert('specified User-Agent is sent', received['user-agent'] === 'MyBot/1.0', `ua=${received['user-agent']}`);
        assert('extra header is sent', received['x-custom'] === 'hello', `x-custom=${received['x-custom']}`);
    }

    // --- Test 46: cap — limits entries from a single urlset ---
    console.log('\nTest 46: cap - limits entries from a single urlset');
    {
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_1.xml`, { delay: 0, cap: 1 });
        const result = await parser.fetch();
        assert('returns at most 1 entry', result.length === 1, `length=${result.length}`);
        assert('first entry is correct', result[0].loc === 'https://example.com/page1');
    }

    // --- Test 47: cap — limits entries across sitemap index ---
    console.log('\nTest 47: cap - limits entries across sitemap index');
    {
        prepareIndexXml();
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_index_resolved.xml`, { delay: 0, cap: 2 });
        const result = await parser.fetch();
        assert('returns at most 2 entries', result.length <= 2, `length=${result.length}`);
    }

    // --- Test 48: cap — onEntry only fires for collected entries ---
    console.log('\nTest 48: cap - onEntry only fires for collected entries');
    {
        const seen = [];
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_1.xml`, {
            delay: 0,
            cap: 1,
            onEntry: (entry) => seen.push(entry),
        });
        const result = await parser.fetch();
        assert('onEntry fired only once', seen.length === 1, `count=${seen.length}`);
        assert('fetch() result matches onEntry count', result.length === 1, `length=${result.length}`);
    }

    // --- Test 49: CLI --format json outputs valid JSON array ---
    console.log('\nTest 49: CLI - --format json outputs valid JSON array');
    {
        const { code, stdout, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--format', 'json']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('no errors on stderr', !stderr.includes('Error:'), `stderr=${stderr}`);
        let parsed;
        try { parsed = JSON.parse(stdout); } catch (e) { parsed = null; }
        assert('stdout is valid JSON', parsed !== null);
        assert('JSON is an array of 2 entries', Array.isArray(parsed) && parsed.length === 2, `length=${parsed?.length}`);
        assert('first entry has loc', parsed?.[0]?.loc === 'https://example.com/page1');
        assert('first entry has lastmod', parsed?.[0]?.lastmod === '2024-01-01');
    }

    // --- Test 50: CLI --format json respects --filter ---
    console.log('\nTest 50: CLI - --format json respects --filter');
    {
        const { code, stdout } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--format', 'json', '--filter', 'page1']);
        assert('exits with code 0', code === 0, `code=${code}`);
        const parsed = JSON.parse(stdout);
        assert('filtered JSON has 1 entry', parsed.length === 1, `length=${parsed.length}`);
        assert('entry is page1', parsed[0].loc === 'https://example.com/page1');
    }

    // --- Test 51: CLI --format with invalid value exits non-zero ---
    console.log('\nTest 51: CLI - --format with invalid value exits non-zero');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--format', 'xml']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error mentions --format', stderr.includes('--format'), `stderr=${stderr}`);
    }

    // --- Test 52: CLI --cap limits output ---
    console.log('\nTest 52: CLI - --cap limits output');
    {
        const { code, stdout, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--cap', '1']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('no errors on stderr', !stderr.includes('Error:'), `stderr=${stderr}`);
        const lines = stdout.trim().split('\n');
        assert('outputs at most 1 URL', lines.length === 1, `lines=${lines.length}`);
    }

    // --- Test 53: CLI --cap with invalid value exits non-zero ---
    console.log('\nTest 53: CLI - invalid --cap value');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--cap', '0']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error message mentions --cap', stderr.includes('--cap'), `stderr=${stderr}`);
    }

    // --- Test 54: CLI --cap without value exits non-zero ---
    console.log('\nTest 54: CLI - --cap without value exits non-zero');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--cap']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error says "requires a value"', stderr.includes('requires a value'), `stderr=${stderr}`);
    }

    // --- Test 55: CLI --header sends custom header ---
    console.log('\nTest 55: CLI - --header sends custom header');
    {
        let receivedUA;
        const hdrServer = await new Promise((resolve) => {
            const xml = fs.readFileSync(path.join(MOCK_DIR, 'sitemap_1.xml'));
            const srv = http.createServer((req, res) => {
                receivedUA = req.headers['user-agent'];
                res.writeHead(200, { 'Content-Type': 'application/xml' });
                res.end(xml);
            });
            srv.listen(0, '127.0.0.1', () => resolve(srv));
        });

        const { port } = hdrServer.address();
        const { code } = await runCLI([
            `http://127.0.0.1:${port}/sitemap.xml`,
            '--header', 'User-Agent: CliBot/1.0',
        ]);
        hdrServer.close();
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('custom User-Agent is sent', receivedUA === 'CliBot/1.0', `ua=${receivedUA}`);
    }

    // --- Test 56: CLI --header is repeatable ---
    console.log('\nTest 56: CLI - --header is repeatable');
    {
        let received = {};
        const hdrServer = await new Promise((resolve) => {
            const xml = fs.readFileSync(path.join(MOCK_DIR, 'sitemap_1.xml'));
            const srv = http.createServer((req, res) => {
                received = req.headers;
                res.writeHead(200, { 'Content-Type': 'application/xml' });
                res.end(xml);
            });
            srv.listen(0, '127.0.0.1', () => resolve(srv));
        });

        const { port } = hdrServer.address();
        await runCLI([
            `http://127.0.0.1:${port}/sitemap.xml`,
            '--header', 'User-Agent: CliBot/1.0',
            '--header', 'X-Custom: hello',
        ]);
        hdrServer.close();
        assert('first header is sent', received['user-agent'] === 'CliBot/1.0', `ua=${received['user-agent']}`);
        assert('second header is sent', received['x-custom'] === 'hello', `x-custom=${received['x-custom']}`);
    }

    // --- Test 57: CLI --header without value exits non-zero ---
    console.log('\nTest 57: CLI - --header without value exits non-zero');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--header']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error says "requires a value"', stderr.includes('requires a value'), `stderr=${stderr}`);
    }

    // --- Test 58: CLI --header with invalid format exits non-zero ---
    console.log('\nTest 58: CLI - --header with invalid format exits non-zero');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--header', 'InvalidHeader']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error mentions format', stderr.includes('Name: Value'), `stderr=${stderr}`);
    }

    // --- Test 60: CLI --fields without --format exits non-zero ---
    console.log('\nTest 60: CLI - --fields without --format exits non-zero');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--fields', 'loc,lastmod']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error mentions --fields requires --format', stderr.includes('--fields') && stderr.includes('--format'), `stderr=${stderr}`);
    }

    // --- Test 61: CLI --fields without value exits non-zero ---
    console.log('\nTest 61: CLI - --fields without value exits non-zero');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--format', 'tsv', '--fields']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error says "requires a value"', stderr.includes('requires a value'), `stderr=${stderr}`);
    }

    // --- Test 62: CLI --format tsv --fields selects columns ---
    console.log('\nTest 62: CLI - --format tsv --fields selects columns');
    {
        const { code, stdout } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--format', 'tsv', '--fields', 'loc,lastmod']);
        assert('exits with code 0', code === 0, `code=${code}`);
        const lines = stdout.split('\n').slice(0, -1);
        assert('header has 2 columns', lines[0] === 'loc\tlastmod', `header=${JSON.stringify(lines[0])}`);
        const fields = lines[1].split('\t');
        assert('row has 2 columns', fields.length === 2, `fields=${JSON.stringify(fields)}`);
        assert('loc is correct', fields[0] === 'https://example.com/page1', `loc=${fields[0]}`);
        assert('lastmod is correct', fields[1] === '2024-01-01', `lastmod=${fields[1]}`);
    }

    // --- Test 63: CLI --format tsv --fields with extended attribute (image:image) ---
    console.log('\nTest 63: CLI - --format tsv --fields with image:image');
    {
        const { code, stdout } = await runCLI([`${BASE_URL}/sitemap_image.xml`, '--delay', '0', '--format', 'tsv', '--fields', 'loc,image:image']);
        assert('exits with code 0', code === 0, `code=${code}`);
        const lines = stdout.split('\n').slice(0, -1);
        assert('header has image:image column', lines[0] === 'loc\timage:image', `header=${JSON.stringify(lines[0])}`);
        const fields = lines[1].split('\t');
        assert('loc is correct', fields[0] === 'https://example.com/photo1', `loc=${fields[0]}`);
        let parsed;
        try { parsed = JSON.parse(fields[1]); } catch (e) { parsed = null; }
        assert('image:image is JSON stringified object', parsed !== null && typeof parsed === 'object', `value=${fields[1]}`);
        assert('image:image contains image:loc', parsed?.['image:loc'] === 'https://example.com/img/photo1.jpg');
    }

    // --- Test 64: CLI --format json without --fields outputs all attributes ---
    console.log('\nTest 64: CLI - --format json without --fields outputs all attributes');
    {
        const { code, stdout } = await runCLI([`${BASE_URL}/sitemap_image.xml`, '--delay', '0', '--format', 'json']);
        assert('exits with code 0', code === 0, `code=${code}`);
        const parsed = JSON.parse(stdout);
        assert('JSON has 1 entry', parsed.length === 1, `length=${parsed.length}`);
        assert('loc is present', parsed[0].loc === 'https://example.com/photo1');
        assert('lastmod is present', parsed[0].lastmod === '2024-06-01');
        assert('image:image is present', parsed[0]['image:image'] !== undefined, `keys=${Object.keys(parsed[0])}`);
    }

    // --- Test 65: CLI --format json --fields selects only specified fields ---
    console.log('\nTest 65: CLI - --format json --fields selects specified fields');
    {
        const { code, stdout } = await runCLI([`${BASE_URL}/sitemap_image.xml`, '--delay', '0', '--format', 'json', '--fields', 'loc,lastmod']);
        assert('exits with code 0', code === 0, `code=${code}`);
        const parsed = JSON.parse(stdout);
        assert('JSON has 1 entry', parsed.length === 1, `length=${parsed.length}`);
        assert('loc is present', parsed[0].loc === 'https://example.com/photo1');
        assert('lastmod is present', parsed[0].lastmod === '2024-06-01');
        assert('image:image is absent', !('image:image' in parsed[0]), `keys=${Object.keys(parsed[0])}`);
    }

    // --- Test 66: CLI --list-fields outputs standard fields ---
    console.log('\nTest 66: CLI - --list-fields outputs standard fields');
    {
        const { code, stdout, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--list-fields']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('no errors on stderr', !stderr.includes('Error:'), `stderr=${stderr}`);
        const lines = stdout.trim().split('\n');
        assert('loc is listed', lines.includes('loc'), `lines=${JSON.stringify(lines)}`);
        assert('lastmod is listed', lines.includes('lastmod'), `lines=${JSON.stringify(lines)}`);
        assert('changefreq is listed', lines.includes('changefreq'), `lines=${JSON.stringify(lines)}`);
        assert('priority is listed', lines.includes('priority'), `lines=${JSON.stringify(lines)}`);
    }

    // --- Test 67: CLI --list-fields includes extension fields (image:image) ---
    console.log('\nTest 67: CLI - --list-fields includes extension fields');
    {
        const { code, stdout, stderr } = await runCLI([`${BASE_URL}/sitemap_image.xml`, '--delay', '0', '--list-fields']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('no errors on stderr', !stderr.includes('Error:'), `stderr=${stderr}`);
        const lines = stdout.trim().split('\n');
        assert('loc is listed', lines.includes('loc'), `lines=${JSON.stringify(lines)}`);
        assert('image:image is listed', lines.includes('image:image'), `lines=${JSON.stringify(lines)}`);
    }

    // --- Test 68: CLI --list-fields with --filter (no matches) outputs nothing ---
    console.log('\nTest 68: CLI - --list-fields with --filter and no matches outputs nothing');
    {
        const { code, stdout, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--delay', '0', '--list-fields', '--filter', 'nomatch']);
        assert('exits with code 0', code === 0, `code=${code}`);
        assert('stdout is empty', stdout === '', `stdout=${JSON.stringify(stdout)}`);
        assert('no errors on stderr', !stderr.includes('Error:'), `stderr=${stderr}`);
    }

    // --- Test 69: CLI --list-fields with --filter (matching) outputs fields from matched entries ---
    console.log('\nTest 69: CLI - --list-fields with --filter outputs fields from matched entries');
    {
        const { code, stdout } = await runCLI([`${BASE_URL}/sitemap_image.xml`, '--delay', '0', '--list-fields', '--filter', 'photo1']);
        assert('exits with code 0', code === 0, `code=${code}`);
        const lines = stdout.trim().split('\n');
        assert('loc is listed', lines.includes('loc'), `lines=${JSON.stringify(lines)}`);
        assert('image:image is listed', lines.includes('image:image'), `lines=${JSON.stringify(lines)}`);
    }

    // --- Test 70: CLI --list-fields cannot be combined with --format ---
    console.log('\nTest 70: CLI - --list-fields + --format exits non-zero');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--list-fields', '--format', 'tsv']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error mentions --list-fields and --format', stderr.includes('--list-fields') && stderr.includes('--format'), `stderr=${stderr}`);
    }

    // --- Test 71: CLI --list-fields cannot be combined with --fields ---
    console.log('\nTest 71: CLI - --list-fields + --fields exits non-zero');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--list-fields', '--format', 'tsv', '--fields', 'loc']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
    }

    // --- Test 72: CLI --list-fields cannot be combined with --count ---
    console.log('\nTest 72: CLI - --list-fields + --count exits non-zero');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--list-fields', '--count']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error mentions --list-fields and --count', stderr.includes('--list-fields') && stderr.includes('--count'), `stderr=${stderr}`);
    }

    // --- Test 73: CLI --list-fields cannot be combined with --cap ---
    console.log('\nTest 73: CLI - --list-fields + --cap exits non-zero');
    {
        const { code, stderr } = await runCLI([`${BASE_URL}/sitemap_1.xml`, '--list-fields', '--cap', '5']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('error mentions --list-fields and --cap', stderr.includes('--list-fields') && stderr.includes('--cap'), `stderr=${stderr}`);
    }

    // --- Test 59: Extra attributes (e.g. image:image) are preserved in fetch() result ---
    console.log('\nTest 59: Extra XML attributes are preserved in SitemapEntry');
    {
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_image.xml`, { delay: 0 });
        const result = await parser.fetch();
        assert('returns 1 entry', result.length === 1, `length=${result.length}`);
        assert('loc is correct', result[0].loc === 'https://example.com/photo1');
        assert('lastmod is present', result[0].lastmod === '2024-06-01');
        assert('image:image attribute is preserved', result[0]['image:image'] !== undefined, `image:image=${JSON.stringify(result[0]['image:image'])}`);
    }

    // --- Summary ---
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`Results: ${passed + failed} tests, ${passed} passed, ${failed} failed`);
    if (failed === 0) {
        console.log('All tests passed!');
    }
    return failed;
}

(async () => {
    const server = await startServer();
    console.log(`Mock server started: ${BASE_URL}`);
    try {
        const failures = await runTests(server);
        process.exit(failures > 0 ? 1 : 0);
    } finally {
        server.close();
        const tmp = path.join(MOCK_DIR, 'sitemap_index_resolved.xml');
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
})();
