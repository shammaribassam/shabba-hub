
const cats=[...new Set(questions.map(q=>q[0]))];
$('cat').innerHTML=`<option value="الكل">كل الفئات — ${questions.length} سؤال</option>`+cats.map(c=>`<option>${c} — ${questions.filter(q=>q[0]===c).length} سؤالًا</option>`).join('');
function notice(s){$('gameStatus').textContent=s}
let ws=null,tick=null;
const answeredThisRound=new Set();
let bonusTimer=null,bonusPrivateCandidates=[],bonusTarget=null,currentBonusPoemKey='',currentBonusVerse=-1;
function stopBonusTimer(){if(bonusTimer){clearInterval(bonusTimer);bonusTimer=null}}
function resetBonus(){stopBonusTimer();bonusPrivateCandidates=[];bonusTarget=null;currentBonusPoemKey='';currentBonusVerse=-1;state.bonus={phase:'idle',prompt:'',claimant:null,response:'',seconds:20}}
// The accepted full verses remain only in the host tab, never sent in state to viewers.
function normalizeArabic(input){return String(input||'').normalize('NFKC')
 .replace(/[\u064b-\u065f\u0670\u0640]/g,'')
 .replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه')
 .replace(/[^\u0621-\u064a\s]/g,' ').replace(/\s+/g,' ').trim();}
function editDistanceLimited(a,b,limit=2){if(Math.abs(a.length-b.length)>limit)return limit+1;let prev=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){const next=[i];let rowMin=i;for(let j=1;j<=b.length;j++){const v=Math.min(prev[j]+1,next[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));next.push(v);rowMin=Math.min(rowMin,v)}if(rowMin>limit)return limit+1;prev=next}return prev[b.length]}
function matchingVerse(response,expected){let a=normalizeArabic(response),b=normalizeArabic(expected);
 if(a===b&&a.length>=12)return true;
 const aw=a.split(' '),bw=b.split(' ');
 // No missing/extra words: typo tolerance is restricted to 1-2 characters in long words.
 if(aw.length!==bw.length||aw.length<3||a.length<16)return false;
 let edits=0;for(let i=0;i<aw.length;i++){if(aw[i]===bw[i])continue;
  if(Math.min(aw[i].length,bw[i].length)<5)return false;
  const d=editDistanceLimited(aw[i],bw[i],1);if(d!==1)return false;
  edits++;
  if(edits>(b.length>=65?2:1))return false;
 }
 return edits>0&&edits<=Math.max(1,Math.floor(b.length/25));
}
function availableBonusLines(){const entry=bonusPoems[currentBonusPoemKey];if(!entry)return [];
 const data=entry.verses.map((v,i)=>({first:v[0],second:v[1],index:i}));
 // Never reward the displayed question's original verse as a bonus.
 const currentHalf=normalizeArabic(state.question),currentAnswer=normalizeArabic(state.answers[state.correct]||'');
 return data.filter(v=>v.index!==currentBonusVerse&& !currentHalf.includes(normalizeArabic(v.first)) && normalizeArabic(v.second)!==currentAnswer).slice(0,5);
}
function openBonus(){
 if(state.category!=='أكمل البيت'||state.active||!state.winners.length||state.bonus?.phase!=='idle')return notice('البونص متاح فقط بعد نهاية سؤال أكمل البيت ووجود فائز.');
 const candidates=availableBonusLines();if(candidates.length<4)return notice('لا توجد أبيات إضافية موثقة لهذا السؤال؛ لن نفتح بونص بلا إجابة صحيحة.');
 bonusPrivateCandidates=candidates;bonusTarget=candidates[Math.floor(Math.random()*candidates.length)];
 state.bonus={phase:'claiming',prompt:'',claimant:null,response:'',seconds:20};
 broadcast();notice('البونص مفتوح تلقائيًا؛ أول فائز من الثلاثة يكتب بونس أو بونص.');
}
function awardBonus(){const b=state.bonus;if(!b||b.phase==='awarded'||!b.claimant)return false;
 stopBonusTimer();state.scores[b.claimant]=(state.scores[b.claimant]||0)+10;b.phase='awarded';
 log('النظام',(state.joined[b.claimant]||'المشارك')+' حصل على 10 نقاط بونص');broadcast();return true;
}
function judgeBonus(accepted){const b=state.bonus;if(!b||b.phase!=='rejected'||!b.response)return;
 if(accepted){if(confirm('هل تحققت من صحة رواية بديلة لهذا البيت؟ ستُضاف 10 نقاط مرة واحدة فقط.')){awardBonus();notice('اعتمد الستريمر رواية صحيحة: +10 نقاط')}}
 else{b.phase='reviewed';broadcast();notice('تم تأكيد عدم المطابقة؛ لم تُخصم أي نقاط.')}}
