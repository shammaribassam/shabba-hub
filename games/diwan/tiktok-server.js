'use strict';
const {TikTokLiveConnection}=require('tiktok-live-connector');
const sessions=new Map();
function get(id){if(!sessions.has(id))sessions.set(id,{connection:null,status:'غير متصل',channel:'',listeners:new Set()});return sessions.get(id)}
function broadcast(s,event){for(const r of s.listeners){try{r.write('data: '+JSON.stringify(event)+'\n\n')}catch{s.listeners.delete(r)}}}
function status(s){broadcast(s,{type:'status',status:s.status,channel:s.channel})}
function stopRoom(id){const s=sessions.get(id);if(!s)return;const old=s.connection;s.connection=null;s.channel='';s.status='غير متصل';if(old){try{old.disconnect()}catch{}}status(s)}
async function start(id,username){if(!/^[\w.]{2,32}$/.test(username))throw Error('اسم مستخدم غير صالح');stopRoom(id);const s=get(id);s.channel=username;s.status='جارٍ الاتصال';status(s);
 const conn=new TikTokLiveConnection(username,{processInitialData:false});s.connection=conn;
 conn.on('chat',data=>{if(s.connection!==conn)return;const user=data.user||data.userInfo?.user||data.userInfo||data.userDetails||data.content?.user||{};const name=data.uniqueId||user.uniqueId||user.unique_id||user.username||user.nickname||data.nickname||data.userId||'مشارك';const msg=data.comment||data.text||data.message||(typeof data.content==='string'?data.content:data.content?.text);if(typeof msg==='string'&&msg.trim())broadcast(s,{type:'chat',name,msg:msg.trim(),platform:'tiktok'})});
 conn.on('error',err=>{if(s.connection===conn){s.status='خطأ: '+String(err.message||err).slice(0,140);status(s)}});
 try{await conn.connect();if(s.connection===conn){s.status='متصل ببث @'+username;status(s)}}catch(err){if(s.connection===conn){s.status='تعذر الاتصال: '+String(err.message||err).slice(0,140);status(s)}throw err}
}
function handler(req,res,url,{getRoom,authorized,json,readJSON}){
 if(!url.pathname.startsWith('/api/tiktok/'))return false;
 const room=getRoom(url);if(!room){json(res,404,{error:'Room not found'});return true}
 const id=url.searchParams.get('room'),s=get(id);
 if(url.pathname==='/api/tiktok/events'&&req.method==='GET'){
  if(!authorized({headers:{'x-room-token':url.searchParams.get('token')||''}},room)){json(res,403,{error:'Room access denied'});return true}
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});s.listeners.add(res);res.write('data: '+JSON.stringify({type:'status',status:s.status,channel:s.channel})+'\n\n');const ping=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},25000);req.on('close',()=>{clearInterval(ping);s.listeners.delete(res)});return true;
 }
 if(!['/api/tiktok/connect','/api/tiktok/disconnect'].includes(url.pathname))return false;
 if(req.method!=='POST'){json(res,405,{error:'Method not allowed'});return true}
 if(!authorized(req,room)){json(res,403,{error:'Room access denied'});return true}
 if(url.pathname.endsWith('disconnect')){stopRoom(id);json(res,200,{ok:true});return true}
 readJSON(req,1000).then(async body=>{try{await start(id,String(body.username||'').replace(/^@/,'').trim());room.touched=Date.now();json(res,200,{ok:true,status:s.status})}catch(e){json(res,422,{error:String(e.message||e)})}}).catch(e=>json(res,400,{error:e.message}));return true;
}
module.exports={handler,stopRoom};
