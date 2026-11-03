'use strict';
const crypto=require('node:crypto');
const chat=require('./arcade-chat');
const rooms=new Map(),streams=new Map();
const TTL=6*3600*1000;
const id=()=>crypto.randomBytes(24).toString('hex');
const rnd=n=>crypto.randomInt(n);
const err=(s,m)=>{const e=new Error(m);e.status=s;throw e};
const safe=s=>String(s||'').trim().slice(0,35).replace(/[<>\x00-\x1f]/g,'');
const code=()=>{let c;do{c=String(crypto.randomInt(100000,1000000))}while(rooms.has(c));return c};
function send(res,status,obj){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(obj))}
function chatCommand(platform,channel,username,message){
 const text=String(message||'').trim(),who=String(username||'').trim().slice(0,35),ch=String(channel||'').trim().toLowerCase();
 if(!who||!ch||!text)return 0;
 let count=0;
 for(const r of rooms.values()){
  if(r.expires<Date.now()||r.settings?.[platform]!==ch)continue;
  try{
   const cmd=text.match(/^(?:!|！)?(انضم|طرد|إنعاش|انعاش|سكيب|نجاة|مرر|كرسي|صندوق|باب)(?:\s+(\d+))?$/u);
   if(platform!=='tiktok'&&!text.startsWith('!'))continue;
   if(!cmd)continue;
   const name=platform+':'+who;
   let p=r.players.find(x=>x.name.toLowerCase()===name.toLowerCase());
   if(cmd[1]==='انضم'){
    if(r.phase==='lobby'&&!p&&r.players.length<100){p={id:r.players.length+1,name,token:id(),alive:true,seat:null,choice:null,skip:false};r.players.push(p);log(r,'💬 انضم '+name);broadcast(r);count++}
    continue;
   }
   if(!p||!p.alive||r.phase!=='playing')continue;
   const types={'طرد':'kick','إنعاش':'revive','انعاش':'revive','سكيب':'skip','نجاة':'save','مرر':'pass','كرسي':'chair','صندوق':'box','باب':'choose'};
   action(r,{type:types[cmd[1]],playerToken:p.token,target:Number(cmd[2])},false);broadcast(r);count++;
  }catch(e){
   // Surface rejected chat actions to the host so a failed command is diagnosable.
   log(r,'⚠️ أمر '+platform+' من '+who+' لم ينفذ: '+(e.message||'خطأ غير معروف'));
   broadcast(r);
  }
 }
 return count;
}
function publicRoom(r){return {code:r.code,game:r.game,phase:r.phase,round:r.round,revision:r.rev,players:r.players.map(p=>({id:p.id,name:p.name,alive:p.alive,seat:p.seat||null,choice:p.choice||null,skip:p.skip||false})),active:r.active,holder:r.holder,chairs:r.chairs,doors:r.doors,boxes:r.boxes.map(b=>({id:b.id,crown:r.opened?b.crown:undefined})),opened:r.opened,limit:r.limit,log:r.log.slice(-12),winner:r.winner,settings:r.settings,chat:Object.fromEntries(Object.entries(r.settings).map(([p,c])=>[p,{channel:c,...chat.status(p,c)}])),spin:r.spin||0,now:Date.now()}}
function broadcast(r){r.rev++;const data='data: '+JSON.stringify(publicRoom(r))+'\n\n';for(const res of streams.get(r.code)||[])try{res.write(data)}catch(_){}}
function get(c){const r=rooms.get(String(c||''));if(!r||r.expires<Date.now())err(404,'الغرفة غير موجودة أو انتهت');r.expires=Date.now()+TTL;return r}
function host(r,b){if(b.hostToken!==r.hostToken)err(403,'صلاحية المقدم مطلوبة')}
function player(r,b){const p=r.players.find(p=>p.token===b.playerToken);if(!p)err(403,'انضم للعبة أولًا');return p}
function active(r){return r.players.filter(p=>p.alive)}
function pick(a){return a[rnd(a.length)]}
function log(r,t){r.log.push(t);r.log=r.log.slice(-30)}
function finish(r){const a=active(r);if(a.length===1){r.winner=a[0].id;r.phase='finished';log(r,'🏆 الفائز: '+a[0].name);return true}return false}
function endAt(r,ms){r.deadline=Date.now()+ms}
function clearTimer(r){r.deadline=0;r.remaining=0}
function start(r){
 if(r.players.length<2)err(409,'يلزم لاعبان على الأقل');
 if(r.phase==='playing')err(409,'الجولة بدأت بالفعل');
 if(r.phase==='finished')err(409,'اللعبة انتهت؛ أنشئ غرفة جديدة');
 r.round++;r.phase='playing';r.startedAt=Date.now();clearTimer(r);r.active=null;r.holder=null;r.opened=false;
 for(const p of r.players){p.choice=null;p.seat=null}
 const a=active(r);
 if(r.game==='roulette'){r.spin=(r.spin||0)+1;r.active=pick(a).id;log(r,'🎡 صاحب الدور: '+a.find(p=>p.id===r.active).name)}
 if(r.game==='doors'){r.doors=Array.from({length:Math.min(18,a.length)},(_,i)=>({id:i+1,result:null}));log(r,'🚪 اختاروا الأبواب')}
 if(r.game==='survival'){r.limit=Math.min(8,Math.max(1,a.length-1));log(r,'🚨 زر النجاة مفتوح الآن')}
 if(r.game==='bomb'){r.holder=pick(a).id;r.remaining=crypto.randomInt(12000,32001);endAt(r,r.remaining);log(r,'💣 القنبلة عند '+a.find(p=>p.id===r.holder).name)}
 if(r.game==='chairs'){r.chairs=Array.from({length:a.length-1},(_,i)=>i+1).sort(()=>Math.random()-.5);r.phase='ready';log(r,'🪑 شغّل المقطع ثم أظهر الكراسي')}
 if(r.game==='boxes'){r.boxes=Array.from({length:a.length},(_,i)=>({id:i+1,crown:false}));r.boxes[rnd(r.boxes.length)].crown=true;log(r,'🎁 اختر صندوقًا، واحد فيه التاج')}
}
function tick(r){if(r.game==='bomb'&&r.phase==='playing'&&r.deadline&&Date.now()>=r.deadline){const p=r.players.find(p=>p.id===r.holder);if(p){p.alive=false;log(r,'💥 خرج '+p.name)}clearTimer(r);if(!finish(r))r.phase='between';broadcast(r)}}
function action(r,b,byHost){
 tick(r);
 const type=String(b.type||'');
 const p=byHost?r.players.find(p=>p.id===Number(b.playerId)):player(r,b);
 if(!p||!p.alive)err(409,'اللاعب غير مؤهل');
 if(r.phase!=='playing')err(409,'الجولة غير مفتوحة');
 const a=active(r);
 if(r.game==='roulette'){
  if(p.id!==r.active)err(403,'الأمر لصاحب الدور فقط');
  if(type==='skip'){if(p.skip)err(409,'استخدمت السكيب سابقًا');p.skip=true;log(r,'⏭️ سكيب '+p.name)}
  else if(type==='kick'||type==='revive'){
   const target=r.players.find(q=>q.id===Number(b.target));
   if(!target||target.id===p.id)err(400,'رقم اللاعب غير صحيح');
   if(type==='kick'){if(!target.alive)err(409,'اللاعب مستبعد أصلًا');target.alive=false;log(r,'🚫 '+p.name+' طرد '+target.name)}
   else {if(target.alive)err(409,'اللاعب موجود أصلًا');target.alive=true;log(r,'❤️ '+p.name+' أنعش '+target.name)}
  }else err(400,'الأمر غير معروف');
  if(!finish(r)){const survivors=active(r);r.active=pick(survivors).id;r.spin=(r.spin||0)+1}
 }else if(r.game==='doors'){
  if(type!=='choose')err(400,'اختر بابًا');
  if(p.choice)err(409,'اخترت بابك مسبقًا');
  const d=r.doors.find(d=>d.id===Number(b.target));if(!d)err(400,'الباب غير موجود');
  p.choice=d.id;log(r,'🚪 '+p.name+' اختار باب '+d.id);
 }else if(r.game==='survival'){
  if(type!=='save')err(400,'استخدم زر النجاة');
  if(p.choice)err(409,'تم احتساب ضغطتك');
  p.choice='saved';log(r,'🚨 نجا '+p.name);
  if(a.filter(q=>q.choice==='saved').length>=r.limit){for(const q of a)if(q.choice!=='saved')q.alive=false;r.phase='between';log(r,'اكتمل عدد الناجين');finish(r)}
 }else if(r.game==='bomb'){
  if(type!=='pass'||p.id!==r.holder)err(403,'التمرير لحامل القنبلة فقط');
  const target=a.find(q=>q.id===Number(b.target)&&q.id!==p.id);if(!target)err(400,'اختر لاعبًا آخر');
  r.holder=target.id;log(r,'💣 '+p.name+' مرر إلى '+target.name);
 }else if(r.game==='chairs'){
  if(type!=='chair')err(400,'اختر كرسيًا');
  if(p.seat)err(409,'حجزت كرسيًا بالفعل');
  const n=Number(b.target);
  if(!r.chairs.includes(n)||a.some(q=>q.seat===n))err(409,'الكرسي غير متاح');
  p.seat=n;log(r,'🪑 '+p.name+' حجز كرسي '+n);
  if(a.filter(q=>q.seat).length===r.chairs.length){for(const q of a)if(!q.seat)q.alive=false;r.phase='between';log(r,'انتهت جولة الكراسي');finish(r)}
 }else if(r.game==='boxes'){
  if(type!=='box')err(400,'اختر صندوقًا');
  if(p.choice)err(409,'اخترت صندوقك');
  const n=Number(b.target);
  if(!r.boxes.some(x=>x.id===n)||a.some(q=>q.choice===n))err(409,'الصندوق محجوز');
  p.choice=n;log(r,'🎁 '+p.name+' اختار صندوق '+n);
 }else err(400,'اللعبة غير معروفة');
}
function hostAction(r,b){
 const type=String(b.type||'');
 if(type==='connectChat'){const platform=String(b.platform||'');if(!['kick','twitch','tiktok'].includes(platform))err(400,'منصة غير معروفة');let channel;try{channel=chat.clean(platform,b.channel)}catch(e){err(400,e.message)}const previous=r.settings[platform];r.settings[platform]=channel;log(r,'💬 ربط '+platform+': '+channel);if(previous&&previous!==channel)chat.disconnect(platform,previous);chat.connect(platform,channel);return}
 if(type==='disconnectChat'){const platform=String(b.platform||'');if(!['kick','twitch','tiktok'].includes(platform))err(400,'منصة غير معروفة');const previous=r.settings[platform];delete r.settings[platform];if(previous)chat.disconnect(platform,previous);log(r,'🔌 فصل '+platform);return}
 if(type==='start'){start(r);return}
 if(type==='reset'){r.players=[];r.phase='lobby';r.round=0;r.winner=null;r.active=null;r.holder=null;r.chairs=[];r.doors=[];r.boxes=[];r.log=[];clearTimer(r);return}
 if(type==='open'){
  if(r.phase!=='ready')err(409,'الجولة ليست جاهزة');
  r.phase='playing';if(r.game==='bomb')endAt(r,r.remaining);
  log(r,'▶️ بدأت الجولة');return
 }
 if(type==='stop'){
  if(r.phase!=='playing')err(409,'الجولة ليست مفتوحة');
  if(r.game==='bomb'&&r.deadline)r.remaining=Math.max(0,r.deadline-Date.now());
  r.deadline=0;if(r.game!=='bomb')r.remaining=0;r.phase='ready';log(r,'⏸️ أوقف المقدم الجولة');return
 }
 if(type==='reveal'){
  if(r.game==='doors'){
   if(r.phase!=='playing')err(409,'ابدأ الجولة أولًا');
   const n=Number(b.limit);if(!Number.isInteger(n)||n<1||n>active(r).length)err(400,'عدد المتأهلين غير صحيح');
   const choices=active(r);if(choices.some(p=>!p.choice))err(409,'بعض اللاعبين لم يختاروا');
   const eligible=Array.isArray(b.qualified)?b.qualified.map(Number):[];
   if(eligible.length!==n||new Set(eligible).size!==n||eligible.some(id=>!choices.some(p=>p.id===id)))err(400,'حدد المتأهلين بشكل صحيح');
   for(const p of choices)if(!eligible.includes(p.id))p.alive=false;
   r.limit=n;r.opened=true;r.phase='between';log(r,'🚪 كشف الأبواب: تأهل '+n);finish(r);return
  }
  if(r.game==='boxes'){
   if(r.phase!=='playing')err(409,'ابدأ الجولة أولًا');
   const a=active(r);if(a.some(p=>!p.choice))err(409,'لم يختر الجميع صناديقهم');
   const crown=r.boxes.find(x=>x.crown);const winner=a.find(p=>p.choice===crown.id);
   for(const p of a)if(p!==winner)p.alive=false;
   r.opened=true;finish(r);return
  }
  err(400,'الكشف غير متاح لهذه اللعبة')
 }
 if(type==='next'){
  if(r.phase!=='between')err(409,'أنهِ الجولة الحالية أولًا');
  start(r);return
 }
 if(type==='eliminate'||type==='revive'){
  const p=r.players.find(p=>p.id===Number(b.target));if(!p)err(404,'اللاعب غير موجود');
  p.alive=type==='revive';log(r,(p.alive?'❤️ إنعاش ':'🚫 استبعاد ')+p.name);
  if(r.phase==='finished'){r.phase='between';r.winner=null}finish(r);return
 }
 if(type==='end'){
  if(r.game!=='roulette')err(400,'الإنهاء اليدوي مخصص للروليت');
  r.phase='between';r.active=null;log(r,'أوقف المقدم الروليت');return
 }
 if(type==='qualify'){
  const ids=Array.isArray(b.qualified)?b.qualified.map(Number):[];
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!r.players.some(p=>p.id===id)))err(400,'قائمة المتأهلين غير صحيحة');
  for(const p of r.players)p.alive=ids.includes(p.id);
  r.phase='between';r.winner=null;finish(r);log(r,'اعتمد المقدم المتأهلين');return
 }
 err(400,'أمر المقدم غير معروف')
}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>12000)err(413,'الطلب كبير جدًا')}try{return JSON.parse(raw||'{}')}catch(_){err(400,'بيانات غير صحيحة')}}
async function handle(req,res,url){
 try{
  for(const [c,r] of rooms)if(r.expires<Date.now()){rooms.delete(c);for(const x of streams.get(c)||[])x.end();streams.delete(c);for(const [platform,channel] of Object.entries(r.settings))chat.disconnect(platform,channel)}
  if(req.method==='GET'&&url.pathname==='/api/arcade/state'){const r=get(url.searchParams.get('room'));tick(r);return send(res,200,publicRoom(r))}
  if(req.method==='GET'&&url.pathname==='/api/arcade/events'){
   const r=get(url.searchParams.get('room'));res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
   res.write('retry: 2500\n\ndata: '+JSON.stringify(publicRoom(r))+'\n\n');
   if(!streams.has(r.code))streams.set(r.code,new Set());streams.get(r.code).add(res);
   const interval=setInterval(()=>{tick(r);try{res.write(': ping\n\n')}catch(_){}},1000);
   req.on('close',()=>{clearInterval(interval);streams.get(r.code)?.delete(res)});return
  }
  if(req.method!=='POST')return send(res,405,{error:'طريقة غير مدعومة'});
  const origin=req.headers.origin;if(origin){try{if(new URL(origin).host!==req.headers.host)err(403,'مصدر غير مسموح')}catch(_){err(403,'مصدر غير مسموح')}}
  const b=await body(req);
  if(url.pathname==='/api/arcade/create'){
   if(rooms.size>=150)err(503,'الغرف ممتلئة');
   if(!['roulette','doors','survival','bomb','chairs','boxes'].includes(b.game))err(400,'اختر لعبة صحيحة');
   const r={code:code(),game:b.game,hostToken:id(),players:[],phase:'lobby',round:0,rev:1,expires:Date.now()+TTL,active:null,holder:null,chairs:[],doors:[],boxes:[],opened:false,limit:0,log:[],winner:null,settings:{},deadline:0,remaining:0,startedAt:0,spin:0};
   rooms.set(r.code,r);return send(res,201,{room:r.code,hostToken:r.hostToken,state:publicRoom(r)})
  }
  const r=get(b.room);tick(r);
  if(url.pathname==='/api/arcade/join'){
   if(r.phase!=='lobby')err(409,'التسجيل مقفل بعد بدء اللعب');
   if(r.players.length>=100)err(409,'الحد الأقصى 100 لاعب');
   const name=safe(b.name);if(!name)err(400,'اكتب اسمك');
   if(/^(twitch|kick|tiktok):/i.test(name))err(400,'اختر اسمًا بدون اسم المنصة؛ هذا التنسيق محجوز للشات');
   if(r.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))err(409,'الاسم مستخدم');
   const p={id:r.players.length+1,name,token:id(),alive:true,seat:null,choice:null,skip:false};
   r.players.push(p);broadcast(r);return send(res,201,{playerToken:p.token,playerId:p.id,state:publicRoom(r)})
  }
  if(url.pathname==='/api/arcade/action'){const isHost=b.hostToken===r.hostToken;action(r,b,isHost);broadcast(r);return send(res,200,{ok:true,state:publicRoom(r)})}
  if(url.pathname==='/api/arcade/host'){host(r,b);hostAction(r,b);broadcast(r);return send(res,200,{ok:true,state:publicRoom(r)})}
  return send(res,404,{error:'المسار غير موجود'});
 }catch(e){return send(res,e.status||500,{error:e.status?e.message:'حدث خطأ في الخادم'})}
}
chat.bind({onMessage:chatCommand,onStatus:(platform,channel)=>{for(const r of rooms.values())if(r.settings[platform]===channel&&r.expires>Date.now())broadcast(r)},isActive:(platform,channel)=>[...rooms.values()].some(r=>r.settings[platform]===channel&&r.expires>Date.now())});
module.exports={handle,chatCommand,chat};