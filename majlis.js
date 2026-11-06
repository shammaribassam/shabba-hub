'use strict';
// Majlis: local in-memory room mode for in-person oral team play.
// No payments, microphones, recordings, external platform accounts or automatic answer grading.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
// Each Majlis question room uses the source bank of its chosen game.
const diwanText = fs.readFileSync(path.join(__dirname,'games','diwan','questions.js'),'utf8');
const diwanMatch = diwanText.match(/const questions=(\[[\s\S]*\]);?\s*$/);
const quizText = fs.readFileSync(path.join(__dirname,'games','quiz','questions.js'),'utf8');
const quizMatch = quizText.match(/^\s*window\.BSM_QUESTIONS\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
if(!diwanMatch||!quizMatch)throw new Error('Majlis question banks missing');
const banks = {
  diwan: JSON.parse(diwanMatch[1]).map(q=>({category:q[0],question:q[1],options:q.slice(2,6),correct:Number(q[6])})),
  quiz: JSON.parse(quizMatch[1]).map(q=>({category:q.category,question:q.question,options:q.options,correct:Number(q.correct)}))
};
const categoriesByGame = Object.fromEntries(Object.entries(banks).map(([game,list])=>[game,[...new Set(list.map(q=>q.category))]]));
const rooms = new Map();
const MAX_ROOMS = 200;
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_TEAMS = 12;
const MAX_PLAYERS = 60;
const clients = new Map();

function json(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function randomCode() {
  for (let i=0;i<100;i++) {
    const code=String(crypto.randomInt(100000,1000000));
    if (!rooms.has(code)) return code;
  }
  throw new Error('No room code available');
}
function token() { return crypto.randomBytes(32).toString('hex'); }
function cleanText(value, max=80) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[<>\\u0000-\\u001f]/g,'').slice(0,max);
}
function publicState(room) {
  return {
    code:room.code, game:room.game, mode:room.mode, question:room.question, category:room.category, options:room.options||[], revealed:!!room.revealed, answer:room.revealed?room.answer:null,
    teams:room.teams.map(t=>({id:t.id,name:t.name,score:t.score,players:t.players.length})),
    activeTeamId:room.activeTeamId, buzzerOpen:room.buzzerOpen,
    buzzedTeamId:room.buzzedTeamId, revision:room.revision,
    expiresAt:room.expiresAt
  };
}
function touch(room) { room.expiresAt=Date.now()+TTL_MS; }
function broadcast(room) {
  room.revision++;
  const message='data: '+JSON.stringify(publicState(room))+'\n\n';
  for (const res of clients.get(room.code)||[]) {
    try { res.write(message); } catch (_) {}
  }
}
function cleanup() {
  for (const [code,room] of rooms) {
    if (room.expiresAt < Date.now()) {
      rooms.delete(code);
      for (const res of clients.get(code)||[]) { try {res.end();} catch (_) {} }
      clients.delete(code);
    }
  }
}
function checkOrigin(req) {
  const origin=req.headers.origin;
  if (!origin) return true;
  try {
    const host=req.headers.host;
    return new URL(origin).host===host && /^https?:$/.test(new URL(origin).protocol);
  } catch (_) { return false; }
}
function readBody(req) {
  return new Promise((resolve,reject)=>{
    let raw=''; let done=false;
    req.on('data',chunk=>{
      if(done)return;
      raw+=chunk;
      if(raw.length>8192){done=true;reject(new Error('Request too large'));req.destroy();}
    });
    req.on('end',()=>{
      if(done)return;
      try { resolve(JSON.parse(raw||'{}')); } catch(_) { reject(new Error('Invalid JSON')); }
    });
    req.on('error',reject);
  });
}
function normalizeCode(value) {
  return String(value||'').trim().replace(/[٠-٩]/g,ch=>String(ch.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,ch=>String(ch.charCodeAt(0)-0x6f0));
}
function getRoom(code) {
  if(!/^\d{6}$/.test(normalizeCode(code)))return null;
  const room=rooms.get(normalizeCode(code));
  if(!room)return null;
  if(room.expiresAt<Date.now()){rooms.delete(room.code);return null;}
  return room;
}
function authorized(room, body) {
  return typeof body.hostToken==='string' && body.hostToken.length===64 &&
    crypto.timingSafeEqual(Buffer.from(body.hostToken),Buffer.from(room.hostToken));
}
function validTeam(room, id) { return room.teams.find(t=>t.id===id); }
function playerAuthorized(team, body) {
  return typeof body.playerToken==='string' && team.players.includes(body.playerToken);
}
async function handle(req,res,url) {
  if(!url.pathname.startsWith('/api/majlis/'))return false;
  cleanup();
  if(req.method==='GET' && url.pathname==='/api/majlis/categories') {
    const game=url.searchParams.get('game')||'diwan';
    if(!banks[game])return json(res,400,{error:'لعبة غير معروفة'});
    const categories=categoriesByGame[game];
    return json(res,200,{game,categories,counts:Object.fromEntries(categories.map(c=>[c,banks[game].filter(q=>q.category===c).length]))});
  }
  if(req.method==='GET' && url.pathname==='/api/majlis/state') {
    const room=getRoom(url.searchParams.get('room'));
    return json(res,room?200:404,room?publicState(room):{error:'الغرفة غير موجودة أو انتهت'});
  }
  if(req.method==='GET' && url.pathname==='/api/majlis/events') {
    const room=getRoom(url.searchParams.get('room'));
    if(!room)return json(res,404,{error:'الغرفة غير موجودة'});
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write('retry: 3000\n\ndata: '+JSON.stringify(publicState(room))+'\n\n');
    if(!clients.has(room.code))clients.set(room.code,new Set());
    clients.get(room.code).add(res);
    const heartbeat=setInterval(()=>{try{res.write(': ping\n\n');}catch(_){}},25000);
    req.on('close',()=>{clearInterval(heartbeat);clients.get(room.code)?.delete(res);});
    return true;
  }
  if(req.method!=='POST')return json(res,405,{error:'طريقة الطلب غير مدعومة'});
  if(!checkOrigin(req))return json(res,403,{error:'طلب غير مسموح'});
  let body;
  try{body=await readBody(req);}catch(e){return json(res,400,{error:e.message});}
  if(url.pathname==='/api/majlis/create') {
    if(rooms.size>=MAX_ROOMS)return json(res,503,{error:'الغرف ممتلئة حاليًا'});
    const game=String(body.game||'diwan');
    if(!banks[game])return json(res,400,{error:'اختر لعبة صحيحة'});
    const room={code:randomCode(),hostToken:token(),game,mode:'manual',question:'',category:categoriesByGame[game][0]||'',options:[],answer:null,revealed:false,usedQuestions:[],teams:[],
      activeTeamId:null,buzzerOpen:false,buzzedTeamId:null,revision:1,expiresAt:Date.now()+TTL_MS};
    rooms.set(room.code,room);
    return json(res,201,{room:room.code,hostToken:room.hostToken,state:publicState(room)});
  }
  const room=getRoom(body.room);
  if(!room)return json(res,404,{error:'الغرفة غير موجودة أو انتهت'});
  if(url.pathname==='/api/majlis/join') {
    const team=validTeam(room,body.teamId);
    if(!team)return json(res,404,{error:'الفريق غير موجود'});
    const total=room.teams.reduce((sum,t)=>sum+t.players.length,0);
    if(total>=MAX_PLAYERS)return json(res,409,{error:'الغرفة ممتلئة'});
    const playerToken=token();
    team.players.push(playerToken);touch(room);broadcast(room);
    return json(res,200,{playerToken,teamId:team.id,state:publicState(room)});
  }
  if(url.pathname==='/api/majlis/buzz') {
    const team=validTeam(room,body.teamId);
    if(!team||!playerAuthorized(team,body))return json(res,403,{error:'انضم للفريق أولًا'});
    if(room.mode!=='buzzer'||!room.buzzerOpen||room.buzzedTeamId)return json(res,409,{error:'الجرس مقفل أو سبقك فريق آخر'});
    room.buzzedTeamId=team.id;room.activeTeamId=team.id;room.buzzerOpen=false;
    touch(room);broadcast(room);
    return json(res,200,{ok:true,state:publicState(room)});
  }
  if(!authorized(room,body))return json(res,403,{error:'صلاحية مقدم المسابقة مطلوبة'});
  if(url.pathname==='/api/majlis/next-question') {
    const category=String(body.category||room.category||'');
    const bank=banks[room.game];
    if(!categoriesByGame[room.game].includes(category))return json(res,400,{error:'اختر فئة الأسئلة'});
    const available=bank.map((q,i)=>({q,i})).filter(x=>x.q.category===category&&!room.usedQuestions.includes(x.i));
    if(!available.length)room.usedQuestions=room.usedQuestions.filter(i=>bank[i]?.category!==category);
    const pool=available.length?available:bank.map((q,i)=>({q,i})).filter(x=>x.q.category===category);
    const selected=pool[crypto.randomInt(pool.length)];
    room.usedQuestions.push(selected.i);room.category=category;room.question=selected.q.question;room.options=selected.q.options;room.answer=selected.q.correct;room.revealed=false;
    room.activeTeamId=null;room.buzzedTeamId=null;room.buzzerOpen=false;
  } else if(url.pathname==='/api/majlis/reveal') {
    room.revealed=true;
  } else if(url.pathname==='/api/majlis/team') {
    const name=cleanText(body.name,35);
    if(!name)return json(res,400,{error:'اكتب اسم الفريق'});
    if(room.teams.length>=MAX_TEAMS)return json(res,409,{error:'الحد الأقصى 12 فريقًا'});
    if(room.teams.some(t=>t.name===name))return json(res,409,{error:'اسم الفريق مستخدم'});
    room.teams.push({id:crypto.randomBytes(8).toString('hex'),name,score:0,players:[]});
  } else if(url.pathname==='/api/majlis/settings') {
    if(!['manual','buzzer'].includes(body.mode))return json(res,400,{error:'وضع غير معروف'});
    room.mode=body.mode;room.activeTeamId=null;room.buzzedTeamId=null;room.buzzerOpen=false;
  } else if(url.pathname==='/api/majlis/question') {
    room.question=cleanText(body.question,500);room.options=[];room.answer=null;room.revealed=false;
    room.activeTeamId=null;room.buzzedTeamId=null;room.buzzerOpen=false;
  } else if(url.pathname==='/api/majlis/select') {
    if(room.mode!=='manual')return json(res,409,{error:'غيّر إلى وضع اختيار المقدم'});
    if(body.teamId!==null&&!validTeam(room,body.teamId))return json(res,404,{error:'الفريق غير موجود'});
    room.activeTeamId=body.teamId;room.buzzerOpen=false;room.buzzedTeamId=null;
  } else if(url.pathname==='/api/majlis/buzzer') {
    if(room.mode!=='buzzer')return json(res,409,{error:'غيّر إلى وضع الجرس'});
    room.buzzerOpen=Boolean(body.open);room.buzzedTeamId=null;room.activeTeamId=null;
  } else if(url.pathname==='/api/majlis/score') {
    const team=validTeam(room,body.teamId);
    if(!team)return json(res,404,{error:'الفريق غير موجود'});
    if(!Number.isInteger(body.delta)||Math.abs(body.delta)>100)return json(res,400,{error:'النقاط غير صحيحة'});
    team.score+=body.delta;
  } else if(url.pathname==='/api/majlis/reset') {
    if(body.reset!=='scores')return json(res,400,{error:'طلب غير معروف'});
    for(const t of room.teams)t.score=0;
    room.activeTeamId=null;room.buzzedTeamId=null;room.buzzerOpen=false;
  } else return json(res,404,{error:'المسار غير موجود'});
  touch(room);broadcast(room);
  return json(res,200,{ok:true,state:publicState(room)});
}
module.exports={handle};
