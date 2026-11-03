// Fasih Diwan portrait only. Nabati evening has been retired.
(function(){
 const source='poet-fasih-original.jpeg';
 const fallback='abu-albasm-portrait-20261031.png';
 for(const img of document.querySelectorAll('img[data-poet-portrait]')){
   img.alt='صاحب ديوان أبو البسم بزي الخليفة';
   img.onerror=function(){
     this.onerror=null;
     if(this.getAttribute('src')!==fallback)this.src=fallback;
   };
   img.src=source;
 }
})();
