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
        this.onError = options.onError || null;
        this.onEntry = options.onEntry || null;
        this.urlArray = [];
        this.parser = new xml2js.Parser({ explicitArray: false });
    }

    async fetch() {
        this.urlArray = [];
        const indexBody = await this.getBodyFromURL(this.siteMapUrl);
        if (indexBody === null) return this.urlArray;
        const indexXML = await this.executeParseXml(this.siteMapUrl, indexBody);
        if (indexXML === null) return this.urlArray;
        await this.getURLFromXML(indexXML);
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
                const chunk = urls.slice(i, i + this.limit);
                await Promise.all(
                    chunk.map(async (url) => {
                        const body = await this.getBodyFromURL(url);
                        if (body === null) return;
                        const sitemapData = await this.executeParseXml(url, body);
                        if (sitemapData === null) return;
                        await this.getURLFromXML(sitemapData);
                    })
                );
                if (i + this.limit < urls.length) {
                    await this._delay(this.delayTime);
                }
            }
        }

        if (xml.urlset && xml.urlset.url) {
            const urlList = [].concat(xml.urlset.url);
            for (const entry of urlList) {
                if (entry && entry.loc) {
                    this.urlArray.push(entry);
                    if (this.onEntry) this.onEntry(entry);
                }
            }
        }
    }

    /**
     * Fetch body from URL using http/https.
     * Follows redirects (301/302/303/307/308) up to 5 times.
     * Decompresses gzip automatically when the URL ends with .gz.
     * Returns null and calls onError on failure.
     */
    getBodyFromURL(url) {
        return this._fetchWithRedirect(url, url, 0);
    }

    _fetchWithRedirect(originalUrl, currentUrl, redirectCount) {
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

            const req = transport.get(currentUrl, (res) => {
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
                    resolve(this._fetchWithRedirect(originalUrl, nextUrl, redirectCount + 1));
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
