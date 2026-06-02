const { createServer: createHttpsServer } = require('https');
const { createServer: createHttpServer } = require('http');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const path = require('path');

const dev = false;
const hostname = '0.0.0.0';
const httpPort = 3000;
const httpsPort = 3443;

const app = next({ dev, hostname, port: httpPort });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  /* HTTP 服务器（3000 端口） */
  createHttpServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('HTTP Error:', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  }).listen(httpPort, hostname, () => {
    console.log(`> HTTP  ready on http://${hostname}:${httpPort}`);
  });

  /* HTTPS 服务器（3443 端口） */
  try {
    const options = {
      key: fs.readFileSync(path.join(__dirname, 'key.pem')),
      cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
    };
    createHttpsServer(options, async (req, res) => {
      try {
        const parsedUrl = parse(req.url, true);
        await handle(req, res, parsedUrl);
      } catch (err) {
        console.error('HTTPS Error:', req.url, err);
        res.statusCode = 500;
        res.end('internal server error');
      }
    }).listen(httpsPort, hostname, () => {
      console.log(`> HTTPS ready on https://${hostname}:${httpsPort}`);
    });
  } catch (err) {
    console.error('Failed to start HTTPS server:', err.message);
  }
});
