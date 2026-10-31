'use strict';
// Kick Official Events API: channel lookup, event subscriptions, RSA signed webhooks.
// Does not change Twitch or TikTok integrations.
const crypto=require('node:crypto');
const rooms=new Map();
const usedWebhookIds=new Map();
let access={token:'',until:0},publicKey={pem:'',until:0};
const API='https://api.kick.com/public/v1';
function get(id){if(!rooms.has(id))rooms.set(id,{slug:'',broadcasterId:0,status:'غير متصل',listeners:new Set()});return rooms.get(id)}
function broadcast(s,ev){for(const r of s.listeners){try{r.write('data: '+JSON.stringify(ev)+'\n\n')}catch{s.listeners.delete(r)}}}
function status(s){broadcast(s,{type:'status',status:s.status,channel:s.slug})}
function setStatus(s,msg){s.status=msg;status(s)}
function stopRoom(id){const s=rooms.get(id);if(!s)return;s.slug='';s.broadcasterId=0;setStatus(s,'غير متصل')}
async function fetchJSON(url,opts={}){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);try{const response=await fetch(url,{...opts,signal:controller.signal});const obj=await response.json().catch(()=>({}));if(!response.ok)throw Error('Kick API '+response.status+': '+String(obj.message||obj.error||'تعذر الطلب').slice(0,140));return obj}finally{clearTimeout(timeout)}}
async function token(){if(access.token&&Date.now()<access.until)return access.token;
 const cid=process.env.KICK_CLIENT_ID,secret=process.env.KICK_CLIENT_SECRET;
 if(!cid||!secret)throw Error('يلزم إدخال KICK_CLIENT_ID و KICK_CLIENT_SECRET في Render');
 const params=new URLSearchParams({grant_type:'client_credentials',client_id:cid,client_secret:secret});
 const obj=await fetchJSON('https://id.kick.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params.toString()});
 if(!obj.access_token)throw Error('لم يرجع Kick رمز دخول صالح');
 access={token:obj.access_token,until:Date.now()+Math.max(60,Number(obj.expires_in||1800)-90)*1000};return access.token;
}
async function kickAPI(endpoint,opts={}){const bearer=await token();return fetchJSON(API+endpoint,{...opts,headers:{'Authorization':'Bearer '+bearer,'Accept':'application/json',...(opts.headers||{})}})}
async function subscribe(slug){const data=await kickAPI('/channels?slug='+encodeURIComponent(slug));const chan=(Array.isArray(data.data)?data.data:[]).find(x=>String(x.slug||'').toLowerCase()===slug.toLowerCase());
 if(!chan||!Number(chan.broadcaster_user_id))throw Error('قناة Kick غير موجودة أو لا يمكن قراءة بياناتها');
 const broadcasterId=Number(chan.broadcaster_user_id);
 const existing=await kickAPI('/events/subscriptions?broadcaster_user_id='+broadcasterId);
 const have=(Array.isArray(existing.data)?existing.data:[]).some(x=>Number(x.broadcaster_user_id)===broadcasterId&&x.event==='chat.message.sent'&&Number(x.version)===1);
 if(!have){const p=await kickAPI('/events/subscriptions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({broadcaster_user_id:broadcasterId,events:[{name:'chat.message.sent',version:1}],method:'webhook'})});const fail=(Array.isArray(p.data)?p.data:[]).find(x=>x.error);if(fail)throw Error('Kick لم يقبل الاشتراك: '+fail.error)}
 return broadcasterId;
}
async function getPublicKey(){if(publicKey.pem&&Date.now()<publicKey.until)return publicKey.pem;
 const data=await fetchJSON(API+'/public-key');const pem=data?.data?.public_key;
 if(!pem||typeof pem!=='string')throw Error('تعذر جلب مفتاح Kick العام');publicKey={pem,until:Date.now()+15*60*1000};return pem}
async function readRaw(req,max=120000){return new Promise((resolve,reject)=>{const chunks=[];let bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>max){reject(Error('Payload too large'));req.destroy()}else chunks.push(b)});req.on('end',()=>resolve(Buffer.concat(chunks)));req.on('error',reject)})}
async function webhook(req,res,{json}){
 let raw;try{raw=await readRaw(req)}catch{return json(res,413,{error:'Payload too large'})}
 const id=String(req.headers['kick-event-message-id']||''),stamp=String(req.headers['kick-event-message-timestamp']||''),sig=String(req.headers['kick-event-signature']||'');
 if(!id||!stamp||!sig||!/^[A-Za-z0-9+\/=]+$/.test(sig)||!Number.isFinite(Date.parse(stamp)))return json(res,401,{error:'Missing signed Kick headers'});
 // Avoid processing events from outside a 10-minute delivery window.
 if(Math.abs(Date.now()-Date.parse(stamp))>10*60*1000)return json(res,401,{error:'Stale Kick event'});
 let valid=false;try{const key=await getPublicKey();valid=crypto.verify('RSA-SHA256',Buffer.concat([Buffer.from(id+'.'+stamp+'.'),raw]),key,Buffer.from(sig,'base64'))}catch(e){console.error('Kick signature validation failed',e.message);return json(res,503,{error:'Kick verification unavailable'})}
 if(!valid)return json(res,401,{error:'Invalid Kick signature'});
 if(usedWebhookIds.has(id))return json(res,200,{ok:true,duplicate:true});
 usedWebhookIds.set(id,Date.now());if(usedWebhookIds.size>5000){for(const [key,v] of usedWebhookIds){if(Date.now()-v>20*60*1000||usedWebhookIds.size>4800)usedWebhookIds.delete(key);else break}}
 if(req.headers['kick-event-type']!=='chat.message.sent')return json(res,200,{ok:true});
 let payload;try{payload=JSON.parse(raw.toString('utf8'))}catch{return json(res,400,{error:'Invalid JSON'})}
 const broadcasterId=Number(payload?.broadcaster?.user_id),slug=String(payload?.broadcaster?.channel_slug||'').toLowerCase();
 const name=String(payload?.sender?.username||'').trim().slice(0,60),msg=String(payload?.content||'').trim().slice(0,500);
 if(broadcasterId&&name&&msg){for(const s of rooms.values()){if(s.broadcasterId===broadcasterId&&s.slug===slug){broadcast(s,{type:'chat',name,msg,platform:'kick'});if(!s.status.startsWith('متصل'))setStatus(s,'متصل بشات Kick @'+slug)}}}
 return json(res,200,{ok:true});
}
function handler(req,res,url,{getRoom,authorized,json,readJSON}){
 if(url.pathname==='/api/kick/webhook'&&req.method==='POST'){void webhook(req,res,{json});return true}
 if(!url.pathname.startsWith('/api/kick/'))return false;
 const room=getRoom(url);if(!room){json(res,404,{error:'Room not found'});return true}
 const id=url.searchParams.get('room'),s=get(id);
 if(url.pathname==='/api/kick/events'&&req.method==='GET'){
  if(!authorized({headers:{'x-room-token':url.searchParams.get('token')||''}},room)){json(res,403,{error:'Room access denied'});return true}
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
  s.listeners.add(res);res.write('data: '+JSON.stringify({type:'status',status:s.status,channel:s.slug})+'\n\n');
  const ping=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},25000);
  req.on('close',()=>{clearInterval(ping);s.listeners.delete(res)});return true;
 }
 if(!['/api/kick/connect','/api/kick/disconnect'].includes(url.pathname))return false;
 if(req.method!=='POST'){json(res,405,{error:'Method not allowed'});return true}
 if(!authorized(req,room)){json(res,403,{error:'Room access denied'});return true}
 if(url.pathname==='/api/kick/disconnect'){stopRoom(id);json(res,200,{ok:true});return true}
 readJSON(req,1200).then(async body=>{const slug=String(body.channel||'').trim().replace(/^@/,'').toLowerCase();
  if(!/^[a-z0-9_-]{2,25}$/.test(slug))return json(res,400,{error:'اسم قناة Kick غير صالح'});
  setStatus(s,'جارٍ الاشتراك بشات Kick...');
  try{const broadcasterId=await subscribe(slug);s.slug=slug;s.broadcasterId=broadcasterId;room.touched=Date.now();setStatus(s,'تم الاشتراك بشات Kick @'+slug+' — بانتظار الرسائل');json(res,200,{ok:true,channel:slug})}
  catch(e){setStatus(s,'خطأ Kick: '+String(e.message||e).slice(0,150));json(res,422,{error:String(e.message||e).slice(0,180)})}
 }).catch(e=>json(res,400,{error:e.message}));return true;
}
module.exports={handler,stopRoom};
