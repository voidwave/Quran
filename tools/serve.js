/**
 * Minimal static file server for local development.
 *
 * The app fetches its XML files, so it has to be served over HTTP; opening
 * index.html straight from the file system does not work in most browsers.
 *
 * Usage:
 *     node tools/serve.js [port]
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.argv[2]) || 8123;

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2'
};

http.createServer(function (request, response) {
    const urlPath = decodeURIComponent(request.url.split('?')[0]);
    const filePath = path.join(root, urlPath === '/' ? 'index.html' : urlPath);

    if (!filePath.startsWith(root)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
    }

    fs.readFile(filePath, function (error, data) {
        if (error) {
            response.writeHead(404);
            response.end('Not found: ' + urlPath);
            return;
        }
        response.writeHead(200, {
            'Content-Type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
        });
        response.end(data);
    });
}).listen(port, function () {
    console.log('Serving ' + root + ' on http://localhost:' + port);
});
