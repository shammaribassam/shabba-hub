'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {handler:tiktokHandler,stopRoom}=require('./tiktok-server');
const {handler:kickHandler,stopRoom:stopKickRoom}=require('./kick-server');
const root=__dirname,port=Number(process.env.PORT||3000),rooms=new Map();
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.mp3':'audio/mpeg','.txt':'text/plain; charset=utf-8'};
const roomPattern=/^[a-f0-9-]{36}$/i;
function send(res,status,body,type='text/plain; charset=utf-8'){res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body)}
function json(res,status,obj){send(res,status,JSON.stringify(obj),'application/json; charset=utf-8')}
function readJSON(req,max=1000000){return new Promise((resolve,reject)=>{let parts=[],n=0;req.on('data',b=>{n+=b.length;if(n>max){reject(Error('Payload too large'));req.destroy()}else parts.push(b)});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')))}catch{reject(Error('Invalid JSON'))}});req.on('error',reject)})}
function getRoom(url){const id=url.searchParams.get('room')||'';return roomPattern.test(id)?rooms.get(id):null}
function authorized(req,room){const a=req.headers['x-room-token'];return !!room&&typeof a==='string'&&a.length===room.token.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(room.token))}
function emit(room,event){for(const client of room.clients){try{client.write('data: '+JSON.stringify(event)+'\n\n')}catch{room.clients.delete(client)}}}
setInterval(()=>{const now=Date.now();for(const [id,room] of rooms){if(now-room.touched>24*3600e3){for(const c of room.clients)c.end();stopRoom(id);stopKickRoom(id);rooms.delete(id)}}},3600e3).unref();
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/health')return send(res,200,'ok');
 if(url.pathname==='/api/rooms'&&req.method==='POST'){
  try{const x=await readJSON(req,1000),id=String(x.room||''),token=String(x.token||'');if(!roomPattern.test(id)||!/^[a-f0-9]{64}$/i.test(token))return json(res,400,{error:'Invalid room'});
   const existing=rooms.get(id);if(existing){if(!authorized({headers:{'x-room-token':token}},existing))return json(res,403,{error:'Room belongs to another host'});existing.touched=Date.now();return json(res,200,{ok:true})}
   if(rooms.size>=500)return json(res,503,{error:'Room capacity reached'});
   rooms.set(id,{token,snapshot:null,clients:new Set(),touched:Date.now()});return json(res,201,{ok:true});
  }catch(e){return json(res,400,{error:e.message})}
 }
 if(url.pathname==='/api/events'&&req.method==='GET'){
  const room=getRoom(url);if(!room)return json(res,404,{error:'Room not found'});
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
  room.clients.add(res);res.write(': connected\n\n');if(room.snapshot)res.write('data: '+JSON.stringify({...room.snapshot,chat:[],correct:room.snapshot.revealed?room.snapshot.correct:-1})+'\n\n');
  const keepalive=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},25000);
  req.on('close',()=>{clearInterval(keepalive);room.clients.delete(res)});return;
 }
 if(url.pathname==='/api/state'&&req.method==='POST'){
  const room=getRoom(url);if(!authorized(req,room))return json(res,403,{error:'Room access denied'});
  try{const data=await readJSON(req);if(!data||typeof data.category!=='string')return json(res,400,{error:'Invalid state'});
   room.snapshot=data;room.touched=Date.now();emit(room,{...data,correct:data.revealed?data.correct:-1});return json(res,200,{ok:true});
  }catch(e){return json(res,400,{error:e.message})}
 }
 if(tiktokHandler(req,res,url,{getRoom,authorized,send,json,readJSON}))return;
 if(kickHandler(req,res,url,{getRoom,authorized,send,json,readJSON}))return;
 if(req.method!=='GET')return send(res,405,'Method not allowed');
 let rel;try{rel=decodeURIComponent(url.pathname)}catch{return send(res,400,'Bad path')}
 if(rel==='/')rel='/index.html';if(!/^\/[\w.\/-]+$/.test(rel)||rel.includes('..'))return send(res,403,'Forbidden');
 const file=path.join(root,rel);if(!file.startsWith(root+path.sep))return send(res,403,'Forbidden');
 fs.readFile(file,(err,buf)=>err?send(res,404,'Not found'):send(res,200,buf,types[path.extname(file)]||'application/octet-stream'));
}).listen(port,'0.0.0.0',()=>console.log('Diwan cloud running on '+port));
