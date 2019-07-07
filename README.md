# sitemap-xml-parser

## installation

```
npm install sitemap-xml-parser
```

## note

This library was created using ES2017's async await function.
If you are using a lower than ES2017, it will not work well.

## example

```
const SitemapXMLParser = require('sitemap-xml-parser');

const url = 'something sitemap url';

/*
If sitemapindex (link of xml or gz file) is written in sitemap, the URL will be accessed.
You can optionally specify the number of concurrent accesses and the number of milliseconds after processing and access to resume processing after a delay.
*/

const options = {
    delay: 3000,
    limit: 5
};

const sitemapXMLParser = new SitemapXMLParser(url, options);

sitemapXMLParser.fetch().then(result => {
    console.log(result);
});


/*
  Returns

  {
    loc: [ --- ],
    lastmod: [ --- ],
    changefreq: [ --- ],
    priority: [ --- ]
  },
  {
    loc: [ --- ],
    lastmod: [ --- ],
    changefreq: [ --- ],
    priority: [ --- ]
  },
  ...
*/

```
