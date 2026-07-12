(()=>{
  const defaults={
    hours:1,
    dt:0.5,
    f0:60,
    load:12,
    loadVar:0.4,
    motorMW:1.2,
    motorInt:60,
    pvMax:0,
    cloud:0.2,
    windMax:0,
    windMean:8,
    dg33:6,
    dg12:0,
    droop:4,
    minLoad:0.35,
    rampUp:0.3,
    rampDn:1,
    startDelay:300,
    dieselPrice:1.5,
    bP:12,
    bE:24,
    soc0:65,
    eta:96.5,
    bDroop:3,
    Hb:8,
    socTarget:60,
    socLow:20,
    socHigh:85,
    qMax:6,
    qDroop:0.04,
    uf1:59.3,
    uf2:58.8,
    uf3:58.3,
    rocofTrip:1.5,
  };

  function applyReferenceDefaults(){
    for(const [id,value] of Object.entries(defaults)){
      const input=document.getElementById(id);
      if(input) input.value=String(value);
    }
    const title=document.querySelector('.brand small');
    if(title) title.textContent='V6.3 · Reference Compliant Baseline';
    const start=document.getElementById('start');
    if(start&&start.textContent==='启动') start.textContent='运行缺省基准';
    const log=document.getElementById('log');
    if(log&&!window.started) log.textContent='[Reference Baseline] 12 MW负荷 · 6×3.3 MW柴油机 · 12 MW / 24 MWh BESS。点击“运行缺省基准”开始。';
    const badges=document.querySelector('.badges');
    if(badges&&!document.getElementById('bPreset')){
      const badge=document.createElement('span');
      badge.id='bPreset';
      badge.className='badge';
      badge.textContent='REFERENCE BASELINE';
      badges.prepend(badge);
    }
  }

  window.applyV6ReferenceDefaults=applyReferenceDefaults;
  applyReferenceDefaults();
  document.addEventListener('DOMContentLoaded',()=>setTimeout(applyReferenceDefaults,0),{once:true});
})();
