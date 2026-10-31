 'use strict';
(()=>{
 const isHost=!!document.getElementById('connect');
 const params=new URLSearchParams(location.search);
 const roomId=isHost?(sessionStorage.getItem('diwan_room')||crypto.randomUUID()):(params.get('room')||'');
 const token=isHost?(sessionStorage.getItem('diwan_token')||Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')):null;
 window.BSM_ROOM=roomId;window.BSM_TOKEN=token;
 if(isHost){sessionStorage.setItem('diwan_room',roomId);sessionStorage.setItem('diwan_token',token);
  const link=document.querySelector('a[href^="viewer.html"]');if(link){link.href='viewer.html?room='+encodeURIComponent(roomId);link.textContent='افتح صفحة OBS ↗';
   const copy=document.createElement('button');copy.textContent='نسخ رابط OBS';copy.onclick=()=>{const u=new URL(link.href,location.href).href;navigator.clipboard?.writeText(u).then(()=>copy.textContent='تم النسخ ✓').catch(()=>prompt('انسخ الرابط',u))};link.after(copy)}
 }
 let resolveReady,rejectReady;window.BSM_READY=new Promise((a,b)=>{resolveReady=a;rejectReady=b});
 let pending=false,flushing=false;
 const original=broadcast;
 broadcast=function(){original();if(isHost){pending=true;flush()}};
 async function flush(){if(!isHost||!window.BSM_SERVER_READY||flushing||!pending)return;flushing=true;pending=false;
  try{const r=await fetch('/api/state?room='+encodeURIComponent(roomId),{method:'POST',headers:{'Content-Type':'application/json','X-Room-Token':token},body:JSON.stringify(state)});if(!r.ok)pending=true}catch{pending=true}finally{flushing=false;if(pending)setTimeout(flush,2000)} }
 if(!isHost){if(roomId){const events=new EventSource('/api/events?room='+encodeURIComponent(roomId));events.onmessage=e=>{try{state=JSON.parse(e.data);render()}catch(err){console.warn(err)}}}else document.getElementById('question').textContent='افتح رابط OBS من لوحة الستريمر';resolveReady();return}
 (async()=>{try{const r=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:roomId,token})});if(!r.ok)throw Error('تعذر إنشاء غرفة');window.BSM_SERVER_READY=true;pending=true;await flush();resolveReady()}catch(e){rejectReady(e);alert('تعذر تجهيز الاتصال بالخادم: '+e.message)}})();
})();
