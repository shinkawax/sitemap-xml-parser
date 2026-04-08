export interface SitemapEntry {
    loc: string[];
    lastmod?: string[];
    changefreq?: string[];
    priority?: string[];
}

export interface SitemapOptions {
    delay?: number;
    limit?: number;
    timeout?: number;
    onError?: (url: string, error: Error) => void;
    onEntry?: (entry: SitemapEntry) => void;
}

export default class SitemapXMLParser {
    constructor(url: string, options?: SitemapOptions);
    fetch(): Promise<SitemapEntry[]>;
}
