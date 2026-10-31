
const $=id=>document.getElementById(id);
// Every browser tab begins with a clean state; only the active room synchronizes viewers.
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state={round:0,category:'',question:'',answers:[],correct:-1,active:false,revealed:false,remaining:20,bonus:{phase:"idle",prompt:"",claimant:null,response:"",seconds:20},joined:{},scores:{},winners:[],chat:[],seen:[],exclusions:{},exileEvent:null};
function broadcast(){render()}
function showRanks(){let arr=Object.entries(state.scores).sort((a,b)=>b[1]-a[1]);return arr.slice(0,12).map(([id,score],i)=>`<div class="rank"><span>${i+1}. ${escapeHtml(state.joined[id]||id)}</span><strong>${score} نقطة</strong></div>`).join('')||'لا يوجد متصدرون'}
function showQuestion(){ $('round').textContent='السؤال '+state.round;$('categoryLabel').textContent=state.category||'ديوان الشعر';$('question').textContent=state.question||'أهلاً بكم في ديوان أبي البسم';$('answers').innerHTML=state.answers.map((a,i)=>`<div class="answer ${state.revealed&&state.correct===i&&state.round?'correct':''}">${i+1} — ${escapeHtml(a)}</div>`).join('');$('timer').textContent=state.remaining;$('leaders').innerHTML=showRanks();if($('winners'))$('winners').innerHTML=state.winners.map((id,i)=>`<div class="rank"><span>🏆 ${escapeHtml(state.joined[id]||id)}</span><strong>+${[10,7,5][i]}</strong></div>`).join('')||'بانتظار الإجابات الصحيحة'}
function renderHostAnswer(){
 const answer=$('hostAnswer');
 if(!answer)return; // Viewer page has no answer widget.
 if(!state.question||state.correct<0||state.correct>=state.answers.length){answer.textContent='تظهر الإجابة هنا مع بداية السؤال';return}
 const right=state.answers[state.correct];
 answer.textContent='الإجابة الصحيحة: '+(state.correct+1)+' — '+right;
 // Highlight it for the streamer from the first second, without toggling revealed.
 document.querySelectorAll('#answers .answer').forEach((el,i)=>el.classList.toggle('host-correct',i===state.correct));
}
function renderExile(){
 const banner=$('exileBanner');
 if(banner){const e=state.exileEvent;banner.textContent=e&&Date.now()-e.at<9000?'📜 نُفي من الديوان: '+e.name+' — '+e.duration+' جولة':'';banner.hidden=!banner.textContent;}
 const list=$('exileList');
 if(list){list.innerHTML=Object.entries(state.exclusions||{}).filter(([id,e])=>state.round<e.untilRound).map(([id,e])=>'<div class="rank"><span>'+escapeHtml(state.joined[id]||id)+'</span><strong>مستبعد حتى الجولة '+e.untilRound+'</strong></div>').join('')||'لا يوجد مستبعدون';}
}
function render(){showQuestion();renderHostAnswer();renderExile();if($('count'))$('count').textContent=Object.keys(state.joined).length;if($('chat')){$('chat').innerHTML=state.chat.slice(-100).map(m=>`<div class="message"><b>${escapeHtml(m[0])}</b> ${escapeHtml(m[1])}</div>`).join('');$('chat').scrollTop=$('chat').scrollHeight}}

function renderBonus(){
 const b=state.bonus||{phase:'idle'};
 const card=$('bonusCard');if(!card)return;
 if(document.body.classList.contains('viewer'))card.hidden=b.phase==='idle';
 const lines={idle:'البونص جاهز من مكتبة أبيات القصيدة، دون كتابة مسبقة.',claiming:'البونص مفتوح! أول واحد من الفائزين الثلاثة يكتب «بونس» في الشات.',answering:'اكتب تكملة الشطر خلال 20 ثانية.',rejected:'لم تتطابق الإجابة تلقائيًا. لا تُخصم النقاط الأصلية.',awarded:'إجابة صحيحة! +10 نقاط إضافية لصاحب البونص.',reviewed:'لم تُحتسب نقاط إضافية.',cancelled:'أُلغي البونص لهذه الجولة.'};
 const name=b.claimant?(state.joined?.[b.claimant]||b.claimant):'';
 const message=$('bonusMessage');if(message)message.textContent=(lines[b.phase]||'')+(name?' — '+name:'');
 const prompt=$('bonusPublicPrompt');if(prompt){prompt.textContent=b.prompt||'';prompt.hidden=!b.prompt;}
 const countdown=$('bonusCountdown');if(countdown){countdown.textContent=b.phase==='answering'?'⏳ '+b.seconds+' ثانية للإجابة':'';countdown.hidden=b.phase!=='answering';}
 const claim=$('bonusClaim');if(claim){claim.textContent=name?'صاحب البونص: '+name:'';claim.hidden=!name;}
 const answer=$('bonusAnswer');if(answer){answer.textContent=b.response?'إجابة المتسابق: '+b.response:'';answer.hidden=!b.response;}
 const yes=$('bonusApprove'),no=$('bonusReject');if(yes)yes.disabled=b.phase!=='rejected'||!b.response;if(no)no.disabled=b.phase!=='rejected'||!b.response;
 const open=$('bonusOpen');if(open)open.disabled=!(state.category==='أكمل البيت'&&!state.active&&state.winners?.length>0&&b.phase==='idle');
 // Host-only reference lines, never sent to OBS/viewers via synchronized state.
 const ref=$('bonusVerses');if(ref&&typeof availableBonusLines==='function'){
  const verses=availableBonusLines();ref.textContent=verses.map((v,i)=>(i+1)+'. '+v.first+' — '+v.second).join('\n')||'لا توجد أبيات إضافية لهذا السؤال';
 }
}
const previousBonusRender=render;
render=function(){previousBonusRender();renderBonus()};
