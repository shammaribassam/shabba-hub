
'use strict';
// Unified host for Diwan and Quiz.
// One Kick webhook distributes events to both games.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const majlis = require('./majlis');
const arcade = require('./arcade');

const port = Number(process.env.PORT || 3000);
const root = __dirname;

const games = {
  diwan: {
    folder: 'diwan',
    port: 4101,
    name: 'ديوان أبو البسم'
  },
  quiz: {
    folder: 'quiz',
    port: 4102,
    name: 'تحديات أبو البسم'
  }
};

const children = [];
let shuttingDown = false;

const hop = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  if (res.headersSent) {
    res.end();
    return;
  }

  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function shim(prefix) {
  return '<script data-bsm-namespace>(function(){'
    + 'var p=' + JSON.stringify(prefix) + ';'
    + 'var oldFetch=window.fetch.bind(window);'
    + 'window.fetch=function(input,opts){'
    + 'if(typeof input==="string" && input.indexOf("/api/")===0) input=p+input;'
    + 'else if(typeof Request!=="undefined" && input instanceof Request){'
    + 'var url=new URL(input.url);'
    + 'if(url.origin===location.origin && url.pathname.indexOf("/api/")===0){'
    + 'url.pathname=p+url.pathname;input=new Request(url.toString(),input);}}'
    + 'return oldFetch(input,opts);};'
    + 'var OldEventSource=window.EventSource;'
    + 'if(OldEventSource){window.EventSource=class extends OldEventSource{'
    + 'constructor(url,config){super(typeof url==="string" && url.indexOf("/api/")===0?p+url:url,config);}};}'
    + '})();</script>';
}

function decorate(html, slug) {
  let result = String(html);

  if (slug === 'quiz') {
    result = result.replaceAll(
      'شبّة أبو البسم',
      'تحديات أبو البسم'
    );
  }

  const extra = shim('/' + slug);

  if (/<head\b[^>]*>/i.test(result)) {
    result = result.replace(/<head\b[^>]*>/i, m => m + extra);
  } else {
    result = extra + result;
  }

  const home = '<a href="/" style="position:fixed;bottom:14px;left:14px;z-index:99999;'
    + 'padding:10px 15px;border-radius:12px;background:#1a1713;color:#f3d9a1;'
    + 'text-decoration:none;border:1px solid #b58b49;font:14px system-ui,sans-serif">'
    + '⌂ عالم أبو البسم</a>';

  if (/<\/body>/i.test(result)) {
    result = result.replace(/<\/body>/i, home + '</body>');
  } else {
    result += home;
  }

  return result;
}

// Start the two independent game servers.
for (const [slug, game] of Object.entries(games)) {
  const location = path.join(
    root,
    'games',
    game.folder,
    'server.js'
  );

  if (!fs.existsSync(location)) {
    console.warn(
      'Missing ' + slug +
      ' files: run GitHub Actions import-original-games'
    );
    continue;
  }

  const child = spawn(process.execPath, [location], {
    cwd: path.dirname(location),
    env: {
      ...process.env,
      PORT: String(game.port)
    },
    stdio: 'inherit'
  });

  children.push(child);

  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(
        slug + ' exited: ' + (code || signal)
      );
    }
  });
}

// Forward ordinary game requests.
function proxy(req, res, slug) {
  const game = games[slug];

  let target = req.url.slice(slug.length + 1);

  if (!target || target.charAt(0) !== '/') {
    target = '/' + target;
  }

  const headers = {
    ...req.headers,
    host: '127.0.0.1:' + game.port
  };

  for (const key of hop) {
    delete headers[key];
  }

  const upstream = http.request({
    host: '127.0.0.1',
    port: game.port,
    path: target,
    method: req.method,
    headers
  }, response => {
    const outgoing = { ...response.headers };

    for (const key of hop) {
      delete outgoing[key];
    }

    if (!/text\/html/i.test(
      String(outgoing['content-type'] || '')
    )) {
      res.writeHead(
        response.statusCode || 502,
        outgoing
      );
      response.pipe(res);
      return;
    }

    const chunks = [];
    let length = 0;

    response.on('data', part => {
      length += part.length;

      if (length > 5000000) {
        response.destroy();
        return;
      }

      chunks.push(part);
    });

    response.on('end', () => {
      if (res.writableEnded) return;

      const modified = decorate(
        Buffer.concat(chunks).toString('utf8'),
        slug
      );

      delete outgoing['content-length'];
      delete outgoing['content-encoding'];
      delete outgoing.etag;

      res.writeHead(response.statusCode || 200, {
        ...outgoing,
        'Cache-Control': 'no-store'
      });

      res.end(modified);
    });
  });

  upstream.on('error', () => {
    send(res, 503, 'المجلس غير جاهز بعد: ' + game.name);
  });

  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

// Read the original Kick request body without modifying it.
// Kick's signature verification depends on these exact bytes.
function readWebhookBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;

    req.on('data', chunk => {
      size += chunk.length;

      if (size > 65536) {
        failed = true;
        reject(new Error('Webhook payload too large'));
        req.resume();
        return;
      }

      if (!failed) chunks.push(chunk);
    });

    req.on('end', () => {
      if (!failed) {
        resolve(Buffer.concat(chunks));
      }
    });

    req.on('error', reject);
    req.on('aborted', () => {
      reject(new Error('Webhook request aborted'));
    });
  });
}

