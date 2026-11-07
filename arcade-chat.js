'use strict';
// Live-chat connections belong to the hub itself, not to BSM Chat.
// Twitch: read-only anonymous IRC; Kick: official signed webhook;
// TikTok: live-connector (requires the channel to be LIVE).
const crypto=require('node:crypto');
const tmi=require('tmi.js');
const {TikTokLiveConnection}=require('tiktok-live-connector');
const statuses=new Map(),tiktoks=new Map(),kicks=new Map(),seen=new Map();
const API='https://api.kick.com/public/v1';
let hooks={onMessage:()=>0,onStatus:()=>{},isActive:()=>false};
let twitchClient=null,twitchConnecting=null;
let kickToken=null,kickTokenUntil=0,kickTokenPending=null,kickKey=null,kickKeyUntil=0;
const key=(platform,channel)=>platform+':'+channel;
function clean(platform,value){
 const v=String(value||'').trim().replace(/^[@#]/,'').toLowerCase();
 const pattern=platform==='tiktok'?/^[a-z0-9_.]{2,32}$/:platform==='kick'?/^[a-z0-9_-]{2,25}$/:/^[a-z0-9_]{3,25}$/;
 if(!pattern.test(v))throw Error('اسم القناة غير صحيح لهذه المنصة');
 return v;
}
const subscribers=[];
function bind(value){
 subscribers.push(value);
 hooks={
  onMessage:(...args)=>subscribers.reduce((count,listener)=>{
   try{return count+Number(listener.onMessage?.(...args)||0)}catch(e){console.error('Chat listener:',e.message);return count}
  },0),
  onStatus:(...args)=>{for(const listener of subscribers)try{listener.onStatus?.(...args)}catch(e){console.error('Status listener:',e.message)}},
  isActive:(...args)=>subscribers.some(listener=>{try{return !!listener.isActive?.(...args)}catch(_){return false}})
 };
}
function status(platform,channel){return statuses.get(key(platform,channel))||{state:'idle',detail:'لم يتم الربط'}}
function update(platform,channel,state,detail){
 const k=key(platform,channel),previous=statuses.get(k);
 if(previous?.state===state&&previous?.detail===detail)return;
 statuses.set(k,{state,detail,updatedAt:Date.now()});
 hooks.onStatus(platform,channel);
}
function deliver(platform,channel,username,message){
 if(!hooks.isActive(platform,channel))return 0;
 if(!username||!message)return 0;
 return hooks.onMessage(platform,channel,username,message);
}
function attachTwitch(){
 if(twitchClient)return;
 const client=new tmi.Client({options:{debug:false,skipMembership:true},connection:{secure:true,reconnect:true,maxReconnectAttempts:100},channels:[]});
 twitchClient=client;
 client.on('message',(channel,tags,message,self)=>{
  if(self||!tags?.username)return;
  deliver('twitch',String(channel).replace(/^#/,'').toLowerCase(),tags.username,message);
 });
 client.on('join',(channel,_username,self)=>{
  if(self)update('twitch',channel.replace(/^#/,'').toLowerCase(),'connected','متصل بشات تويتش — اكتب !انضم');
 });
 client.on('disconnected',()=>{
  for(const [k] of statuses)if(k.startsWith('twitch:')){
   const channel=k.slice(7);if(hooks.isActive('twitch',channel))update('twitch',channel,'connecting','انقطع تويتش — جارٍ إعادة الاتصال');
  }
 });

}
async function connectTwitch(channel){
 const active=[...statuses.keys()].filter(k=>k.startsWith('twitch:')&&hooks.isActive('twitch',k.slice(7)));
 if(!statuses.has(key('twitch',channel))&&active.length>20){update('twitch',channel,'error','الحد الأقصى لاتصالات تويتش مؤقتًا 20 قناة');return}
 update('twitch',channel,'connecting','جارٍ الاتصال بشات تويتش...');
 attachTwitch();
 if(!twitchConnecting){
  twitchConnecting=twitchClient.connect().catch(e=>{
   for(const [k] of statuses)if(k.startsWith('twitch:'))update('twitch',k.slice(7),'error','تعذر الاتصال بتويتش: '+String(e.message||e).slice(0,100));
   throw e;
  }).finally(()=>{twitchConnecting=null});
 }
 try{
  await twitchConnecting;
  if(!hooks.isActive('twitch',channel))return;
  if(!twitchClient.getChannels().includes('#'+channel))await twitchClient.join(channel);
  update('twitch',channel,'connected','متصل بشات تويتش — اكتب !انضم');
 }catch(e){update('twitch',channel,'error','تعذر الاتصال بتويتش: '+String(e.message||e).slice(0,100))}
}
function extractTikTokUser(data){
 const u=data.user||data.userInfo?.user||data.userInfo||data.userDetails||data.content?.user||{};
 return data.uniqueId||u.uniqueId||u.unique_id||u.username||data.nickname||u.nickname||'';
}
function extractTikTokText(data){return data.comment||data.text||data.message||(typeof data.content==='string'?data.content:data.content?.text)||''}
function stopTikTok(channel){
 const entry=tiktoks.get(channel);if(!entry)return;
 tiktoks.delete(channel);if(entry.timer)clearTimeout(entry.timer);
 try{entry.connection?.disconnect()}catch(_){}
}
async function connectTikTok(channel){
 if(tiktoks.has(channel))return;
 if(tiktoks.size>=12){update('tiktok',channel,'error','الحد الأقصى لاتصالات تيك توك مؤقتًا 12 قناة');return}
 const entry={connection:null,timer:null,attempt:0};tiktoks.set(channel,entry);
 async function tryConnect(){
  if(tiktoks.get(channel)!==entry||!hooks.isActive('tiktok',channel))return;
  entry.attempt++;
  update('tiktok',channel,'connecting','جارٍ محاولة الاتصال ببث تيك توك...');
  let connection;
  try{connection=new TikTokLiveConnection(channel,{processInitialData:false});entry.connection=connection;
   connection.on('chat',data=>{
    if(tiktoks.get(channel)===entry&&entry.connection===connection)deliver('tiktok',channel,extractTikTokUser(data),extractTikTokText(data));
   });
   connection.on('disconnected',()=>{if(tiktoks.get(channel)===entry&&entry.connection===connection)retry('انقطع الاتصال ببث تيك توك')});
   connection.on('streamEnd',()=>{if(tiktoks.get(channel)===entry&&entry.connection===connection)retry('انتهى بث تيك توك')});
   connection.on('error',e=>{if(tiktoks.get(channel)===entry)update('tiktok',channel,'waiting','تعذر الاتصال بتيك توك: '+String(e.message||e).slice(0,85))});
   await connection.connect();
   if(tiktoks.get(channel)===entry&&entry.connection===connection)update('tiktok',channel,'connected','متصل ببث تيك توك — اكتب !انضم');
  }catch(e){retry('تعذر الاتصال بالبث (قد تكون القناة غير مباشرة)')}
 }
 function retry(message){
  if(tiktoks.get(channel)!==entry||entry.timer)return;
  update('tiktok',channel,'waiting',message+' — إعادة المحاولة بعد دقيقة ونصف');
  const old=entry.connection;entry.connection=null;
  entry.timer=setTimeout(()=>{entry.timer=null;void tryConnect()},90000);entry.timer.unref?.();
  if(old)try{old.disconnect()}catch(_){}
 }
 void tryConnect();
}
async function fetchJson(url,opts={}){
 const response=await fetch(url,{...opts,signal:AbortSignal.timeout(12000)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error('Kick API '+response.status);
 return data;
}
async function appToken(){
 if(kickToken&&Date.now()<kickTokenUntil-60000)return kickToken;
 if(kickTokenPending)return kickTokenPending;
 kickTokenPending=(async()=>{
  const clientId=process.env.KICK_CLIENT_ID,secret=process.env.KICK_CLIENT_SECRET;
  if(!clientId||!secret)throw Error('أضف KICK_CLIENT_ID وKICK_CLIENT_SECRET في Render');
  const body=new URLSearchParams({grant_type:'client_credentials',client_id:clientId,client_secret:secret});
  const data=await fetchJson('https://id.kick.com/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  if(!data.access_token)throw Error('لم يصدر Kick رمز الاتصال');
  kickToken=data.access_token;kickTokenUntil=Date.now()+Number(data.expires_in||3600)*1000;return kickToken;
 })();
 try{return await kickTokenPending}finally{kickTokenPending=null}
}
async function kickApi(path,opts={}){
 const token=await appToken();
 return fetchJson(API+path,{...opts,headers:{accept:'application/json',authorization:'Bearer '+token,...opts.headers}});
}
async function connectKick(channel){
 if(kicks.get(channel)?.connecting)return;
 kicks.set(channel,{connecting:true});
 update('kick',channel,'connecting','جارٍ الاشتراك برسائل كيك...');
 try{
  const result=await kickApi('/channels?slug='+encodeURIComponent(channel));
  const item=(result.data||[]).find(x=>String(x.slug||'').toLowerCase()===channel);
  const broadcaster=Number(item?.broadcaster_user_id);
  if(!Number.isSafeInteger(broadcaster)||broadcaster<1)throw Error('قناة كيك غير موجودة');
  const current=await kickApi('/events/subscriptions?broadcaster_user_id='+broadcaster);
  const subscribed=(current.data||[]).some(x=>Number(x.broadcaster_user_id)===broadcaster&&x.event==='chat.message.sent'&&Number(x.version)===1);
  if(!subscribed){
   const result=await kickApi('/events/subscriptions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({broadcaster_user_id:broadcaster,events:[{name:'chat.message.sent',version:1}],method:'webhook'})});
   if((result.data||[]).some(x=>x.error))throw Error('رفض Kick اشتراك الشات');
  }
  kicks.set(channel,{connecting:false,broadcaster});
  if(hooks.isActive('kick',channel))update('kick',channel,'waiting','تم الاشتراك — بانتظار رسالة من شات كيك');
 }catch(e){kicks.delete(channel);update('kick',channel,'error',String(e.message||e).slice(0,140))}
}
async function kickPublicKey(force=false){
 if(!force&&kickKey&&Date.now()<kickKeyUntil)return kickKey;
 const data=await fetchJson(API+'/public-key');
 const pem=data?.data?.public_key;
 if(typeof pem!=='string'||!pem.includes('BEGIN PUBLIC KEY'))throw Error('تعذر التحقق من توقيع كيك');
 kickKey=pem;kickKeyUntil=Date.now()+3600000;return pem;
}
async function acceptKick(req,raw){
 const h=req.headers;
 const id=h['kick-event-message-id'],stamp=h['kick-event-message-timestamp'],sig=h['kick-event-signature'];
 if(typeof id!=='string'||id.length>128||typeof stamp!=='string'||typeof sig!=='string'||sig.length>2048||!Number.isFinite(Date.parse(stamp))||Math.abs(Date.now()-Date.parse(stamp))>300000)return {ok:false,status:401};
 const signed=Buffer.concat([Buffer.from(id+'.'+stamp+'.'),raw]);
 const verify=pem=>{try{return crypto.verify('RSA-SHA256',signed,pem,Buffer.from(sig,'base64'))}catch(_){return false}};
 let pem=await kickPublicKey();let valid=verify(pem);
 if(!valid&&Date.now()>kickKeyUntil-3500000)valid=verify(await kickPublicKey(true));
 if(!valid)return {ok:false,status:401};
 if(seen.has(id))return {ok:true,duplicate:true};
 seen.set(id,Date.now());
 if(seen.size>4000){for(const [k,t] of seen)if(Date.now()-t>600000||seen.size>3500)seen.delete(k)}
 if(h['kick-event-type']!=='chat.message.sent')return {ok:true,count:0};
 let event;try{event=JSON.parse(raw.toString('utf8'))}catch(_){return {ok:false,status:400}}
 const channel=String(event.broadcaster?.channel_slug||event.broadcaster?.username||'').toLowerCase();
 const username=event.sender?.username,content=event.content;
 const count=deliver('kick',channel,username,content);
 if(hooks.isActive('kick',channel)&&username&&content)update('kick',channel,'connected','متصل بشات كيك — اكتب !انضم');
 return {ok:true,count};
}
function connect(platform,channel){
 if(platform==='twitch')return void connectTwitch(channel).catch(e=>update('twitch',channel,'error',String(e.message||e).slice(0,130)));
 if(platform==='tiktok')return void connectTikTok(channel).catch(e=>update('tiktok',channel,'error',String(e.message||e).slice(0,130)));
 if(platform==='kick')return void connectKick(channel).catch(e=>update('kick',channel,'error',String(e.message||e).slice(0,130)));
}
function disconnect(platform,channel){
 if(hooks.isActive(platform,channel))return;
 if(platform==='tiktok')stopTikTok(channel);
 if(platform==='twitch'&&twitchClient)void twitchClient.part(channel).catch(()=>{});
 if(platform==='kick')kicks.delete(channel);
 statuses.delete(key(platform,channel));
}
function close(){
 for(const channel of tiktoks.keys())stopTikTok(channel);
 if(twitchClient){void twitchClient.disconnect().catch(()=>{});twitchClient=null}
}
module.exports={bind,clean,status,connect,disconnect,acceptKick,close};
