'use strict';
let socket=null,timer=null;
let sessionStarted=sessionStorage.getItem('bsm_session_started')==='1';
function setSessionStarted(value){sessionStarted=!!value;sessionStorage.setItem('bsm_session_started',sessionStarted?'1':'0')}
function shuffledQuestion(q){const entries=q.options.map((option,i)=>({option,correct:i===q.correct}));for(let i=entries.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[entries[i],entries[j]]=[entries[j],entries[i]]}return {...q,options:entries.map(x=>x.option),correct:entries.findIndex(x=>x.correct)};}
function launchQuestion(){if(timer){clearInterval(timer);timer=null}state.phase='playing';state.seconds=30;state.winners=[];state.attempts=[];state.excluded=[];publish();updateButtons();timer=setInterval(()=>{if(state.phase!=='playing'){clearInterval(timer);timer=null;return}state.seconds=Math.max(0,state.seconds-1);if(!state.seconds)endRound();else publish()},1000)}
const qs=window.BSM_QUESTIONS||[];
const difficultyLabels={easy:'سهل',medium:'متوسط',hard:'صعب'};
if(!Object.hasOwn(difficultyLabels,state.difficulty))state.difficulty='medium';
function questionPool(){return qs.filter(q=>q.category===state.category&&q.difficulty===state.difficulty)}
function updateDifficulty(){
 const select=$('difficulty');
 if(select){select.value=state.difficulty;select.disabled=state.phase==='playing';for(const option of select.options){const count=qs.filter(q=>q.category===state.category&&q.difficulty===option.value).length;option.textContent=difficultyLabels[option.value]+' ('+count+')'}}
 if($('libraryStatus')){const count=questionPool().length;$('libraryStatus').textContent=count?'مكتبة '+difficultyLabels[state.difficulty]+' — '+count+' سؤال':'لا توجد أسئلة لهذا المستوى في الفئة المختارة؛ اختر مستوى آخر.'}
}
function chooseDifficulty(value){
 if(state.phase==='playing'||!Object.hasOwn(difficultyLabels,value)){updateDifficulty();return}
 if(value===state.difficulty)return;
 setSessionStarted(false);state.difficulty=value;state.question=null;state.phase='idle';state.seconds=30;state.winners=[];state.attempts=[];state.excluded=[];publish();updateButtons();
}
$('difficulty').addEventListener('change',e=>chooseDifficulty(e.target.value));
function log(name,msg){state.chat.push([name,msg]);state.chat=state.chat.slice(-100);publish()}
function receive(name,msg,platform='twitch'){
 name=String(name||'').trim();msg=String(msg||'').trim();if(!name)return;log(name,msg);
 const id=platform+':'+name.toLowerCase();if(!state.platforms)state.platforms={};state.platforms[id]=platform;
 const joinMsg=msg.replace(/[\u064B-\u065F\u0670\u0640]/g,'').trim();
 if(platform==='tiktok'?(joinMsg==='دخول'||joinMsg==='انضم'):(joinMsg==='!انضم')){
  if(!Object.hasOwn(state.joined,id)){state.joined[id]=name;state.scores[id]=0;publish()}log('النظام',name+' انضم للمسابقة');return;
 }
 if(state.phase!=='playing'||!state.question||!Object.hasOwn(state.joined,id)||(state.excluded||[]).includes(id))return;
 if(!/^[1-4١٢٣٤]$/.test(msg))return;
 const n='١٢٣٤'.includes(msg)?'١٢٣٤'.indexOf(msg):Number(msg)-1;
 if(!Array.isArray(state.attempts))state.attempts=[];if(state.attempts.includes(id))return;
 state.attempts.push(id);publish();if(n!==state.question.correct||state.winners.includes(id))return;
 if(state.winners.length<3){const pts=[10,7,5][state.winners.length];state.winners.push(id);state.scores[id]=(state.scores[id]||0)+pts;publish();log('النظام',name+' أجاب صح وحصل على '+pts+' نقاط')}
 if(state.winners.length===3)endRound();
}
function endRound(){if(timer){clearInterval(timer);timer=null}if(state.question&&state.phase==='playing'){state.phase='ended';publish()}updateButtons()}
function updateButtons(){const empty=!questionPool().length;if($('start'))$('start').disabled=state.phase==='playing'||sessionStarted||empty;if($('next'))$('next').disabled=empty;updateDifficulty()}
function chooseCategory(cat){if(!labels[cat])return;endRound();setSessionStarted(false);state.category=cat;state.question=null;state.phase='idle';state.seconds=30;state.winners=[];state.attempts=[];state.excluded=[];publish();updateButtons()}
function nextQuestion(){const pool=questionPool();if(!pool.length){updateButtons();return}endRound();const key=state.category+':'+state.difficulty;state.seen=state.seen||{};let seen=state.seen[key]||state.seen[state.category]||[];let available=pool.filter(q=>!seen.includes(q.question));if(!available.length){seen=[];available=pool}const q=available[Math.floor(Math.random()*available.length)];state.seen[key]=[...seen,q.question];state.question=shuffledQuestion(q);state.round++;state.phase='ready';state.seconds=30;state.winners=[];state.attempts=[];state.excluded=[];publish();updateButtons();if(sessionStarted)launchQuestion()}
function startRound(){if(state.phase==='playing'||!questionPool().length)return;setSessionStarted(true);if(!state.question||state.phase==='ended'){nextQuestion();return}launchQuestion()}
function disconnect(){if(socket){socket.onclose=null;socket.close();socket=null}$('connection').textContent='غير متصل'}
function connect(){disconnect();const ch=$('channel').value.trim().replace(/^@/,'').toLowerCase();if(!/^[a-z0-9_]{3,25}$/.test(ch)){$('connection').textContent='اسم قناة غير صالح';return}$('connection').textContent='جارٍ الاتصال بـ Twitch...';
 try{const s=new WebSocket('wss://irc-ws.chat.twitch.tv:443');socket=s;
 s.onopen=()=>{s.send('CAP REQ :twitch.tv/tags twitch.tv/commands');s.send('PASS SCHMOOPIIE');s.send('NICK justinfan'+Math.floor(Math.random()*80000+10000));s.send('JOIN #'+ch);$('connection').textContent='اتصال مفتوح بقناة '+ch+' — بانتظار الرسائل'};
 s.onmessage=e=>{for(const line of String(e.data).split('\r\n')){if(line.startsWith('PING')){s.send(line.replace('PING','PONG'));continue}const m=line.match(/(?:^| ):([^! ]+)!\S+ PRIVMSG #\w+ :([\s\S]*)$/);if(m)receive(m[1],m[2])}};
 s.onerror=()=>{$('connection').textContent='تعذر استقبال شات Twitch'};s.onclose=()=>{if(socket===s){socket=null;$('connection').textContent='انقطع اتصال Twitch'}}
 }catch(e){$('connection').textContent='فشل الاتصال: '+e.message}}
$('categories').addEventListener('click',e=>{const btn=e.target.closest('[data-cat]');if(btn)chooseCategory(btn.dataset.cat)});
$('next').onclick=nextQuestion;$('start').onclick=startRound;$('end').onclick=endRound;
$('connect').onclick=connect;$('disconnect').onclick=disconnect;
$('send').onclick=()=>{receive($('tester').value,$('testmsg').value,$('testPlatform').value);$('testmsg').value=''};
$('testmsg').onkeydown=e=>{if(e.key==='Enter')$('send').click()};
$('reset').onclick=()=>{if(confirm('هل تريد تصفير نقاط جميع المشاركين؟')){state.scores={};state.joined={};state.winners=[];publish()}};
window.addEventListener('beforeunload',()=>{if(timer)clearInterval(timer)});
render();updateButtons();
function managerRender(){const el=$('playerManager');if(!el)return;const filter=($('playerSearch').value||'').trim().toLowerCase();const rows=Object.keys(state.joined).filter(id=>state.joined[id].toLowerCase().includes(filter)).sort((a,b)=>(state.scores[b]||0)-(state.scores[a]||0));el.innerHTML=rows.map(id=>`<div class="player-row" data-player="${esc(id)}"><div><strong>${esc(state.joined[id])}</strong><small>${esc((state.platforms||{})[id]||id.split(':')[0]||'Twitch')} • ${state.scores[id]||0} نقطة ${(state.excluded||[]).includes(id)?'• مستبعد من الجولة':''}</small></div><div class="player-actions"><button data-action="plus" title="إضافة 5 نقاط">+5</button><button data-action="minus" title="خصم 5 نقاط">−5</button><button data-action="set" title="تحديد النقاط">تعديل</button><button class="secondary" data-action="exclude">${(state.excluded||[]).includes(id)?'إلغاء الاستبعاد':'استبعاد من الجولة'}</button></div></div>`).join('')||'<p class="muted">لا يوجد متسابقون</p>'}
$('playerSearch').addEventListener('input',managerRender);
$('playerManager').addEventListener('click',e=>{const btn=e.target.closest('[data-action]'),row=e.target.closest('[data-player]');if(!btn||!row)return;const id=row.dataset.player;if(!Object.hasOwn(state.joined,id))return;const action=btn.dataset.action;let n=Number(state.scores[id]||0);if(action==='plus')n+=5;if(action==='minus')n-=5;if(action==='set'){const value=prompt('أدخل رصيد النقاط الجديد:',String(n));if(value===null)return;if(!/^-?\d+$/.test(value.trim())){alert('أدخل رقمًا صحيحًا');return}n=Number(value)}if(['plus','minus','set'].includes(action))state.scores[id]=n;if(action==='exclude'){if(!Array.isArray(state.excluded))state.excluded=[];state.excluded=state.excluded.includes(id)?state.excluded.filter(x=>x!==id):[...state.excluded,id]}publish();managerRender()});
$('manualAdd').onclick=()=>{const name=$('manualName').value.trim(),platform=$('manualPlatform').value;if(!name)return;const id=platform+':'+name.toLowerCase();if(!state.platforms)state.platforms={};state.platforms[id]=platform;if(!Object.hasOwn(state.joined,id)){state.joined[id]=name;state.scores[id]=0;publish()}$('manualName').value='';managerRender()};
const oldRender=render;render=function(){oldRender();managerRender();updateButtons()};managerRender();
