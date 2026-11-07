'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Module=require('node:module');
const {Readable}=require('node:stream');
const questions=require('./seen-questions');
const fakeChat={bind(){},clean(_p,c){return String(c).trim().toLowerCase()},status(){return {state:'connected'}},connect(){},disconnect(){}};
const load=Module._load;
Module._load=function(request,parent,isMain){
 if(request==='./arcade-chat'&&parent?.filename?.endsWith('/seen.js'))return fakeChat;
 return load.apply(this,arguments);
};
const seen=require('./seen');
Module._load=load;
async function call(endpoint,data={},method='POST',id=''){
 const req=Readable.from([JSON.stringify(data)]);req.method=method;req.headers={host:'localhost',origin:'http://localhost'};
 let status=0,body='';
 const res={writeHead(s){status=s},end(s){body=String(s||'')},write(){}};
 const url=new URL('http://localhost/api/seen/'+endpoint+(id?'?room='+id:''));
 await seen.handle(req,res,url);
 return {status,data:JSON.parse(body)};
}
test('bank tracks real progress toward 2000 unique questions per category',()=>{
 assert.equal(questions.length,12);
 assert.ok(questions.reduce((n,c)=>n+c.tiers.flat().length,0)>=1512);
 for(const c of questions){
  assert.ok(c.tiers.every(t=>t.length>=42),c.id+' needs at least 26 questions per tier');
  assert.equal(c.target,2000);
  assert.equal(c.count,c.tiers.flat().length);
  assert.equal(c.remaining,2000-c.count);
  assert.equal(new Set(c.tiers.flat().map(q=>q.question)).size,c.count);
  assert.equal(new Set(c.tiers.flat().map(q=>q.id)).size,c.count);
 }
});
test('two captains, turn-taking, steal, score, privacy and undo',async()=>{
 const created=await call('create');assert.equal(created.status,201);
 const {room,hostToken}=created.data;
 const host=(type,data={})=>call('host',{room,hostToken,type,...data});
 const state=()=>call('state',{},'GET',room);
 assert.equal((await call('host',{room,type:'start'})).status,403);
 await host('connectChat',{platform:'twitch',channel:'bsm'});
 assert.equal(seen.chatMessage('twitch','bsm','alpha','!انضم'),1);
 assert.equal(seen.chatMessage('twitch','bsm','beta','!انضم'),1);
 assert.equal(seen.chatMessage('twitch','other','gamma','!انضم'),0);
 let s=(await state()).data;
 assert.equal(s.players.length,2);
 await host('assign',{playerId:s.players[0].id,team:0});
 await host('assign',{playerId:s.players[1].id,team:1});
 await host('captain',{playerId:s.players[0].id,team:0});
 await host('captain',{playerId:s.players[1].id,team:1});
 const categories=questions.slice(0,6).map(c=>c.id);
 s=(await host('start',{names:['الأول','الثاني'],categories,duration:60,stealDuration:15})).data.state;
 assert.equal(s.slots.length,36);
 assert.equal(s.slots.filter(q=>q.value===200).length,12);
 assert.equal(s.slots.filter(q=>q.value===400).length,12);
 assert.equal(s.slots.filter(q=>q.value===600).length,12);
 const slot=s.slots[0];
 await host('pick',{slotId:slot.id});
 s=(await state()).data;assert.equal(s.current.answer,null);
 assert.equal((await call('secret',{room,hostToken:'bad'})).status,403);
 assert.ok((await call('secret',{room,hostToken})).data.answer);
 assert.equal(seen.chatMessage('twitch','bsm','beta','!جواب غير صحيح'),0);
 assert.equal(seen.chatMessage('twitch','bsm','alpha','!جواب إجابة نهائية'),1);
 s=(await state()).data;assert.equal(s.current.waiting,true);
 assert.equal(s.current.submission.name,'alpha');
 assert.equal(seen.chatMessage('twitch','bsm','alpha','!جواب ثانية'),0);
 s=(await host('wrong')).data.state;
 assert.equal(s.current.stage,'steal');assert.equal(s.current.team,1);
 assert.equal(seen.chatMessage('twitch','bsm','beta','!جواب محاولة سرقة'),1);
 s=(await host('award')).data.state;
 assert.equal(s.scores[1],slot.value);assert.equal(s.turn,1);assert.equal(s.used,1);
 s=(await host('undo')).data.state;
 assert.equal(s.scores[1],0);assert.equal(s.used,0);
 assert.equal((await host('finish')).data.state.phase,'finished');
});
test('question timeouts advance to steal and then to next turn',async()=>{
 const c=(await call('create')).data,{room,hostToken}=c;
 const host=(type,data={})=>call('host',{room,hostToken,type,...data});
 const original=Date.now;let now=original();
 try{
  Date.now=()=>now;
  let s=(await host('start',{names:['A','B'],categories:questions.slice(0,6).map(x=>x.id),duration:30,stealDuration:10})).data.state;
  await host('pick',{slotId:s.slots[0].id});
  now+=31000;s=(await call('state',{},'GET',room)).data;
  assert.equal(s.current.stage,'steal');
  now+=11000;s=(await call('state',{},'GET',room)).data;
  assert.equal(s.phase,'board');assert.equal(s.turn,1);assert.equal(s.used,1);
 }finally{Date.now=original}
});

