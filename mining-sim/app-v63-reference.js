(()=>{
  const defaults={
    hours:24,
    dt:0.5,
    f0:60,
    load:12,
    loadVar:1.5,
    motorMW:2,
    motorInt:45,
    pvMax:20,
    cloud:0.35,
    windMax:6,
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
    if(title) title.textContent='V6.3 · 24 h Renewable Reference Demo';
    const start=document.getElementById('start');
    if(start&&start.textContent==='启动') start.textContent='运行24小时演示';
    const log=document.getElementById('log');
    if(log&&!window.started) log.textContent='[24 h Renewable Demo] 12 MW负荷 · PV 20 MW · 风电 6 MW · 6×3.3 MW柴油机 · 12 MW / 24 MWh BESS。点击“运行24小时演示”开始。';
    const badges=document.querySelector('.badges');
    if(badges&&!document.getElementById('bPreset')){
      const badge=document.createElement('span');
      badge.id='bPreset';
      badge.className='badge';
      badge.textContent='24 H RENEWABLE DEMO';
      badges.prepend(badge);
    }else if(document.getElementById('bPreset')){
      document.getElementById('bPreset').textContent='24 H RENEWABLE DEMO';
    }
  }

  window.applyV6ReferenceDefaults=applyReferenceDefaults;
  applyReferenceDefaults();
  document.addEventListener('DOMContentLoaded',()=>setTimeout(applyReferenceDefaults,0),{once:true});
})();