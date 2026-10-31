'use strict';
(()=>{
 const status=document.getElementById('kickStatus');if(!status)return;
 const q=()=>'?room='+encodeURIComponent(window.BSM_ROOM);
 async function call(action,body){await window.BSM_READY;const response=await fetch('/api/kick/'+action+q(),{method:'POST',headers:{'Content-Type':'application/json','X-Room-Token':window.BSM_TOKEN},body:JSON.stringify(body||{})});const data=await response.json().catch(()=>({error:'تعذر قراءة رد Kick'}));if(!response.ok)throw Error(data.error||'فشل اتصال Kick');return data}
 window.BSM_READY.then(()=>{
  const events=new EventSource('/api/kick/events'+q()+'&token='+encodeURIComponent(window.BSM_TOKEN));
  events.onmessage=e=>{try{const x=JSON.parse(e.data);if(x.type==='status')status.textContent=x.status;if(x.type==='chat'&&typeof receive==='function')receive(x.name,x.msg,'kick')}catch(err){console.warn('Kick event:',err)}};
  events.onerror=()=>{status.textContent='انقطع اتصال تحديثات Kick بالخادم'};
 }).catch(()=>{status.textContent='تعذر بدء جلسة Kick'});
 document.getElementById('kickConnect').onclick=async()=>{const channel=document.getElementById('kickChannel').value.trim().replace(/^@/,'');status.textContent='جارٍ الاشتراك...';try{await call('connect',{channel})}catch(e){status.textContent=e.message}};
 document.getElementById('kickDisconnect').onclick=async()=>{try{await call('disconnect')}catch(e){status.textContent=e.message}};
})();