test('homepage ordering and inline viewer script are valid',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const home=fs.readFileSync(require('node:path').join(__dirname,'index.html'),'utf8');
 const arcade=home.indexOf('id="arcade"'),seen=home.indexOf('id="seen"'),majlis=home.indexOf('id="majlis"');
 assert.ok(arcade>=0&&arcade<seen&&seen<majlis,'majlis must remain the final game section');
 const html=fs.readFileSync(require('node:path').join(__dirname,'seen.html'),'utf8');
 const script=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(script,'trivia browser script exists');
 new vm.Script(script[1],{filename:'seen.html'});
});

test('new games avoid repeating a category question until its tier pool is exhausted',async()=>{
 const created=(await call('create')).data;
 const host=(type,data={})=>call('host',{room:created.room,hostToken:created.hostToken,type,...data});
 const categories=questions.slice(0,6).map(c=>c.id);
 const seen=new Set();
 for(let round=0;round<4;round++){
  const started=(await host('start',{names:['A','B'],categories,duration:60,stealDuration:15})).data.state;
  assert.equal(started.slots.length,36);
  for(const slot of started.slots){
   assert.equal(seen.has(slot.id),false,'repeated question before exhausting the tier');
   seen.add(slot.id);
  }
  await host('reset');
 }
 assert.equal(seen.size,144);
});

test('point tiers always match the competitive 200/400/600 board',()=>{
 const expected=[200,400,600];
 for(const category of questions){
  assert.equal(category.target,2000);
  assert.ok(category.count<=2000);
  for(let tier=0;tier<3;tier++){
   for(const q of category.tiers[tier]){
    assert.equal(q.value,expected[tier],category.id+': '+q.question);
    assert.ok(q.question.trim().length>8);
    assert.ok(q.answer.trim().length>0);
   }
  }
 }
});

test('category selector does not expose bank sizes to players',async()=>{
 const response=await call('categories',{},'GET');
 assert.equal(response.status,200);
 assert.equal(response.data.categories.length,12);
 for(const cat of response.data.categories){
  assert.deepEqual(Object.keys(cat).sort(),['id','name']);
 }
 const fs=require('node:fs'),html=fs.readFileSync(require('node:path').join(__dirname,'seen.html'),'utf8');
 assert.ok(!html.includes("c.count+' / '+c.target"));
 assert.ok(!html.includes('الهدف 2,000 سؤال لكل فئة'));
});
test('new rooms reuse browser rotation without repeating questions until tier deck exhausted',async()=>{
 const chosen=questions.slice(0,6).map(c=>c.id);
 let rotation={};
 const all=new Set();
 for(let round=0;round<9;round++){
  const created=(await call('create')).data;
  const result=await call('host',{room:created.room,hostToken:created.hostToken,type:'start',names:['أ','ب'],categories:chosen,rotation});
  assert.equal(result.status,200);
  const {state}=result.data;
  rotation=result.data.rotation;
  assert.equal(state.slots.length,36);
  assert.deepEqual([...state.categories].sort(),[...chosen].sort());
  assert.equal(Object.keys(rotation).length,18);
  for(const slot of state.slots){
   assert.ok(!all.has(slot.id),'question repeated in a new room before its category tier exhausted');
   all.add(slot.id);
  }
 }
 assert.equal(all.size,324);
 const created=(await call('create')).data;
 const result=await call('host',{room:created.room,hostToken:created.hostToken,type:'start',names:['أ','ب'],categories:chosen,rotation});
 assert.equal(result.status,200);
 assert.equal(result.data.state.slots.length,36);
});

test('batches 004 through 009 contain balanced tiers for every category',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const ids=questions.map(c=>c.id);
 for(const id of ids){
  for(const batch of ['004','005','006','007','008','009']){
   const pack=JSON.parse(fs.readFileSync(path.join(__dirname,'seen-question-packs',id+'-batch-'+batch+'.json'),'utf8'));
   assert.equal(pack.category,id);
   assert.equal(pack.questions.length,12);
   assert.deepEqual([200,400,600].map(value=>pack.questions.filter(q=>q.value===value).length),[4,4,4]);
   assert.equal(new Set(pack.questions.map(q=>q.question)).size,12);
  }
 }
});

test('every category includes at least 126 original questions, balanced by value',()=>{
 const totals=questions.map(c=>({category:c.id,count:c.tiers.flat().length,byTier:c.tiers.map(t=>t.length)}));
 assert.equal(totals.length,12);
 for(const c of totals){
  assert.ok(c.count>=126,c.category+' has only '+c.count);
  assert.ok(c.byTier.every(n=>n>=42),c.category+' is missing questions in a point tier');
 }
});

test('every 008/009 question has unique normalized text within its category',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const normalized=s=>String(s).normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().toLowerCase();
 for(const cat of questions){
  const keys=cat.tiers.flat().map(q=>normalized(q.question));
  assert.equal(new Set(keys).size,keys.length,cat.id+' has a normalized duplicate');
  for(const batch of ['008','009']){
   const pack=JSON.parse(fs.readFileSync(path.join(__dirname,'seen-question-packs',cat.id+'-batch-'+batch+'.json'),'utf8'));
   assert.ok(pack.questions.every(q=>q.question.length>15&&q.answer.length>0));
  }
 }
});
