'use strict';
const crypto=require('node:crypto');
const chat=require('./arcade-chat');
const rooms=new Map(),streams=new Map();
const TTL=6*3600*1000;
const GAMES=['roulette','doors','survival','bomb','boxes','shot'];
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
   // Every platform accepts short game-specific chat commands; old !commands still work.
   const normalized=text.replace(/^[!！]/u,'').trim();
   const cmd=normalized.match(/^(انضم|طرد|إنعاش|انعاش|سكيب|نجاة|مرر|صندوق|باب)(?:\s+([0-9٠-٩۰-۹]+))?$/u);
   const bareNumber=normalized.match(/^([0-9٠-٩۰-۹]+)$/u);
   const name=platform+':'+who;
   let p=r.players.find(x=>x.name.toLowerCase()===name.toLowerCase());
   // Joining must use !انضم. Other game actions do not require an exclamation.
   if(cmd?.[1]==='انضم'&&!cmd[2]){
    if(!/^[!！]\s*انضم$/u.test(text))continue;
    if(r.phase==='lobby'&&!p&&!r.banned.some(x=>x.toLowerCase()===name.toLowerCase())&&r.players.length<100){p={id:r.nextPlayerId++,name,token:id(),alive:true,seat:null,choice:null,skip:false,shield:false};r.players.push(p);log(r,'💬 انضم '+name);broadcast(r);count++}
    continue;
   }
   if(!p||!p.alive||r.phase!=='playing')continue;
   const typesByGame={
    roulette:{'طرد':'kick','إنعاش':'revive','انعاش':'revive','سكيب':'skip'},
    doors:{'باب':'choose'},
    survival:{'نجاة':'save'},
    bomb:{'مرر':'pass'},
    boxes:{'صندوق':'box'}
   };
   const numberText=bareNumber?.[1]||cmd?.[2]||'';
   const westernDigits=numberText.replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-0x6f0));
   const type=bareNumber?(r.game==='doors'?'choose':r.game==='boxes'?'box':null):typesByGame[r.game]?.[cmd?.[1]];
   if(!type)continue;
   const needsNumber=['kick','revive','pass','box','choose'].includes(type);
   if(needsNumber&&!/^[0-9]+$/.test(westernDigits))continue;
   if(!needsNumber&&westernDigits)continue;
   action(r,{type,playerToken:p.token,target:needsNumber?Number(westernDigits):undefined},false);broadcast(r);count++;
  }catch(e){
   // Surface rejected chat actions to the host so a failed command is diagnosable.
   log(r,'⚠️ أمر '+platform+' من '+who+' لم ينفذ: '+(e.message||'خطأ غير معروف'));
   broadcast(r);
  }
 }
 return count;
}
function publicRoom(r){return {code:r.code,game:r.game,phase:r.phase,round:r.round,revision:r.rev,players:r.players.map(p=>({id:p.id,name:p.name,alive:p.alive,seat:p.seat||null,choice:p.choice||null,skip:p.skip||false,shield:!!p.shield})),active:r.active,holder:r.holder,bombExplosion:r.bombExplosion||null,doors:r.doors,boxes:r.boxes.map(b=>({id:b.id,effect:r.opened?b.effect:undefined})),opened:r.opened,shot:r.opened?r.shotTarget:null,shotResult:r.opened?r.shotResult:null,shotRevealedAt:r.opened?r.shotRevealedAt:null,limit:r.limit,log:r.log.slice(-12),winner:r.winner,settings:r.settings,chat:Object.fromEntries(Object.entries(r.settings).map(([p,c])=>[p,{channel:c,...chat.status(p,c)}])),spin:r.spin||0,spinUntil:r.spinUntil||0,banned:r.banned.slice(),now:Date.now()}}
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
function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=rnd(i+1);[a[i],a[j]]=[a[j],a[i]]}return a}
function boxKick(r,p){
 if(!p||!p.alive||active(r).length===1)return;
 if(p.shield){p.shield=false;log(r,'🛡️ حصانة '+p.name+' حمت من الإقصاء');return}
 p.alive=false;log(r,'🚫 استُبعد '+p.name)
}
function resolveBoxes(r){
 const chosen=active(r).map(p=>({p,b:r.boxes.find(b=>b.id===p.choice)}));
 const labels={eliminate:'إقصاء',shield:'حصانة',rescue:'إنقاذ',swap:'تبديل مصير',safe:'أمان'};
 for(const {p,b} of chosen)log(r,'🎁 صندوق '+b.id+' لـ '+p.name+': '+labels[b.effect]);
 for(const {p,b} of chosen)if(b.effect==='shield'){p.shield=true;log(r,'🛡️ '+p.name+' حصل على حصانة')}
 for(const {p,b} of chosen)if(b.effect==='rescue'){const out=r.players.filter(q=>!q.alive);if(out.length){const target=pick(out);target.alive=true;target.shield=false;log(r,'❤️ '+p.name+' أنقذ '+target.name)}else{p.shield=true;log(r,'❤️ '+p.name+' أخذ حصانة بدل الإنقاذ')}}
 for(const {p,b} of chosen)if(b.effect==='swap'&&p.alive){const others=active(r).filter(q=>q.id!==p.id);if(others.length){const target=pick(others);log(r,'🎭 '+p.name+' نقل الغدر إلى '+target.name);boxKick(r,target)}}
 for(const {p,b} of chosen)if(b.effect==='eliminate')boxKick(r,p);
 for(const {p,b} of chosen)if(b.effect==='safe')log(r,'✨ أمان لـ '+p.name);
 r.opened=true;if(!finish(r))r.phase='between'
}
function start(r){
 if(r.players.length<2)err(409,'يلزم لاعبان على الأقل');
 if(r.phase==='playing')err(409,'الجولة بدأت بالفعل');
 if(r.phase==='finished')err(409,'اللعبة انتهت؛ أنشئ غرفة جديدة');
 r.round++;r.phase='playing';r.startedAt=Date.now();clearTimer(r);r.active=null;r.holder=null;r.bombExplosion=null;r.shotTarget=null;r.shotResult=null;r.shotRevealedAt=null;r.opened=false;
 for(const p of r.players){p.choice=null;p.seat=null}
 const a=active(r);
 if(r.game==='roulette'){r.spin=(r.spin||0)+1;r.active=pick(a).id;r.spinUntil=Date.now()+5100;log(r,'🎡 الروليت يدور...')}
 if(r.game==='doors'){r.doors=Array.from({length:Math.min(18,a.length)},(_,i)=>({id:i+1,result:null}));log(r,'🚪 اختاروا الأبواب')}
 if(r.game==='survival'){r.limit=Math.min(8,Math.max(1,a.length-1));log(r,'🚨 زر النجاة مفتوح الآن')}
 if(r.game==='bomb'){r.holder=pick(a).id;r.remaining=crypto.randomInt(12000,32001);endAt(r,r.remaining);log(r,'💣 القنبلة عند '+a.find(p=>p.id===r.holder).name)}
 if(r.game==='boxes'){const effects=shuffle(['eliminate','shield','rescue','swap',...Array(Math.max(0,a.length-4)).fill('safe')].slice(0,a.length));r.boxes=effects.map((effect,i)=>({id:i+1,effect}));log(r,'🎁 اختاروا الصناديق، كل صندوق يحمل مفاجأة')}
 if(r.game==='shot'){r.shotTarget=pick(a).id;log(r,'🎯 جاهزة الطلقة الغادرة؛ ينتظر كشف المقدم')}
}
function tick(r){if(r.game==='bomb'&&r.phase==='playing'&&r.deadline&&Date.now()>=r.deadline){const p=r.players.find(p=>p.id===r.holder);if(p){p.alive=false;r.bombExplosion={id:p.id,name:p.name};log(r,'💥 انفجرت القنبلة مع '+p.name)}clearTimer(r);if(!finish(r))r.phase='between';broadcast(r)}}
function action(r,b,byHost){
 tick(r);
 const type=String(b.type||'');
 const p=byHost?r.players.find(p=>p.id===Number(b.playerId)):player(r,b);
 if(!p||!p.alive)err(409,'اللاعب غير مؤهل');
 if(r.phase!=='playing')err(409,'الجولة غير مفتوحة');
 const a=active(r);
 if(r.game==='roulette'){
  if(Date.now()<r.spinUntil)err(409,'انتظر توقف الروليت أولًا');
   if(p.id!==r.active)err(403,'الأمر لصاحب الدور فقط');
  if(type==='skip'){if(p.skip)err(409,'استخدمت السكيب سابقًا');p.skip=true;log(r,'⏭️ سكيب '+p.name)}
  else if(type==='kick'||type==='revive'){
   const target=r.players.find(q=>q.id===Number(b.target));
   if(!target||target.id===p.id)err(400,'رقم اللاعب غير صحيح');
   if(type==='kick'){if(!target.alive)err(409,'اللاعب مستبعد أصلًا');target.alive=false;log(r,'🚫 '+p.name+' طرد '+target.name)}
   else {if(target.alive)err(409,'اللاعب موجود أصلًا');target.alive=true;log(r,'❤️ '+p.name+' أنعش '+target.name)}
  }else err(400,'الأمر غير معروف');
  if(!finish(r)){const survivors=active(r);r.active=pick(survivors).id;r.spin=(r.spin||0)+1;r.spinUntil=Date.now()+5100;log(r,'🎡 الروليت يدور...')}
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
 }else if(r.game==='shot'){
  err(409,'الطلقة الغادرة يعلنها المقدم');
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
 if(type==='switchGame'){if(!GAMES.includes(b.game))err(400,'اختر لعبة صحيحة');r.game=b.game;r.phase='lobby';r.round=0;r.winner=null;r.active=null;r.holder=null;r.bombExplosion=null;r.doors=[];r.boxes=[];r.opened=false;r.shotTarget=null;r.shotResult=null;r.shotRevealedAt=null;r.limit=0;r.spin=0;r.spinUntil=0;clearTimer(r);for(const p of r.players){p.alive=true;p.seat=null;p.choice=null;p.skip=false;p.shield=false}r.log=[];log(r,'🎮 لعبة جديدة بنفس الغرفة وربط الشات');return}
 if(type==='removePlayer'){
  const p=r.players.find(p=>p.id===Number(b.playerId));if(!p)err(404,'المشارك غير موجود');
  if(!r.banned.some(x=>x.toLowerCase()===p.name.toLowerCase()))r.banned.push(p.name);
  r.players=r.players.filter(x=>x!==p);
  const survivors=active(r);
  if(r.active===p.id)r.active=null;
  // Removing any wheel segment changes its geometry, so restart the spin fairly.
  if(r.game==='roulette'&&r.phase==='playing'&&survivors.length>1){
   r.active=pick(survivors).id;r.spin=(r.spin||0)+1;r.spinUntil=Date.now()+5100;log(r,'🎡 الروليت يدور...');
  }
  if(r.holder===p.id){r.holder=null;if(r.game==='bomb'&&r.phase==='playing'&&survivors.length>1){r.holder=pick(survivors).id;log(r,'💣 انتقلت القنبلة إلى '+survivors.find(x=>x.id===r.holder).name)}}
  if(r.shotTarget===p.id){r.shotTarget=null;if(r.game==='shot'&&r.phase==='playing'&&survivors.length>1)r.shotTarget=pick(survivors).id}
  if(r.winner===p.id)r.winner=null;
  if(r.game==='survival'&&r.phase==='playing')r.limit=Math.min(r.limit,Math.max(1,survivors.length-1));
  log(r,'🚪 أخرج المقدم '+p.name+' من الجلسة');
  if(r.phase!=='lobby'&&survivors.length===1)finish(r);
  else if(r.phase!=='lobby'&&survivors.length===0){r.phase='between';clearTimer(r)}
  return
 }
 if(type==='unbanPlayer'){
  const name=String(b.name||'').trim();if(!r.banned.some(x=>x.toLowerCase()===name.toLowerCase()))err(404,'المشارك غير موجود في قائمة المطرودين');
  r.banned=r.banned.filter(x=>x.toLowerCase()!==name.toLowerCase());log(r,'🔓 سمح المقدم بعودة '+name);return
 }
 if(type==='start'){start(r);return}
 if(type==='reset'){r.players=[];r.banned=[];r.nextPlayerId=1;r.phase='lobby';r.round=0;r.winner=null;r.active=null;r.holder=null;r.bombExplosion=null;r.doors=[];r.boxes=[];r.shotTarget=null;r.shotResult=null;r.shotRevealedAt=null;r.log=[];clearTimer(r);return}
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
   const selected=choices.map(p=>p.id);for(let i=selected.length-1;i>0;i--){const j=rnd(i+1);[selected[i],selected[j]]=[selected[j],selected[i]]}const eligible=new Set(selected.slice(0,n));
   for(const p of choices)if(!eligible.has(p.id))p.alive=false;
   for(const d of r.doors)d.result=choices.some(p=>p.choice===d.id&&eligible.has(p.id))?'safe':'out';
   r.limit=n;r.opened=true;r.phase='between';log(r,'🚪 كشف الأبواب: تأهل '+n+' عشوائيًا');finish(r);return
  }
  if(r.game==='boxes'){
   if(r.phase!=='playing')err(409,'ابدأ الجولة أولًا');
   if(active(r).some(p=>!p.choice))err(409,'لم يختر الجميع صناديقهم');
   resolveBoxes(r);return
  }
  if(r.game==='shot'){
   if(r.phase!=='playing'||!r.shotTarget)err(409,'ابدأ جولة الطلقة أولًا');
   const victim=r.players.find(p=>p.id===r.shotTarget);
   // Six animated chambers: one live round, five empty. The result is decided once on the server.
   const hit=crypto.randomInt(6)===0;
   r.opened=true;r.shotResult=hit?'hit':'empty';r.shotRevealedAt=Date.now();
   if(hit){boxKick(r,victim);log(r,'💥 طلقة حقيقية! استُبعد '+victim.name)}
   else log(r,'✨ الطلقة فاضية! نجا '+victim.name);
   if(!finish(r))r.phase='between';return
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
  r.phase='between';r.active=null;r.spinUntil=0;log(r,'أوقف المقدم الروليت');return
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
   if(!GAMES.includes(b.game))err(400,'اختر لعبة صحيحة');
   const r={code:code(),game:b.game,hostToken:id(),players:[],phase:'lobby',round:0,rev:1,expires:Date.now()+TTL,active:null,holder:null,bombExplosion:null,doors:[],boxes:[],opened:false,shotTarget:null,shotResult:null,shotRevealedAt:null,limit:0,log:[],winner:null,settings:{},deadline:0,remaining:0,startedAt:0,spin:0,spinUntil:0,nextPlayerId:1,banned:[]};
   rooms.set(r.code,r);return send(res,201,{room:r.code,hostToken:r.hostToken,state:publicRoom(r)})
  }
  const r=get(b.room);tick(r);
  if(url.pathname==='/api/arcade/join'){
   if(r.phase!=='lobby')err(409,'التسجيل مقفل بعد بدء اللعب');
   if(r.players.length>=100)err(409,'الحد الأقصى 100 لاعب');
   const name=safe(b.name);if(!name)err(400,'اكتب اسمك');
   if(/^(twitch|kick|tiktok):/i.test(name))err(400,'اختر اسمًا بدون اسم المنصة؛ هذا التنسيق محجوز للشات');
   if(r.banned.some(x=>x.toLowerCase()===name.toLowerCase()))err(403,'أخرجك المقدم من الجلسة؛ لا يمكنك العودة إلا بإذنه');
    if(r.players.some(p=>p.name.toLowerCase()===name.toLowerCase()))err(409,'الاسم مستخدم');
   const p={id:r.nextPlayerId++,name,token:id(),alive:true,seat:null,choice:null,skip:false,shield:false};
   r.players.push(p);broadcast(r);return send(res,201,{playerToken:p.token,playerId:p.id,state:publicRoom(r)})
  }
  if(url.pathname==='/api/arcade/action'){const isHost=b.hostToken===r.hostToken;action(r,b,isHost);broadcast(r);return send(res,200,{ok:true,state:publicRoom(r)})}
  if(url.pathname==='/api/arcade/host'){host(r,b);hostAction(r,b);broadcast(r);return send(res,200,{ok:true,state:publicRoom(r)})}
  return send(res,404,{error:'المسار غير موجود'});
 }catch(e){return send(res,e.status||500,{error:e.status?e.message:'حدث خطأ في الخادم'})}
}
chat.bind({onMessage:chatCommand,onStatus:(platform,channel)=>{for(const r of rooms.values())if(r.settings[platform]===channel&&r.expires>Date.now())broadcast(r)},isActive:(platform,channel)=>[...rooms.values()].some(r=>r.settings[platform]===channel&&r.expires>Date.now())});
module.exports={handle,chatCommand,chat};