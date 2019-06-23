const SitemapXMLParser = require('./sitemap.js')

if (!process.argv[2]) {
    console.error('サイトマップのURLが指定されていません');
}

const url = process.argv[2];
const options = {
    delay: 3000,
    limit: 5
};
const sitemapXMLParser = new SitemapXMLParser(url, options);
sitemapXMLParser.fetch().then(result => {
    console.log(result);
});

// (async () => {
//     const uri = process.argv[2];
//     const option = {
//         delay: 3000,
//         limit: 5
//     };
//     const result = await new SitemapXMLParser(uri, option).fetch();
//     console.log(result);
// })();