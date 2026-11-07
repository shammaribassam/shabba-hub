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
test('question bank has 252 complete questions across 14 categories',()=>{
 assert.equal(questions.length,14);
 assert.equal(questions.reduce((n,c)=>n+c.tiers.flat().length,0),252);
 for(const c of questions){
  assert.deepEqual(c.tiers.map(t=>t.length),[6,6,6]);
  assert.equal(new Set(c.tiers.flat().map(q=>q.question)).size,18);
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
 const script=html.match(/<script>([\\s\\S]*?)<\\/script>/);
 assert.ok(script,'trivia browser script exists');
 new vm.Script(script[1],{filename:'seen.html'});
});