// Send the same signed Kick event to one game.
// Each game's existing kick-server.js verifies the signature.
function deliverKick(game, originalHeaders, body) {
  return new Promise(resolve => {
    const headers = {
      ...originalHeaders,
      host: '127.0.0.1:' + game.port,
      'content-length': String(body.length)
    };

    for (const key of hop) {
      delete headers[key];
    }

    const request = http.request({
      hostname: '127.0.0.1',
      port: game.port,
      path: '/api/kick/webhook',
      method: 'POST',
      headers,
      timeout: 12000
    }, response => {
      response.resume();

      response.on('end', () => {
        resolve({
          status: response.statusCode || 502,
          ok: response.statusCode >= 200 &&
              response.statusCode < 300
        });
      });

      response.on('error', () => {
        resolve({ status: 502, ok: false });
      });
    });

    request.on('timeout', () => {
      request.destroy();
    });

    request.on('error', () => {
      resolve({ status: 503, ok: false });
    });

    request.end(body);
  });
}

// Single public webhook for BOTH games.
async function unifiedKickWebhook(req, res) {
  if (req.method !== 'POST') {
    return send(res, 405, 'Method not allowed');
  }

  try {
    const body = await readWebhookBody(req);

    // Validate Kick's RSA signature here before any arcade command is accepted.
    // This keeps the arcade independent of the other two game servers.
    let accepted;
    try { accepted = await arcade.chat.acceptKick(req, body); }
    catch (error) {
      console.error('Kick verification unavailable:', error.message);
      return send(res, 503, JSON.stringify({error:'Kick verification unavailable'}), 'application/json; charset=utf-8');
    }
    if (!accepted.ok) {
      return send(res, accepted.status || 401, JSON.stringify({error:'Kick signature rejected'}), 'application/json; charset=utf-8');
    }

    const results = await Promise.all(
      Object.entries(games).map(async ([slug, game]) => {
        const result = await deliverKick(game, req.headers, body);
        return { slug, ...result };
      })
    );

    console.log(
      'Kick webhook delivery:',
      results.map(x => x.slug + '=' + x.status).join(', ')
    );

    if (results.every(x => x.ok)) {
      return send(
        res,
        200,
        JSON.stringify({ ok: true }),
        'application/json; charset=utf-8'
      );
    }

    const rejected = results.find(
      x => x.status === 400 || x.status === 401
    );

    if (rejected) {
      return send(
        res,
        rejected.status,
        JSON.stringify({ error: 'Kick webhook rejected' }),
        'application/json; charset=utf-8'
      );
    }

    return send(
      res,
      503,
      JSON.stringify({ error: 'Game delivery unavailable' }),
      'application/json; charset=utf-8'
    );

  } catch (error) {
    console.error('Kick webhook error:', error.message);

    return send(
      res,
      503,
      JSON.stringify({ error: 'Webhook unavailable' }),
      'application/json; charset=utf-8'
    );
  }
}


