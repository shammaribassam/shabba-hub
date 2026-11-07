'use strict';
// BSM team quiz: one captain submits the team's final answer; the host judges.
// All question answers and host credentials stay on the server.
const crypto = require('node:crypto');
const questions = require('./seen-questions');
const chat = require('./arcade-chat');
const rooms = new Map(), listeners = new Map();
const TTL = 6 * 3600 * 1000;
const limits = { rooms: 100, players: 100 };
const token = () => crypto.randomBytes(24).toString('hex');
const clean = s => String(s ?? '').trim().replace(/[<>\x00-\x1f]/g,'').slice(0,65);
const fail = (status,message) => { const e = new Error(message); e.status = status; throw e; };
function code() { let n; do { n=String(crypto.randomInt(100000,1000000)); } while(rooms.has(n)); return n; }
function reply(res,status,data) {
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
 res.end(JSON.stringify(data));
}
function log(r,message){r.log.unshift({at:Date.now(),message});r.log.length=Math.min(r.log.length,35)}
function room(value){
 const r=rooms.get(String(value||''));
 if(!r||r.expires<Date.now())fail(404,'الغرفة غير موجودة أو انتهت');
 r.expires=Date.now()+TTL;return r;
}
function categoryList(){return questions.map(c=>({id:c.id,name:c.name,count:c.tiers.reduce((n,t)=>n+t.length,0)}))}
function publicState(r){
 return {
  room:r.code,phase:r.phase,revision:r.rev,now:Date.now(),
  names:r.names,scores:r.scores,turn:r.turn,
  categories:r.categories,
  slots:r.slots.map(s=>({id:s.id,category:s.category,value:s.value,used:s.used})),
  players:r.players.map(p=>({id:p.id,name:p.name,platform:p.platform,team:p.team})),
  captains:r.captains,settings:r.settings,
  chat:Object.fromEntries(Object.entries(r.settings).map(([platform,channel])=>[platform,{channel,...chat.status(platform,channel)}])),
  current:r.current?{
   slot:r.current.slot.id,category:r.current.slot.category,value:r.current.slot.value,
   question:r.current.slot.question,team:r.current.team,stage:r.current.stage,
   deadline:r.current.deadline,paused:r.current.paused,remaining:r.current.remaining,
   submission:r.current.submission,waiting:r.current.waiting,revealed:r.current.revealed,
   answer:r.current.revealed?r.current.slot.answer:null
  }:null,
  log:r.log.slice(0,12),winner:r.winner,used:r.slots.filter(s=>s.used).length,
  duration:r.duration,stealDuration:r.stealDuration
 };
}
function broadcast(r){
 r.rev++;const data='data: '+JSON.stringify(publicState(r))+'\n\n';
 for(const res of listeners.get(r.code)||[])try{res.write(data)}catch(_){}
}
function finish(r){
 r.phase='finished';r.winner=r.scores[0]===r.scores[1]?-1:(r.scores[0]>r.scores[1]?0:1);
 log(r,r.winner<0?'🤝 تعادل الفريقان':'🏆 الفائز: '+r.names[r.winner]);
}
function endQuestion(r,pointsTeam=null){
 if(!r.current)fail(409,'لا يوجد سؤال مفتوح');
 const current=r.current;
 current.slot.used=true;
 if(pointsTeam!==null)log(r,'✓ '+r.names[pointsTeam]+' حصل على '+current.slot.value+' نقطة');
 else log(r,'— انتهى السؤال دون نقاط');
 r.turn=1-current.team;r.current=null;
 if(r.slots.every(s=>s.used))finish(r);else r.phase='board';
}
function beginSteal(r){
 const c=r.current;if(!c)return;
 c.stage='steal';c.team=1-c.team;c.submission=null;c.waiting=false;c.paused=false;
 c.remaining=r.stealDuration*1000;c.deadline=Date.now()+c.remaining;
 log(r,'⚡ فرصة السرقة لـ '+r.names[c.team]);
}
function tick(r){
 const c=r.current;
 if(!c||c.paused||c.waiting||!c.deadline||Date.now()<c.deadline)return false;
 if(c.stage==='question')beginSteal(r);
 else endQuestion(r);
 return true;
}
function selectSlots(ids){
 if(!Array.isArray(ids)||ids.length!==6||new Set(ids).size!==6)fail(400,'اختر ست فئات مختلفة');
 const categories=ids.map(id=>questions.find(c=>c.id===id));
 if(categories.some(c=>!c))fail(400,'فئة غير موجودة');
 const slots=[];
 for(const c of categories){
  for(let tier=0;tier<3;tier++){
   const pool=[...c.tiers[tier]];
   for(let i=pool.length-1;i>0;i--){const j=crypto.randomInt(i+1);[pool[i],pool[j]]=[pool[j],pool[i]]}
   for(const item of pool.slice(0,2))slots.push({...item,category:c.id,used:false});
  }
 }
 return slots;
}
function ensureHost(r,b){if(typeof b.hostToken!=='string'||b.hostToken!==r.hostToken)fail(403,'صلاحية المقدم مطلوبة')}
function addPlayer(r,name,platform='manual'){
 name=clean(name);if(!name)fail(400,'اكتب اسم المشارك');
 if(r.players.length>=limits.players)fail(409,'وصلت الغرفة للحد الأقصى');
 if(r.players.some(p=>p.platform===platform&&p.name.toLowerCase()===name.toLowerCase()))fail(409,'المشارك موجود مسبقًا');
 const p={id:token().slice(0,12),name,platform,team:null};
 r.players.push(p);log(r,'👤 انضم '+name+(platform==='manual'?'':' من '+platform));return p;
}
function hostAction(r,b){
 const type=String(b.type||'');
 if(type==='connectChat'){
  const platform=String(b.platform||'');
  if(!['twitch','kick','tiktok'].includes(platform))fail(400,'المنصة غير مدعومة');
  let channel;try{channel=chat.clean(platform,b.channel)}catch(e){fail(400,e.message)}
  const old=r.settings[platform];r.settings[platform]=channel;
  if(old&&old!==channel)chat.disconnect(platform,old);
  chat.connect(platform,channel);log(r,'💬 ربط '+platform+' / '+channel);return;
 }
 if(type==='disconnectChat'){
  const platform=String(b.platform||'');if(!['twitch','kick','tiktok'].includes(platform))fail(400,'المنصة غير مدعومة');
  const old=r.settings[platform];delete r.settings[platform];if(old)chat.disconnect(platform,old);return;
 }
 if(type==='addPlayer'){addPlayer(r,b.name);return}
 if(type==='assign'){
  const p=r.players.find(x=>x.id===b.playerId);if(!p)fail(404,'المشارك غير موجود');
  const team=b.team===null?null:Number(b.team);
  if(team!==null&&![0,1].includes(team))fail(400,'اختر الفريق');
  p.team=team;
  for(let i=0;i<2;i++)if(r.captains[i]===p.id&&i!==team)r.captains[i]=null;
  return;
 }
 if(type==='captain'){
  const team=Number(b.team),p=r.players.find(x=>x.id===b.playerId);
  if(![0,1].includes(team)||!p||p.team!==team)fail(400,'اختر قائدًا من أعضاء الفريق');
  r.captains[team]=p.id;log(r,'🎙️ قائد '+r.names[team]+': '+p.name);return;
 }
 if(type==='removePlayer'){
  const p=r.players.find(x=>x.id===b.playerId);if(!p)fail(404,'المشارك غير موجود');
  r.players=r.players.filter(x=>x!==p);r.captains=r.captains.map(id=>id===p.id?null:id);return;
 }
 if(type==='start'||type==='restart'){
  if(type==='start'&&r.phase!=='lobby')fail(409,'اللعبة بدأت بالفعل');
  if(type==='restart'&&r.phase==='question')fail(409,'أنهِ السؤال قبل إعادة اللعبة');
  const names=(Array.isArray(b.names)?b.names:[]).map(clean);
  if(names.length!==2||names.some(x=>!x)||names[0]===names[1])fail(400,'اكتب اسمين مختلفين للفريقين');
  const duration=Number(b.duration||60),stealDuration=Number(b.stealDuration||15);
  if(![30,45,60,90].includes(duration)||![10,15,20].includes(stealDuration))fail(400,'وقت غير مدعوم');
  r.slots=selectSlots(b.categories);r.categories=[...b.categories];r.names=names;
  r.scores=[0,0];r.turn=0;r.current=null;r.phase='board';r.winner=null;r.lastAward=null;
  r.duration=duration;r.stealDuration=stealDuration;
  log(r,'🎲 بدأت اللعبة: ٦ فئات و٣٦ سؤالًا');return;
 }
 if(type==='pick'){
  if(r.phase!=='board')fail(409,'أنهِ السؤال الحالي أولًا');
  const slot=r.slots.find(s=>s.id===b.slotId&&!s.used);
  if(!slot)fail(404,'الخانة مستخدمة أو غير موجودة');
  r.current={slot,team:r.turn,stage:'question',deadline:Date.now()+r.duration*1000,remaining:r.duration*1000,paused:false,waiting:false,submission:null,revealed:false,originalTeam:r.turn};
  r.phase='question';r.lastAward=null;log(r,'❓ '+r.names[r.turn]+' اختار '+slot.value+' نقطة');return;
 }
 if(type==='adjust'){
  const team=Number(b.team),delta=Number(b.delta);
  if(![0,1].includes(team)||!Number.isInteger(delta)||Math.abs(delta)>5000||delta===0)fail(400,'تعديل نقاط غير صحيح');
  r.scores[team]+=delta;r.lastAward=null;log(r,'✏️ تعديل نقاط '+r.names[team]+': '+(delta>0?'+':'')+delta);return;
 }
 if(type==='undo'){
  if(!r.lastAward||!['board','finished'].includes(r.phase))fail(409,'لا توجد نتيجة أخيرة للتراجع');
  const x=r.lastAward;r.scores[x.team]-=x.value;r.turn=x.turn;
  const slot=r.slots.find(s=>s.id===x.slot);if(slot)slot.used=false;
  r.current=null;r.phase='board';r.winner=null;r.lastAward=null;log(r,'↩️ تراجع عن آخر نقاط');return;
 }
 if(type==='finish'){
  if(r.phase==='lobby')fail(409,'ابدأ اللعبة أولًا');
  r.current=null;finish(r);return;
 }
 if(type==='reset'){
  r.phase='lobby';r.categories=[];r.slots=[];r.current=null;r.scores=[0,0];r.turn=0;r.winner=null;r.lastAward=null;log(r,'🔄 رجعنا للتحضير');return;
 }
 const c=r.current;
 if(!c||r.phase!=='question')fail(409,'افتح سؤالًا أولًا');
 if(type==='reveal'){c.revealed=true;log(r,'👁️ كشف المقدم الإجابة');return}
 if(type==='pause'){if(!c.paused&&!c.waiting){c.remaining=Math.max(0,c.deadline-Date.now());c.deadline=0;c.paused=true}return}
 if(type==='resume'){if(c.paused&&!c.waiting){c.deadline=Date.now()+c.remaining;c.paused=false}return}
 if(type==='manualAnswer'){
  if(c.submission)fail(409,'وصلت إجابة القائد بالفعل');
  const answer=clean(b.answer);if(!answer)fail(400,'اكتب الإجابة');
  c.submission={name:'إجابة شفوية',text:answer,team:c.team,platform:'manual'};
  c.waiting=true;c.deadline=0;log(r,'🗣️ إجابة شفوية بانتظار تحكيم المقدم');return;
 }
 if(type==='wrong'){
  if(c.stage==='question')beginSteal(r);
  else endQuestion(r);
  return;
 }
 if(type==='skip'){endQuestion(r);return}
 if(type==='award'){
  const x={team:c.team,value:c.slot.value,slot:c.slot.id,turn:c.originalTeam};
  r.scores[c.team]+=c.slot.value;endQuestion(r,c.team);r.lastAward=x;return;
 }
 fail(400,'أمر غير معروف');
}
function chatMessage(platform,channel,username,message){
 let count=0;
 const text=String(message||'').trim(),name=String(username||'').trim().slice(0,65);
 if(!text||!name)return 0;
 for(const r of rooms.values()){
  if(r.expires<Date.now>()||r.settings[platform]!==channel)continue;
  if(/^!\s*انضم$/u.test(text)){
   if(!r.players.some(p=>p.platform===platform&&p.name.toLowerCase()===name.toLowerCase())){
    try{addPlayer(r,name,platform);broadcast(r);count++}catch(_){}
   }
   continue;
  }
  const match=text.match(/^!\s*جواب\s+(.{1,160})$/u);
  if(!match||r.phase!=='question'||!r.current||r.current.waiting||r.current.paused)continue;
  const c=r.current,p=r.players.find(p=>p.platform===platform&&p.name.toLowerCase()===name.toLowerCase());
  if(!p||p.team!==c.team||r.captains[c.team]!==p.id)continue;
  c.submission={name:p.name,text:clean(match[1]),platform,team:c.team};
  if(!c.submission.text)continue;
  c.waiting=true;c.remaining=Math.max(0,c.deadline-Date.now());c.deadline=0;
  log(r,'🎙️ قائد '+r.names[c.team]+' قدّم إجابته');
  broadcast(r);count++;
 }
 return count;
}
async function body(req){
 let raw='';for await(const part of req){raw+=part;if(raw.length>16000)fail(413,'الطلب كبير')}
 try{return JSON.parse(raw||'{}')}catch(_){fail(400,'بيانات غير صحيحة')}
}
async function handle(req,res,url){
 try{
  for(const [id,r] of rooms)if(r.expires<Date.now()){
   rooms.delete(id);for(const response of listeners.get(id)||[])response.end();listeners.delete(id);
   for(const [platform,channel] of Object.entries(r.settings))chat.disconnect(platform,channel);
  }
  if(req.method==='GET'&&url.pathname==='/api/seen/categories')return reply(res,200,{categories:categoryList()});
  if(req.method==='GET'&&url.pathname==='/api/seen/state'){
   const r=room(url.searchParams.get('room'));if(tick(r))broadcast(r);return reply(res,200,publicState(r));
  }
  if(req.method==='GET'&&url.pathname==='/api/seen/events'){
   const r=room(url.searchParams.get('room'));
   res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
   res.write('retry: 2000\n\ndata: '+JSON.stringify(publicState(r))+'\n\n');
   if(!listeners.has(r.code))listeners.set(r.code,new Set());
   listeners.get(r.code).add(res);
   const interval=setInterval(()=>{if(tick(r))broadcast(r);try{res.write(': ping\n\n')}catch(_){}},500);
   req.on('close',()=>{clearInterval(interval);listeners.get(r.code)?.delete(res)});return;
  }
  if(req.method!=='POST')return reply(res,405,{error:'طريقة غير مدعومة'});
  const origin=req.headers.origin;
  if(origin){try{if(new URL(origin).host!==req.headers.host)fail(403,'مصدر غير مسموح')}catch(_){fail(403,'مصدر غير مسموح')}}
  const b=await body(req);
  if(url.pathname==='/api/seen/create'){
   if(rooms.size>=limits.rooms)fail(503,'الغرف ممتلئة مؤقتًا');
   const r={code:code(),hostToken:token(),phase:'lobby',rev:1,expires:Date.now()+TTL,names:['فريق الصقور','فريق الذئاب'],scores:[0,0],turn:0,categories:[],slots:[],players:[],captains:[null,null],settings:{},current:null,log:[],winner:null,duration:60,stealDuration:15,lastAward:null};
   rooms.set(r.code,r);return reply(res,201,{room:r.code,hostToken:r.hostToken,state:publicState(r)});
  }
  const r=room(b.room);if(tick(r))broadcast(r);
  if(url.pathname==='/api/seen/secret'){
   ensureHost(r,b);return reply(res,200,{answer:r.current?.slot.answer||null,question:r.current?.slot.question||null});
  }
  if(url.pathname==='/api/seen/host'){
   ensureHost(r,b);hostAction(r,b);broadcast(r);return reply(res,200,{ok:true,state:publicState(r),answer:r.current?.slot.answer||null});
  }
  return reply(res,404,{error:'المسار غير موجود'});
 }catch(e){return reply(res,e.status||500,{error:e.status?e.message:'خطأ في خادم سين وجيم'})}
}
chat.bind({
 onMessage:chatMessage,
 onStatus:(platform,channel)=>{for(const r of rooms.values())if(r.expires>Date.now()&&r.settings[platform]===channel)broadcast(r)},
 isActive:(platform,channel)=>[...rooms.values()].some(r=>r.expires>Date.now()&&r.settings[platform]===channel)
});
module.exports={handle,chatMessage,categoryList};
