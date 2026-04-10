'use strict';

const http = require('http');
const https = require('https');
const xml2js = require('xml2js');
const path = require('path');
const zlib = require('zlib');
const { URL } = require('url');

class SitemapXMLParser {
    constructor(url, options = {}) {
        this.siteMapUrl = url;
        this.delayTime = options.delay ?? 1000;
        this.limit = options.limit ?? 10;
        this.timeout = options.timeout ?? 30000;
        this.cap = options.cap ?? Infinity;
        this.headers = options.headers ?? {};
        this.onError = options.onError || null;
        this.onEntry = options.onEntry || null;
        this.urlArray = [];
        this._aborted = false;
        this.parser = new xml2js.Parser({ explicitArray: false });
    }

    abort() {
        this._aborted = true;
    }

    async fetch() {
        this._aborted = false;
        this.urlArray = [];
        const indexBody = await this.getBodyFromURL(this.siteMapUrl);
        if (indexBody === null) return this.urlArray;
        const indexXML = await this.executeParseXml(this.siteMapUrl, indexBody);
        if (indexXML === null) return this.urlArray;
        await this.getURLFromXML(indexXML);
        if (this.urlArray.length > this.cap) this.urlArray.length = this.cap;
        return this.urlArray;
    }

    /**
     * Collect URLs from parsed XML.
     * If the XML is a sitemap index, follow each child sitemap.
     */
    async getURLFromXML(xml) {
        if (xml.sitemapindex && xml.sitemapindex.sitemap) {
            const sitemapList = [].concat(xml.sitemapindex.sitemap);
            const urls = sitemapList.map(s => s.loc).filter(Boolean);

            for (let i = 0; i < urls.length; i += this.limit) {
                if (this.urlArray.length >= this.cap || this._aborted) break;
                const chunk = urls.slice(i, i + this.limit);
                await Promise.all(
                    chunk.map(async (url) => {
                        const body = await this.getBodyFromURL(url);
                        if (body === null) return;
                        if (this.urlArray.length >= this.cap || this._aborted) return;
                        const sitemapData = await this.executeParseXml(url, body);
                        if (sitemapData === null) return;
                        if (this.urlArray.length >= this.cap || this._aborted) return;
                        await this.getURLFromXML(sitemapData);
                    })
                );
                if (this._aborted) break;
                if (i + this.limit < urls.length) {
                    await this._delay(this.delayTime);
                }
            }
        }

        if (xml.urlset && xml.urlset.url) {
            const urlList = [].concat(xml.urlset.url);
            for (const entry of urlList) {
                if (entry && entry.loc) {
                    if (this.urlArray.length >= this.cap || this._aborted) break;
                    this.urlArray.push(entry);
                    if (this.onEntry) this.onEntry(entry);
                }
            }
        }
    }

    /**
     * Fetch body from a URL.
     * Only http:// and https:// are supported.
     * Follows redirects up to 5 times, decompresses gzip automatically.
     * Returns null and calls onError on failure.
     */
    getBodyFromURL(url) {
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            this._handleError(url, new Error(`Unsupported protocol: ${url}`));
            return Promise.resolve(null);
        }
        return this._fetchWithRedirect(url, url, 0);
    }

    _fetchWithRedirect(originalUrl, currentUrl, redirectCount, headers = this.headers) {
        return new Promise((resolve) => {
            let settled = false;
            const failOnce = (url, err) => {
                if (settled) return;
                settled = true;
                this._handleError(url, err);
                resolve(null);
            };

            let parsedUrl;
            try {
                parsedUrl = new URL(currentUrl);
            } catch (err) {
                failOnce(originalUrl, err);
                return;
            }

            const ext = path.extname(parsedUrl.pathname);
            const transport = parsedUrl.protocol === 'https:' ? https : http;

            const req = transport.get(currentUrl, { headers }, (res) => {
                const REDIRECT_CODES = [301, 302, 303, 307, 308];
                if (REDIRECT_CODES.includes(res.statusCode)) {
                    res.resume();
                    const location = res.headers['location'];
                    if (!location) {
                        failOnce(originalUrl, new Error(`HTTP ${res.statusCode} with no Location header`));
                        return;
                    }
                    if (redirectCount >= 5) {
                        failOnce(originalUrl, new Error('Too many redirects (max 5)'));
                        return;
                    }
                    settled = true;
                    const nextUrl = new URL(location, currentUrl).href;
                    const sameOrigin = new URL(nextUrl).origin === new URL(currentUrl).origin;
                    resolve(this._fetchWithRedirect(originalUrl, nextUrl, redirectCount + 1, sameOrigin ? this.headers : {}));
                    return;
                }

                if (res.statusCode < 200 || res.statusCode >= 300) {
                    res.resume();
                    failOnce(originalUrl, new Error(`HTTP ${res.statusCode}`));
                    return;
                }
                const chunks = [];
                const contentEncoding = res.headers['content-encoding'];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    const buf = Buffer.concat(chunks);
                    if (ext === '.gz' || contentEncoding === 'gzip') {
                        zlib.gunzip(buf, (err, result) => {
                            if (err) {
                                failOnce(originalUrl, err);
                            } else {
                                settled = true;
                                resolve(result.toString());
                            }
                        });
                    } else {
                        settled = true;
                        resolve(buf.toString());
                    }
                });
                res.on('error', (err) => {
                    failOnce(originalUrl, err);
                });
            });

            req.setTimeout(this.timeout, () => {
                req.destroy(new Error(`Timeout after ${this.timeout}ms`));
            });

            req.on('error', (err) => {
                failOnce(originalUrl, err);
            });
        });
    }

    /**
     * Parse XML string. Returns null and calls onError on parse failure.
     */
    executeParseXml(url, xml) {
        return new Promise((resolve) => {
            this.parser.parseString(xml, (err, result) => {
                if (err) {
                    this._handleError(url, err);
                    resolve(null);
                } else {
                    resolve(result);
                }
            });
        });
    }

    _handleError(url, err) {
        if (this.onError) this.onError(url, err);
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = SitemapXMLParser;
