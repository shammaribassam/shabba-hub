'use strict';
// Kick official API: app credentials stay on the server; the app's webhook URL
// must be configured in the Kick developer portal.
const crypto=require('node:crypto');
const sessions=new Map(), deliveries=new Map(), pendingSubscriptions=new Map();
let tokenCache=null, tokenPending=null, publicKey=null, keyFetchedAt=0, keyPending=null;
const API='https://api.kick.com/public/v1';
const fail=(message)=>{throw Error(message)};
function getSession(id){let s=sessions.get(id);if(!s){s={room:null,channel:'',broadcasterId:null,status:'غير متصل',listeners:new Set(),generation:0};sessions.set(id,s)}return s}
function broadcast(s,event){const chunk='data: '+JSON.stringify(event)+'\n\n';for(const res of s.listeners){try{res.write(chunk)}catch{s.listeners.delete(res)}}}
function announce(s){broadcast(s,{type:'status',status:s.status,channel:s.channel})}
function stopRoom(id,remove=false){const s=sessions.get(id);if(!s)return;s.generation++;s.channel='';s.broadcasterId=null;s.status='غير متصل';announce(s);if(remove){for(const res of s.listeners)res.end();sessions.delete(id)}}
async function fetchJson(url,options={}){
 const r=await fetch(url,{...options,signal:AbortSignal.timeout(12000)}).catch(()=>fail('تعذر الوصول إلى خوادم Kick'));
 let data;try{data=await r.json()}catch{fail('استجابة غير متوقعة من Kick')}
 if(!r.ok)fail('تعذر إتمام طلب Kick (رمز '+r.status+')');return data;
}
async function appToken(){
 if(tokenCache&&tokenCache.until>Date.now()+60000)return tokenCache.value;
 if(tokenPending)return tokenPending;
 tokenPending=(async()=>{
  const clientId=process.env.KICK_CLIENT_ID,secret=process.env.KICK_CLIENT_SECRET;
  if(!clientId||!secret)fail('يلزم إعداد بيانات تطبيق Kick في Render أولاً');
  const body=new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:secret});
  const data=await fetchJson('https://id.kick.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
  if(typeof data.access_token!=='string'||!data.access_token)fail('لم تُصدر Kick رمز اتصال للتطبيق');
  const seconds=Number(data.expires_in)||3600;tokenCache={value:data.access_token,until:Date.now()+seconds*1000};return tokenCache.value;
 })();
 try{return await tokenPending}finally{tokenPending=null}
}
async function api(path,options={}){
 const token=await appToken();return fetchJson(API+path,{...options,headers:{...options.headers,Authorization:'Bearer '+token,Accept:'application/json'}});
}
async function ensureSubscription(broadcasterId){
 const key=String(broadcasterId);if(pendingSubscriptions.has(key))return pendingSubscriptions.get(key);
 const task=(async()=>{
  const current=await api('/events/subscriptions?broadcaster_user_id='+encodeURIComponent(key));
  if(!Array.isArray(current.data))fail('تعذر قراءة اشتراكات Kick');
  if(current.data.some(x=>x.event==='chat.message.sent'&&Number(x.version)===1&&String(x.broadcaster_user_id)===key))return;
  const created=await api('/events/subscriptions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({broadcaster_user_id:Number(broadcasterId),events:[{name:'chat.message.sent',version:1}],method:'webhook'})});
  const result=Array.isArray(created.data)?created.data.find(x=>x.name==='chat.message.sent'):null;
  if(!result||result.error||!result.subscription_id)fail('لم تقبل Kick اشتراك الشات؛ تحقق من إعداد Webhook في تطبيق Kick');
 })();pendingSubscriptions.set(key,task);try{return await task}finally{pendingSubscriptions.delete(key)}
}
async function connect(id,username,room){
 username=String(username||'').trim().replace(/^@/,'').toLowerCase();
 if(!/^[a-z0-9_-]{1,25}$/.test(username))fail('أدخل اسم قناة Kick بدون رابط');
 const s=getSession(id),generation=++s.generation;s.channel=username;s.broadcasterId=null;s.room=room;s.status='جارٍ إعداد اتصال Kick...';announce(s);
 try{
  const channels=await api('/channels?slug='+encodeURIComponent(username));
  const channel=Array.isArray(channels.data)&&channels.data.find(x=>String(x.slug||'').toLowerCase()===username);
  const broadcasterId=channel?.broadcaster_user_id;
  if(!Number.isSafeInteger(Number(broadcasterId))||Number(broadcasterId)<=0)fail('لم يتم العثور على قناة Kick؛ تحقق من اسمها');
  await ensureSubscription(broadcasterId);
  if(s.generation!==generation)return;
  s.broadcasterId=String(broadcasterId);s.status='تم الاشتراك بشات Kick — بانتظار الرسائل';room.touched=Date.now();announce(s);
 }catch(err){if(s.generation===generation){s.status=String(err.message||'تعذر الاتصال بـ Kick').slice(0,160);announce(s)}throw err}
}
async function getKey(force=false){
 if(!force&&publicKey&&Date.now()-keyFetchedAt<3600000)return publicKey;
 if(keyPending)return keyPending;
 keyPending=(async()=>{const body=await fetchJson(API+'/public-key',{headers:{Accept:'application/json'}});const value=body?.data?.public_key;if(typeof value!=='string'||!value.includes('BEGIN PUBLIC KEY'))fail('تعذر قراءة مفتاح Kick');publicKey=value;keyFetchedAt=Date.now();return value})();
 try{return await keyPending}finally{keyPending=null}
}
function readRaw(req,max=65536){return new Promise((resolve,reject)=>{let parts=[],size=0,failed=false;req.on('data',b=>{size+=b.length;if(size>max){if(!failed){failed=true;reject(Error('payload too large'))}req.resume();return}if(!failed)parts.push(b)});req.on('end',()=>{if(!failed)resolve(Buffer.concat(parts))});req.on('error',reject)})}
async function verifyWebhook(req,raw){
 const h=req.headers,id=h['kick-event-message-id'],ts=h['kick-event-message-timestamp'],sig=h['kick-event-signature'];
 if(typeof id!=='string'||id.length>128||typeof ts!=='string'||typeof sig!=='string'||sig.length>2048)return false;
 const t=Date.parse(ts);if(!Number.isFinite(t)||Math.abs(Date.now()-t)>300000)return false;
 const signed=Buffer.concat([Buffer.from(id+'.'+ts+'.','utf8'),raw]);
 const verify=(key)=>{try{return crypto.verify('RSA-SHA256',signed,key,Buffer.from(sig,'base64'))}catch{return false}};
 let key=await getKey();if(verify(key))return true;
 // Key rotation: refresh once only when the cached key is old enough.
 if(Date.now()-keyFetchedAt>60000){key=await getKey(true);return verify(key)}return false;
}
async function webhook(req,res,json){
 try{
  if(req.headers['kick-event-type']!=='chat.message.sent'||req.headers['kick-event-version']!=='1'){req.resume();return json(res,204,{})}
  const raw=await readRaw(req);if(!await verifyWebhook(req,raw))return json(res,401,{error:'invalid signature'});
  const id=req.headers['kick-event-message-id'];if(deliveries.has(id))return json(res,200,{ok:true});
  let body;try{body=JSON.parse(raw.toString('utf8'))}catch{return json(res,400,{error:'invalid JSON'})}
  const broadcaster=String(body?.broadcaster?.user_id||''),name=body?.sender?.username,msg=body?.content;
  if(!/^\d+$/.test(broadcaster)||typeof name!=='string'||typeof msg!=='string')return json(res,400,{error:'invalid event'});
  deliveries.set(id,Date.now());for(const [old,time] of deliveries)if(Date.now()-time>600000)deliveries.delete(old);
  for(const s of sessions.values())if(s.broadcasterId===broadcaster&&s.room){s.room.touched=Date.now();broadcast(s,{type:'chat',name:name.slice(0,100),msg:msg.slice(0,500),platform:'kick'})}
  return json(res,200,{ok:true});
 }catch(e){return json(res,503,{error:'Webhook unavailable'})}
}
function handler(req,res,url,{getRoom,authorized,json,readJSON}){
 if(url.pathname==='/api/kick/webhook'){
  if(req.method!=='POST'){json(res,405,{error:'Method not allowed'});return true}
  webhook(req,res,json);return true;
 }
 if(!url.pathname.startsWith('/api/kick/'))return false;
 const room=getRoom(url);if(!room){json(res,404,{error:'Room not found'});return true}
 const id=url.searchParams.get('room'),s=getSession(id);
 if(url.pathname==='/api/kick/events'&&req.method==='GET'){
  if(!authorized({headers:{'x-room-token':url.searchParams.get('token')||''}},room)){json(res,403,{error:'Room access denied'});return true}
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});s.listeners.add(res);res.write('data: '+JSON.stringify({type:'status',status:s.status,channel:s.channel})+'\n\n');
  const ping=setInterval(()=>{try{res.write(': ping\n\n')}catch{}},25000);req.on('close',()=>{clearInterval(ping);s.listeners.delete(res)});return true;
 }
 if(!['/api/kick/connect','/api/kick/disconnect'].includes(url.pathname))return false;
 if(req.method!=='POST'){json(res,405,{error:'Method not allowed'});return true}
 if(!authorized(req,room)){json(res,403,{error:'Room access denied'});return true}
 if(url.pathname.endsWith('/disconnect')){stopRoom(id);json(res,200,{ok:true});return true}
 readJSON(req,1000).then(async body=>{try{await connect(id,body.username,room);json(res,200,{ok:true,status:s.status})}catch(e){json(res,422,{error:String(e.message||'تعذر الاتصال').slice(0,160)})}}).catch(e=>json(res,400,{error:e.message}));return true;
}
module.exports={handler,stopRoom};
