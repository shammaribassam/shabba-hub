'use strict';
const $=id=>document.getElementById(id);
const labels={gaming:['🎮','القيمنق'],anime:['🍥','الأنمي'],series:['🎬','الأفلام والمسلسلات'],football:['⚽','كرة القدم'],countries:['🌍','الدول والعواصم']};
const isHostPage=!!$('connect');
const activeRoom=isHostPage?(sessionStorage.getItem('shabba_room')||'new'):(new URLSearchParams(location.search).get('room')||'viewer-no-room');
const storageKey='shabba_room_state_'+activeRoom;
function freshState(){return {category:'gaming',round:0,question:null,phase:'idle',seconds:30,scores:{},joined:{},winners:[],chat:[],seen:{gaming:[],anime:[],series:[],football:[],countries:[]},attempts:[],excluded:[],platforms:{}}}
let state=freshState();
if(isHostPage)try{const x=JSON.parse(sessionStorage.getItem(storageKey));if(x&&x.category)state={...state,...x}}catch(e){}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function publish(){if(isHostPage)try{sessionStorage.setItem(storageKey,JSON.stringify(state))}catch(e){}render()}
function render(){document.body.dataset.theme=state.category;const label=labels[state.category]||labels.gaming;
 if($('themePortrait'))$('themePortrait').src='portrait_'+state.category+'.webp';
 if($('themeIcon'))$('themeIcon').textContent=label[0];if($('catLabel'))$('catLabel').textContent=label[1];
 if($('round'))$('round').textContent=state.round?'السؤال '+state.round:'بانتظار السؤال';
 if($('question'))$('question').textContent=state.question?.question||'اختر فئة وابدأ التحدي!';
 if($('answers'))$('answers').innerHTML=(state.question?.options||[]).map((x,i)=>`<div class="answer ${state.phase==='ended'?(i===state.question.correct?'correct':'wrong'):''}"><b>${i+1}</b><span>${esc(x)}</span></div>`).join('');
 if($('clock'))$('clock').textContent=state.seconds;
 if($('phase'))$('phase').textContent=({idle:'في انتظار بدء الجولة',ready:'السؤال جاهز — الإجابة مخفية',playing:'الجولة جارية — أسرع إجابة صحيحة تفوز',ended:'انتهت الجولة — ظهرت الإجابة'})[state.phase]||'';
 if($('leaders')){const rank=Object.entries(state.scores||{}).sort((a,b)=>b[1]-a[1]);$('leaders').innerHTML=rank.slice(0,12).map(([id,n],i)=>`<div class="rank"><span>${['🥇','🥈','🥉'][i]||'🏅'} ${esc(state.joined[id]||id)}</span><strong>${n} نقطة</strong></div>`).join('')||'<p class="muted">لا يوجد متصدرون بعد</p>'}
 if($('winners'))$('winners').innerHTML=(state.winners||[]).map((id,i)=>`<div class="rank"><span>${['🥇','🥈','🥉'][i]} ${esc(state.joined[id]||id)}</span><strong>+${[10,7,5][i]}</strong></div>`).join('')||'<p class="muted">بانتظار الإجابات الصحيحة</p>';
 if($('count'))$('count').textContent=Object.keys(state.joined||{}).length;
 if($('chat')){$('chat').innerHTML=(state.chat||[]).slice(-90).map(m=>`<div class="message"><b>${esc(m[0])}</b> ${esc(m[1])}</div>`).join('');$('chat').scrollTop=$('chat').scrollHeight}
 if($('categories'))for(const btn of $('categories').querySelectorAll('[data-cat]'))btn.classList.toggle('selected',btn.dataset.cat===state.category);
}
render();
