'use strict';
// Independent unified host. Original source repositories are not modified.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');

const port = Number(process.env.PORT || 3000);
const root = __dirname;
const games = {diwan:{folder:'diwan',port:4101,name:'ديوان أبو البسم'},
               quiz:{folder:'quiz',port:4102,name:'تحديات أبو البسم'}};
const children = [];
let shuttingDown = false;
const hop = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);

function send(res,status,body,type='text/plain; charset=utf-8'){
  if (res.headersSent) {res.end();return;}
  res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);
}
function shim(prefix){
  return '<script data-bsm-namespace>(function(){'
    + 'var p='+JSON.stringify(prefix)+';'
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
function decorate(html,slug){
  let result = String(html);
  if(slug==='quiz')result=result.replaceAll('شبّة أبو البسم','تحديات أبو البسم');
  const extra=shim('/'+slug);
  if(/<head\b[^>]*>/i.test(result)) result=result.replace(/<head\b[^>]*>/i,m=>m+extra);
  else result=extra+result;
  const home='<a href="/" style="position:fixed;bottom:14px;left:14px;z-index:99999;'
    +'padding:10px 15px;border-radius:12px;background:#1a1713;color:#f3d9a1;'
    +'text-decoration:none;border:1px solid #b58b49;font:14px system-ui,sans-serif">'
    +'⌂ شبّة أبو البسم</a>';
  if(/<\/body>/i.test(result))result=result.replace(/<\/body>/i,home+'</body>');
  else result+=home;
  return result;
}
for(const [slug,game] of Object.entries(games)){
  const location=path.join(root,'games',game.folder,'server.js');
  if(!fs.existsSync(location)){
    console.warn('Missing '+slug+' files: run GitHub Actions import-original-games');
    continue;
  }
  const child=spawn(process.execPath,[location],{
    cwd:path.dirname(location),env:{...process.env,PORT:String(game.port)},stdio:'inherit'
  });
  children.push(child);
  child.on('exit',(code,signal)=>{if(!shuttingDown)console.error(slug+' exited: '+(code||signal));});
}
function proxy(req,res,slug){
  const game=games[slug];
  let target=req.url.slice(slug.length+1);
  if(!target || target.charAt(0)!=='/') target='/'+target;
  const headers={...req.headers,host:'127.0.0.1:'+game.port};
  for(const key of hop)delete headers[key];
  const upstream=http.request({host:'127.0.0.1',port:game.port,path:target,method:req.method,headers},response=>{
    const outgoing={...response.headers};
    for(const key of hop)delete outgoing[key];
    if(!/text\/html/i.test(String(outgoing['content-type']||''))){
      res.writeHead(response.statusCode||502,outgoing);response.pipe(res);return;
    }
    const chunks=[];let length=0;
    response.on('data',part=>{
      length+=part.length;
      if(length>5000000){response.destroy();return;}
      chunks.push(part);
    });
    response.on('end',()=>{
      if(res.writableEnded)return;
      const modified=decorate(Buffer.concat(chunks).toString('utf8'),slug);
      delete outgoing['content-length'];delete outgoing['content-encoding'];delete outgoing.etag;
      res.writeHead(response.statusCode||200,{...outgoing,'Cache-Control':'no-store'});res.end(modified);
    });
  });
  upstream.on('error',()=>send(res,503,'المجلس غير جاهز بعد: '+game.name));
  req.on('aborted',()=>upstream.destroy());
  req.pipe(upstream);
}
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/health'){
    const status={};
    for(const [slug,game] of Object.entries(games))status[slug]=fs.existsSync(path.join(root,'games',game.folder,'server.js'));
    return send(res,200,JSON.stringify({ok:true,filesPresent:status}),'application/json; charset=utf-8');
  }
  if(url.pathname==='/')return fs.readFile(path.join(root,'index.html'),(err,data)=>
    err?send(res,500,'Missing homepage'):send(res,200,data,'text/html; charset=utf-8'));
  if(url.pathname==='/favicon.ico')return send(res,204,'');
  const match=url.pathname.match(/^\/(diwan|quiz)(?:\/|$)/);
  if(match)return proxy(req,res,match[1]);
  return send(res,404,'الصفحة غير موجودة');
});
server.listen(port,'0.0.0.0',()=>console.log('Shabba unified hub on '+port));
function shutdown(){
  if(shuttingDown)return;
  shuttingDown=true;
  for(const child of children)child.kill('SIGTERM');
  server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2500).unref();
}
process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
