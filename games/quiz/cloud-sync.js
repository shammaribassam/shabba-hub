'use strict';
(()=>{
 const isHost=!!document.getElementById('connect');
 const params=new URLSearchParams(location.search);
 const room=isHost?sessionStorage.getItem('shabba_room'):(params.get('room')||'');
 const token=isHost?sessionStorage.getItem('shabba_token'):null;
 const roomId=isHost?(room||crypto.randomUUID()):room;
 const roomToken=isHost?(token||Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')):null;
 window.BSM_ROOM=roomId;window.BSM_TOKEN=roomToken;
 if(isHost){sessionStorage.setItem('shabba_room',roomId);sessionStorage.setItem('shabba_token',roomToken);
  const link=document.querySelector('a[href^="viewer.html"]');if(link){link.href='viewer.html?room='+encodeURIComponent(roomId);link.textContent='افتح صفحة المتابعين الخاصة بك ↗'}
  const copy=document.createElement('button');copy.type='button';copy.className='secondary';copy.textContent='نسخ رابط OBS';copy.style.marginInlineStart='8px';copy.onclick=()=>navigator.clipboard.writeText(new URL('viewer.html?room='+roomId,location.href).href).then(()=>{copy.textContent='تم نسخ رابط OBS ✓'}).catch(()=>prompt('انسخ رابط OBS:',new URL('viewer.html?room='+roomId,location.href).href));link?.parentNode?.appendChild(copy);
 }
 let readyResolve,readyReject;window.BSM_READY=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject});
 let channel=null,applying=false,pending=false;
 const oldPublish=publish;
 publish=function(){oldPublish();if(isHost&&!applying){pending=true;flush()}};
 async function flush(){if(!isHost||!window.BSM_SERVER_READY||!pending)return;pending=false;
  try{const r=await fetch('/api/state?room='+encodeURIComponent(roomId),{method:'POST',headers:{'Content-Type':'application/json','X-Room-Token':roomToken},body:JSON.stringify(state)});if(!r.ok)pending=true}catch{pending=true}}
 function subscribe(){channel=new EventSource('/api/events?room='+encodeURIComponent(roomId));channel.onmessage=e=>{try{if(isHost)return;const incoming=JSON.parse(e.data);applying=true;state=incoming;render()}catch(err){console.warn(err)}finally{applying=false}}}
 if(!isHost){if(roomId)subscribe();else if(document.getElementById('phase'))document.getElementById('phase').textContent='افتح رابط OBS الذي يظهر في لوحة الستريمر';readyResolve();return}
 (async()=>{try{const r=await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({room:roomId,token:roomToken})});if(!r.ok)throw Error('تعذر تجهيز جلسة المسابقة');window.BSM_SERVER_READY=true;subscribe();pending=true;await flush();readyResolve()}catch(e){readyReject(e);alert('تعذر تشغيل جلسة مستقلة: '+e.message)}})();
 window.addEventListener('beforeunload',()=>channel?.close());
})();