$('bonusOpen').onclick=openBonus;
$('bonusApprove').onclick=()=>judgeBonus(true);
$('bonusReject').onclick=()=>judgeBonus(false);
$('bonusCancel').onclick=()=>{if(state.bonus?.phase==='idle')return;stopBonusTimer();state.bonus.phase='cancelled';broadcast();notice('تم إلغاء البونص')};

function log(name,msg){state.chat.push([name,msg]);state.chat=state.chat.slice(-100);broadcast()}
function handle(name,msg,platform="twitch"){name=String(name||'').trim();msg=String(msg||'').trim();if(!name)return;log(name,msg);const id=platform+":"+name.toLowerCase();
if(/^!?انضم$/u.test(msg)){if(!state.joined[id]){state.joined[id]=name;state.scores[id]=0;broadcast()}return}
// Reserve bonus exclusively for one of the top three winners in the completed verse question.
if(state.bonus?.phase==='claiming'&&state.winners.includes(id)&&/^!?بون[سص]$/u.test(msg)){
 state.bonus.phase='answering';state.bonus.claimant=id;
 state.bonus.prompt='أكمل الشطر الإضافي من القصيدة نفسها: «'+bonusTarget.first+' ...»';
 state.bonus.seconds=20;
 log('النظام',name+' حجز البونص؛ أمامه 20 ثانية لإكمال الشطر.');
 stopBonusTimer();bonusTimer=setInterval(()=>{if(state.bonus?.phase!=='answering'){stopBonusTimer();return}
  state.bonus.seconds=Math.max(0,state.bonus.seconds-1);
  if(state.bonus.seconds===0){state.bonus.phase='rejected';stopBonusTimer();notice('انتهى وقت البونص دون إجابة صحيحة.');}
  broadcast();},1000);
 broadcast();return;
}
if(state.bonus?.phase==='answering'&&state.bonus.claimant===id){
 if(!msg||/^!?بون[سص]$/u.test(msg))return;
 state.bonus.response=msg;stopBonusTimer();
 // Matching the prompted hemistich, its full couplet, or any other FULL couplet in the documented set.
 const good=matchingVerse(msg,bonusTarget.second)||matchingVerse(msg,bonusTarget.first+' '+bonusTarget.second)||
  bonusPrivateCandidates.some(v=>matchingVerse(msg,v.first+' '+v.second));
 if(good){awardBonus();notice('إجابة البونص صحيحة تلقائيًا: +10 نقاط لصاحب البونص.');}
 else{state.bonus.phase='rejected';broadcast();notice('لم تطابق الإجابة أي بيت موثق في المكتبة؛ يمكن مراجعتها إذا كانت رواية صحيحة أخرى.');}
 return;
}

if(!state.joined[id]||!state.active||state.correct<0)return;
if(state.exclusions?.[id]&&state.round<state.exclusions[id].untilRound)return;
if(!/^[1-4١٢٣٤]$/.test(msg))return;
let n='١٢٣٤'.includes(msg)?'١٢٣٤'.indexOf(msg)+1:Number(msg);
if(answeredThisRound.has(id))return;
answeredThisRound.add(id);
if(n-1!==state.correct)return;
if(state.winners.length<3){const pts=[10,7,5][state.winners.length];state.winners.push(id);state.scores[id]=(state.scores[id]||0)+pts;broadcast();log('النظام',`${name} حصل على ${pts} نقاط`)}
if(state.winners.length>=3)finish()
}
// One continuous competition: "Next question" also starts its 20-second timer.
// The results remain visible after each question so the host can open a poem bonus.
function finish(){
 clearInterval(tick);tick=null;
 if(state.active){state.active=false;state.revealed=true;broadcast();notice('انتهى السؤال. افتح البونص إن توفر، أو اضغط السؤال التالي للمتابعة مباشرة.');}
}
function runQuestion(){
 if(state.active)return;
 state.active=true;state.revealed=false;state.remaining=20;
 $('start').disabled=true;
 broadcast();notice('السؤال '+state.round+' جارٍ — 20 ثانية');
 clearInterval(tick);
 tick=setInterval(()=>{
  if(!state.active){clearInterval(tick);tick=null;return}
  state.remaining=Math.max(0,state.remaining-1);
  if(state.remaining===0)finish();else broadcast();
 },1000);
}
function next(){
 finish();answeredThisRound.clear();
 const cat=$('cat').value.split(' — ')[0];
 const pool=questions.filter(q=>cat==='الكل'||q[0]===cat);
 let available=pool.filter(q=>!state.seen.includes(q[1]));
 if(!available.length){const poolKeys=new Set(pool.map(q=>q[1]));state.seen=state.seen.filter(x=>!poolKeys.has(x));available=pool}
 const q=available[Math.floor(Math.random()*available.length)];
 if(!q)return notice('لا توجد أسئلة في هذه الفئة');
 resetBonus();currentBonusPoemKey=q[8]||'';currentBonusVerse=Number.isInteger(q[9])?q[9]:-1;
 state.seen.push(q[1]);state.round++;
 for(const [id,e] of Object.entries(state.exclusions||{})){if(state.round>=e.untilRound)delete state.exclusions[id]}
 state.category=q[0];state.question=q[1];state.answers=q.slice(2,6);state.correct=q[6];
 state.remaining=20;state.winners=[];state.active=false;state.revealed=false;
 // No separate "change round" or "start round" click is needed after this.
 runQuestion();
}
function start(){
 if(state.round>0)return notice('المسابقة مستمرة؛ اضغط «السؤال التالي» لبدء السؤال الجديد تلقائيًا.');
 next();
}
$('next').onclick=next;$('start').onclick=start;$('stop').onclick=finish;
$('reset').onclick=()=>{if(confirm('تصفير جميع النقاط والمشاركين؟')){state.joined={};state.scores={};state.winners=[];broadcast()}};
$('send').onclick=()=>{handle($('tester').value,$('testmsg').value,'test');$('testmsg').value=''};
$('testmsg').onkeydown=e=>{if(e.key==='Enter')$('send').click()};
function disconnect(){if(ws){ws.onclose=null;ws.close();ws=null}$('connection').textContent='غير متصل'}
$('disconnect').onclick=disconnect;
$('connect').onclick=()=>{disconnect();const channel=$('channel').value.trim().replace(/^@/,'').toLowerCase();if(!/^[a-z0-9_]{3,25}$/.test(channel))return notice('اسم القناة غير صالح');
$('connection').textContent='جارٍ الاتصال...';
try{let s=new WebSocket('wss://irc-ws.chat.twitch.tv:443');ws=s;
s.onopen=()=>{s.send('CAP REQ :twitch.tv/tags twitch.tv/commands');s.send('PASS SCHMOOPIIE');s.send('NICK justinfan'+Math.floor(Math.random()*80000+10000));s.send('JOIN #'+channel);$('connection').textContent='متصل بشات '+channel};
s.onmessage=e=>{for(let line of String(e.data).split('\r\n')){if(line.startsWith('PING')){s.send(line.replace('PING','PONG'));continue}const m=line.match(/(?:^| ):(\w+)!\S+ PRIVMSG #\w+ :([\s\S]*)$/);if(m)handle(m[1],m[2],'twitch')}};
s.onerror=()=>{$('connection').textContent='فشل اتصال Twitch'};s.onclose=()=>{if(ws===s){ws=null;$('connection').textContent='انقطع الاتصال'}}}catch(e){$('connection').textContent=e.message}};
render();

function receive(name,msg,platform){handle(name,msg,platform||'tiktok')}

// Host-only exclusion controls. Audio plays in the streamer tab (capture its audio in OBS).
const exileAudio=[1,2,3].map(n=>new Audio('exile-'+n+'.mp3'));
exileAudio.forEach(a=>a.preload='auto');
let lastExile=-1;
function exilePlayer(){
 const id=$('exilePlayer').value, duration=Number($('exileDuration').value);
 if(!id||!state.joined[id])return notice('اختر مشاركًا أولًا');
 state.exclusions ||= {};
 state.exclusions[id]={untilRound:Math.max(1,state.round)+duration};
 state.exileEvent={name:state.joined[id],duration,at:Date.now(),seq:(state.exileEvent?.seq||0)+1};
 let n=Math.floor(Math.random()*3);if(n===lastExile)n=(n+1+Math.floor(Math.random()*2))%3;lastExile=n;
 exileAudio.forEach(a=>{a.pause();a.currentTime=0});
 exileAudio[n].play().catch(()=>notice('تم الاستبعاد؛ اضغط على الصفحة لتفعيل الصوت في المتصفح'));
 broadcast();notice('تم استبعاد '+state.joined[id]+' لمدة '+duration+' جولة');
}
$('exileButton').onclick=exilePlayer;
$('restoreButton').onclick=()=>{const id=$('exilePlayer').value;if(!id)return;delete state.exclusions[id];broadcast();notice('تمت إعادة '+(state.joined[id]||'المشارك'))};
// Streamer-only score editing. All platforms share one leaderboard but identities remain platform-scoped.
function changePoints(direction){
 const id=$('pointsPlayer').value,amount=Number($('pointsAmount').value);
 if(!id||!Object.prototype.hasOwnProperty.call(state.joined,id))return notice('اختر مشاركًا لتعديل نقاطه.');
 if(!Number.isSafeInteger(amount)||amount<1||amount>1000)return notice('أدخل عدد نقاط صحيحًا من 1 إلى 1000.');
 const previous=Number(state.scores[id])||0;
 state.scores[id]=Math.max(0,previous+(direction*amount));
 broadcast();notice((direction>0?'أُضيفت ':'خُصمت ')+amount+' نقطة '+(direction>0?'إلى ':'من ')+(state.joined[id]||id)+'؛ رصيده الآن '+state.scores[id]);
}
$('pointsAdd').onclick=()=>changePoints(1);
$('pointsDeduct').onclick=()=>changePoints(-1);
$('pointsPlayer').onchange=()=>render();
const previousRender=render;
render=function(){
 previousRender();
 const participants=Object.keys(state.joined);
 const exile=$('exilePlayer'),exileSelected=exile.value;
 exile.innerHTML='<option value="">اختر مشاركًا</option>'+participants.map(id=>'<option value="'+escapeHtml(id)+'">'+escapeHtml(state.joined[id])+'</option>').join('');
 exile.value=exileSelected;
 const points=$('pointsPlayer'),pointsSelected=points.value;
 points.innerHTML='<option value="">اختر مشاركًا</option>'+participants.map(id=>'<option value="'+escapeHtml(id)+'">'+escapeHtml(state.joined[id])+' ('+escapeHtml(id.split(':')[0])+')</option>').join('');
 points.value=pointsSelected;
 $('pointsCurrent').textContent=points.value?('رصيد المشارك: '+(state.scores[points.value]||0)+' نقطة'):'اختر مشاركًا لعرض رصيده';
};
render();
