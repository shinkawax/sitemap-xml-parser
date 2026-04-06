'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
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
        assert('first loc is correct', result[0].loc[0] === 'https://example.com/page1');
        assert('lastmod is present', result[0].lastmod?.[0] === '2024-01-01');
        assert('changefreq is present', result[0].changefreq?.[0] === 'weekly');
        assert('priority is present', result[0].priority?.[0] === '0.8');
    }

    // --- Test 2: Sitemap index (multiple XMLs) ---
    console.log('\nTest 2: Sitemap index (sitemap_index.xml -> 2 files)');
    {
        prepareIndexXml();
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_index_resolved.xml`, { delay: 0, limit: 5 });
        const result = await parser.fetch();
        assert('total URL count from child sitemaps', result.length === 3, `length=${result.length}`);
        const locs = result.map(r => r.loc[0]);
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
        assert('page3 loc is correct', result[0].loc[0] === 'https://example.com/page3');
    }

    // --- Test 4: Default option values ---
    console.log('\nTest 4: Default option values');
    {
        const parser = new SitemapXMLParser(`${BASE_URL}/sitemap_1.xml`, {});
        assert('delayTime defaults to 3000', parser.delayTime === 3000);
        assert('limit defaults to 5', parser.limit === 5);
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
        const locs = result.map(r => r.loc[0]);
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
        assert('no errors on stderr', stderr === '', `stderr=${stderr}`);
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
        assert('no errors on stderr', stderr === '', `stderr=${stderr}`);
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
        assert('returned entry has correct loc', result[0].loc[0] === 'https://example.com/page1');
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
        assert('no errors on stderr', stderr === '', `stderr=${stderr}`);
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

    // --- Test 21: CLI exits with code 1 when onError is triggered ---
    console.log('\nTest 21: CLI - exits with code 1 when fetch encounters an error');
    {
        const { code, stdout, stderr } = await runCLI([`${BASE_URL}/does_not_exist.xml`, '--delay', '0']);
        assert('exits with non-zero code', code !== 0, `code=${code}`);
        assert('stdout is empty', stdout === '', `stdout=${stdout}`);
        assert('error is printed to stderr', stderr.includes(`${BASE_URL}/does_not_exist.xml`));
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
