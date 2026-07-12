(()=>{
  const files=['app-v62-core.js','app-v62-model.js','app-v67-renewable-dispatch.js','app-v62-ui.js','app-v63-reference.js'];
  const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error(`Failed to load ${src}`));document.head.appendChild(s);});
  (async()=>{try{for(const file of files)await load(file);if(document.readyState!=='loading')bind();}catch(error){console.error(error);const log=document.getElementById('log');if(log)log.textContent=`[Load Error] ${error.message}`;}})();
})();