// Main public server.
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/api/arcade/')) {
    arcade.handle(req,res,url).catch(error=>{console.error('Arcade error:',error);if(!res.headersSent)send(res,500,JSON.stringify({error:'خطأ في الألعاب'}),'application/json; charset=utf-8');});
    return;
  }
  if (url.pathname === '/arcade.html' && req.method === 'GET') {
    return fs.readFile(path.join(root,'arcade.html'),(err,data)=>err?send(res,500,'Arcade unavailable'):send(res,200,data,'text/html; charset=utf-8'));
  }
  if (url.pathname.startsWith('/api/majlis/')) {
    majlis.handle(req, res, url).catch(error => {
      console.error('Majlis request error:', error.message);
      if (!res.headersSent) send(res, 500, JSON.stringify({error:'خطأ في غرفة المجلس'}), 'application/json; charset=utf-8');
      else res.end();
    });
    return;
  }

  if (url.pathname === '/majlis.html' && req.method === 'GET') {
    return fs.readFile(path.join(root, 'majlis.html'), (err, data) => {
      if (err) return send(res, 500, 'Majlis page unavailable');
      return send(res, 200, data, 'text/html; charset=utf-8');
    });
  }

  // IMPORTANT: Kick uses this ONE public endpoint.
  if (url.pathname === '/api/kick/webhook') {
    return unifiedKickWebhook(req, res);
  }

  // Public catalog only. No payment or purchase-grant endpoints exist.
  if (url.pathname === '/api/catalog' && req.method === 'GET') {
    return fs.readFile(path.join(root, 'game-catalog.json'), 'utf8', (err, data) => {
      if (err) return send(res, 503, JSON.stringify({error:'Catalog unavailable'}), 'application/json; charset=utf-8');
      return send(res, 200, data, 'application/json; charset=utf-8');
    });
  }

  if (url.pathname === '/api/commerce/status' && req.method === 'GET') {
    return send(res, 200, JSON.stringify({
      purchaseModel: 'one_time_per_game',
      paymentsEnabled: false,
      donationsEnabled: false,
      checkoutAvailable: false,
      note: 'Payment activation requires owner approval, verified accounts and a secure payment provider.'
    }), 'application/json; charset=utf-8');
  }

  // No client-side purchase or entitlement grants before verified billing integration.
  if (url.pathname.startsWith('/api/commerce/') || url.pathname.startsWith('/api/purchases/')) {
    return send(res, 403, JSON.stringify({error:'Purchases are not enabled'}), 'application/json; charset=utf-8');
  }

  if (url.pathname === '/health') {
    const status = {};

    for (const [slug, game] of Object.entries(games)) {
      status[slug] = fs.existsSync(
        path.join(
          root,
          'games',
          game.folder,
          'server.js'
        )
      );
    }

    return send(
      res,
      200,
      JSON.stringify({
        ok: true,
        filesPresent: status
      }),
      'application/json; charset=utf-8'
    );
  }

  if (url.pathname === '/') {
    return fs.readFile(
      path.join(root, 'index.html'),
      (err, data) => {
        if (err) {
          return send(res, 500, 'Missing homepage');
        }

        return send(
          res,
          200,
          data,
          'text/html; charset=utf-8'
        );
      }
    );
  }

  // Google Search Console HTML ownership verification.
  if (req.method === 'GET' && url.pathname === '/google549c25f28aed3b9b.html') {
    return fs.readFile(path.join(root, 'google549c25f28aed3b9b.html'), (err, data) => {
      if (err) return send(res, 404, 'Verification file not found');
      return send(res, 200, data, 'text/html; charset=utf-8');
    });
  }

  if (url.pathname === '/robots.txt') {
    return send(res, 200,
      'User-agent: *\\nAllow: /\\nDisallow: /diwan/api/\\nDisallow: /quiz/api/\\nSitemap: https://shabba-hub.onrender.com/sitemap.xml\\n',
      'text/plain; charset=utf-8');
  }

  if (url.pathname === '/sitemap.xml') {
    return send(res, 200,
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      '<url><loc>https://shabba-hub.onrender.com/</loc></url>' +
      '</urlset>',
      'application/xml; charset=utf-8');
  }

  if (url.pathname === '/favicon.ico') {
    return send(res, 204, '');
  }

  const match = url.pathname.match(
    /^\/(diwan|quiz)(?:\/|$)/
  );

  if (match) {
    return proxy(req, res, match[1]);
  }

  return send(res, 404, 'الصفحة غير موجودة');
});

server.listen(port, '0.0.0.0', () => {
  console.log('Shabba unified hub on ' + port);
  console.log(
    'Unified Kick webhook: /api/kick/webhook'
  );
});

function shutdown() {
  if (shuttingDown) return;

  shuttingDown = true;

  for (const child of children) {
    child.kill('SIGTERM');
  }

  server.close(() => process.exit(0));

  setTimeout(() => process.exit(0), 2500).unref();
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
