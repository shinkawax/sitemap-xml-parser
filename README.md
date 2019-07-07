# sitemap-xml-parser

## installation

```
npm install sitemap-xml-parser
```

## example

```
const SitemapXMLParser = require('sitemap-xml-parser');

const url = 'something sitemap url';
const options = {
    delay: 3000,
    limit: 5
};

const sitemapXMLParser = new SitemapXMLParser(url, options);

sitemapXMLParser.fetch().then(result => {
    console.log(result);
});
```
