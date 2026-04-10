export interface SitemapEntry {
    loc: string;
    lastmod?: string;
    changefreq?: string;
    priority?: string;
}

export interface SitemapOptions {
    delay?: number;
    limit?: number;
    timeout?: number;
    cap?: number;
    headers?: Record<string, string>;
    onError?: (url: string, error: Error) => void;
    onEntry?: (entry: SitemapEntry) => void;
}

export default class SitemapXMLParser {
    constructor(url: string, options?: SitemapOptions);
    fetch(): Promise<SitemapEntry[]>;
    abort(): void;
}
