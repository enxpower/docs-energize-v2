(()=>{
'use strict';
const VERSION='V6.0';
const BUILD='engineering-integrity-r1';
const $=id=>document.getElementById(id);
const num=id=>Number($(id)?.value||0);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const lerp=(a,b,t)=>a+(b-a)*t;
let mode='offgrid',running=false,started=false,raf=null,S={},series=[],events=[],seed=42;

function rng(){
  seed|=0;seed=seed+0x6D2B79F5|0;
  let t=Math.imul(seed^seed>>>15,1|seed);
  t=t+Math.imul(t^t>>>7,61|t)^t;
  return((t^t>>>14)>>>0)/4294967296;
}
function log(msg){const el=$('log');el.textContent+=`\n${msg}`;el.scrollTop=el.scrollHeight;}
function ts(t){const h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=Math.floor(t%60);return`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
function input(){
  return{dt:num('dt')||.5,hours:num('hours')||24,f0:num('f0')||60,load:num('load')||12,loadVar:num('loadVar')||1.5,motorMW:num('motorMW')||2,motorInt:(num('motorInt')||45)*60,pvMax:num('pvMax'),cloud:num('cloud'),windMax:num('windMax'),windMean:num('windMean')||8,dg33:Math.round(num('dg33')),dg12:Math.round(num('dg12')),droop:(num('droop')||4)/100,minLoad:num('minLoad')||.35,rampUp:num('rampUp')||.2,rampDn:num('rampDn')||1,startDelay:num('startDelay')||600,bP:num('bP'),bE:num('bE'),soc0:num('soc0')/100,eta:Math.sqrt(clamp(num('eta')/100,.7,1)),bDroop:(num('bDroop')||3)/100,Hb:num('Hb')||6,socTarget:num('socTarget')/100,socLow:num('socLow')/100,socHigh:num('socHigh')/100,gridMW:num('gridMW'),gridImport:num('gridImport'),gridExport:num('gridExport'),islandable:$('islandable').checked,qMax:num('qMax'),qDroop:num('qDroop')||.04,uf1:num('uf1'),uf2:num('uf2'),uf3:num('uf3'),rocofTrip:num('rocofTrip')||1.5,dieselPrice:num('dieselPrice')||1.2};
}
function validate(){
  const x=input(),e=[],w=[];
  if(x.dt<=0||x.dt>2)e.push('时间步必须在0–2秒之间');
  if(x.load<=0)e.push('基准负荷必须大于0');
  if(x.bP<0||x.bE<0)e.push('BESS功率与容量不能为负');
  if(x.bP>0&&x.bE/x.bP<.25)w.push('BESS持续时间低于0.25小时，仅适合短时支撑');
  if(!(x.socLow<x.socTarget&&x.socTarget<x.socHigh))e.push('SOC下限、目标、上限必须依次递增');
  if(!(x.uf1>x.uf2&&x.uf2>x.uf3))e.push('UFLS阈值必须依次下降');
  if(mode==='offgrid'&&x.dg33+x.dg12===0&&x.bP===0)e.push('离网模式必须至少有柴油机或BESS成网电源');
  if(mode!=='offgrid'&&x.gridMW<=0)e.push('并网/混合模式必须设置电网容量');
  if(x.gridImport>x.gridMW)w.push('PCC进口上限高于电网容量，将按电网容量限制');
  $('validation').innerHTML=[...e.map(v=>`<div class="err">✕ ${v}</div>`),...w.map(v=>`<div class="warn">△ ${v}</div>`),...(e.length?[]:[`<div class="ok">✓ 参数逻辑检查通过</div>`])].join('');
  return{ok:!e.length,e,w,x};
}
function makeFleet(x){
  const f=[];
  for(let i=0;i<6;i++)f.push({cap:3.3,type:'3.3MW',online:i<x.dg33,P:i<x.dg33?2.3:0,start:0,cool:0});
  for(let i=0;i<2;i++)f.push({cap:1.25,type:'1.25MW',online:i<x.dg12,P:i<x.dg12?0.85:0,start:0,cool:0});
  return f;
}
function init(){
  const v=validate();if(!v.ok)return false;
  seed=42;const x=v.x;
  S={x,t:0,T:x.hours*3600,f:x.f0,dfdt:0,V:1,Q:0,E:x.bE*x.soc0,bPwr:0,pv:0,wind:0,grid:0,gridAvailable:mode!=='offgrid',pccClosed:mode!=='offgrid',op:'INIT',fleet:makeFleet(x),motorTimer:x.motorInt/2,motorActive:0,uf:[{f:x.uf1,s:.10,a:false,t:0},{f:x.uf2,s:.20,a:false,t:0},{f:x.uf3,s:.25,a:false,t:0}],shed:0,fuel:0,baseFuel:0,loadE:0,reToLoadE:0,curtE:0,unservedE:0,fmin:x.f0,fmax:x.f0,rocof:0,vmin:1,vmax:1,n1:true,fast10:0,spin60:0,start10:0,black:'',blackTimer:0,faultPVUntil:0,pvScale:1,energyResidualMax:0};
  series=[];events=[];$('log').textContent='[Ready] V6.0 engineering-integrity model initialized.';started=true;update();draw();return true;
}
function sfc(pu){if(pu<=0)return 0;if(pu<.25)return lerp(420,325,pu/.25);if(pu<.5)return lerp(325,255,(pu-.25)/.25);if(pu<.75)return lerp(255,225,(pu-.5)/.25);return lerp(225,218,(pu-.75)/.25);}
function fuel(P,cap){return P>0?(sfc(clamp(P/cap,0,1))/1000)*(P*1000)/.84:0;}
function solar(t,x){const h=(t/3600)%24;if(h<6||h>18)return 0;const shape=Math.pow(Math.sin(Math.PI*(h-6)/12),1.5);const cloud=1-x.cloud*.45*(.5+.5*Math.sin(t*.013));return Math.max(0,x.pvMax*shape*cloud*S.pvScale);}
function wind(t,x){const v=Math.max(0,x.windMean*(1+.18*Math.sin(t*.007)+.08*(rng()-.5)));if(v<3)return 0;if(v<12)return x.windMax*Math.pow((v-3)/9,2);if(v<=25)return x.windMax;return 0;}
function ramp(target,current,rate,pmax,dt){const d=Math.max(0,rate)*pmax*dt;return clamp(target,current-d,current+d);}
function loadAt(t,x){const cyc=.62*Math.sin(2*Math.PI*t/900)+.38*Math.sin(2*Math.PI*t/120);return Math.max(0,x.load+x.loadVar*cyc);}
function applyUFLS(f,dt){
  for(const q of S.uf){
    if(!q.a&&f<=q.f){q.t+=dt;if(q.t>=.15){q.a=true;events.push({t:S.t,type:'UFLS',detail:q.f});log(`${ts(S.t)} UFLS stage at ${q.f} Hz`);}}
    else if(q.a&&f>q.f+.25){q.a=false;q.t=0;}
    else if(!q.a)q.t=Math.max(0,q.t-dt*2);
  }
  S.shed=clamp(S.uf.filter(q=>q.a).reduce((a,q)=>a+q.s,0),0,.65);
}
function dispatchFleet(target,dt,f=S.f){
  const x=S.x;
  for(const g of S.fleet){if(g.cool>0)g.cool-=dt;if(g.start>0){g.start-=dt;if(g.start<=0){g.online=true;g.P=g.cap*x.minLoad;log(`${ts(S.t)} ${g.type} synchronized`);}}}
  const online=S.fleet.filter(g=>g.online),cap=online.reduce((a,g)=>a+g.cap,0),min=online.reduce((a,g)=>a+g.cap*x.minLoad,0);
  let need=Math.max(0,target-(f-x.f0)/Math.max(.001,x.droop)*cap);need=clamp(need,online.length?min:0,cap);
  const pu=cap?need/cap:0;
  for(const g of online){const targetP=clamp(g.cap*pu,g.cap*x.minLoad,g.cap),rr=targetP>g.P?x.rampUp:x.rampDn;g.P=clamp(g.P+clamp(targetP-g.P,-rr*dt,rr*dt),0,g.cap);}
  const actual=S.fleet.filter(g=>g.online).reduce((a,g)=>a+g.P,0),nowCap=S.fleet.filter(g=>g.online).reduce((a,g)=>a+g.cap,0);
  if(target>nowCap*.82){const c=S.fleet.find(g=>!g.online&&g.start<=0&&g.cool<=0);if(c){c.start=x.startDelay;log(`${ts(S.t)} start request ${c.type}`);}}
  return actual;
}
function baselineDispatch(load,x){
  const units=[3.3,3.3,3.3,3.3,3.3,3.3,1.25,1.25];let chosen=[],cap=0;
  for(const c of units){chosen.push(c);cap+=c;if(cap>=load*1.1)break;}
  if(!chosen.length)return 0;
  const min=chosen.reduce((a,c)=>a+c*x.minLoad,0),target=clamp(load,min,cap),pu=target/cap;
  return chosen.reduce((a,c)=>a+fuel(c*pu,c),0);
}
function bessControl(Pimb){
  const x=S.x;if(x.bP<=0||x.bE<=0){S.bPwr=0;return 0;}
  const soc=S.E/x.bE,dis=x.bP*(soc<x.socLow?clamp(soc/x.socLow,0,1):1),chg=x.bP*(soc>x.socHigh?clamp((1-soc)/(1-x.socHigh),0,1):1);
  const inertia=-(2*x.Hb*x.bP/x.f0)*S.dfdt,droop=-(S.f-x.f0)/Math.max(.001,x.bDroop)*x.bP,balance=-Pimb,socTerm=(soc-x.socTarget)*x.bP*.25;
  let cmd=.25*inertia+.35*droop+.30*balance+.10*socTerm;
  cmd=clamp(cmd,-chg,dis);if(soc<=.05)cmd=Math.min(0,cmd);if(soc>=.98)cmd=Math.max(0,cmd);S.bPwr=cmd;return cmd;
}
function opState(){if(S.black)return S.black;if(!S.gridAvailable||!S.pccClosed){const dg=S.fleet.some(g=>g.online),soc=S.x.bE?S.E/S.x.bE:0;if(dg&&S.x.bP>0)return'DG+BESS ISLAND';if(dg)return'DG-FORMING';if(S.x.bP>0&&soc>.2)return'BESS-FORMING';return'BLACKOUT';}return mode==='gridtied'?'GRID-TIED':'HYBRID';}
function blackStep(dt){
  if(!S.black)return;S.blackTimer-=dt;
  if(S.black==='BLACK START: DC/UPS'){S.bPwr=0;if(S.blackTimer<=0){S.black='BLACK START: ENERGIZE BUS';S.blackTimer=10;log(`${ts(S.t)} energize MV bus`);}}
  else if(S.black==='BLACK START: ENERGIZE BUS'){S.bPwr=Math.min(S.x.bP,.05*S.x.load);if(S.blackTimer<=0){S.black='BLACK START: START DG';S.blackTimer=S.x.startDelay;const g=S.fleet[0];if(g)g.start=S.x.startDelay;log(`${ts(S.t)} black-start DG request`);}}
  else if(S.black==='BLACK START: START DG'&&S.fleet.some(g=>g.online)){S.black='';log(`${ts(S.t)} black-start sequence complete`);}
}
function step(){
  const x=S.x,dt=x.dt;S.t+=dt;
  if(S.faultPVUntil&&S.t>=S.faultPVUntil){S.pvScale=1;S.faultPVUntil=0;log(`${ts(S.t)} PV fault cleared`);}
  S.motorTimer-=dt;if(S.motorTimer<=0){S.motorActive=3;S.motorTimer=x.motorInt;events.push({t:S.t,type:'MOTOR_START'});log(`${ts(S.t)} motor start ${x.motorMW} MW`);}if(S.motorActive>0)S.motorActive=Math.max(0,S.motorActive-dt);
  applyUFLS(S.f,dt);
  const rawLoad=loadAt(S.t,x)+(S.motorActive>0?x.motorMW*S.motorActive/3:0),servedDemand=rawLoad*(1-S.shed),pvAv=solar(S.t,x),windAv=wind(S.t,x);
  S.pv=ramp(pvAv,S.pv,.08,x.pvMax,dt);S.wind=ramp(windAv,S.wind,.05,x.windMax,dt);
  let grid=0;if(S.gridAvailable&&S.pccClosed){const desired=servedDemand-S.pv-S.wind;grid=clamp(desired,-Math.min(x.gridExport,x.gridMW),Math.min(x.gridImport||x.gridMW,x.gridMW));}S.grid=grid;
  const dieselTarget=Math.max(0,servedDemand-S.pv-S.wind-grid),dg=dispatchFleet(dieselTarget,dt),pre=dg+S.pv+S.wind+grid-servedDemand,bp=bessControl(pre),supply=dg+S.pv+S.wind+grid+bp;
  const imbalance=supply-servedDemand,deficit=Math.max(0,-imbalance);
  S.unservedE+=(deficit+rawLoad*S.shed)*dt/3600;S.reToLoadE+=Math.min(servedDemand,Math.max(0,S.pv+S.wind))*dt/3600;S.loadE+=rawLoad*dt/3600;S.curtE+=(Math.max(0,pvAv-S.pv)+Math.max(0,windAv-S.wind))*dt/3600;
  const onlineCap=S.fleet.filter(g=>g.online).reduce((a,g)=>a+g.cap,0),Heq=Math.max(.5,S.fleet.filter(g=>g.online).reduce((a,g)=>a+4*g.cap,0)/Math.max(x.load,1)),damping=-2.2*(S.f-x.f0)/x.f0*x.load;
  let dfd=(x.f*(imbalance+damping)/Math.max(x.load,1))/(2*Heq);if(!Number.isFinite(dfd))dfd=0;dfd=clamp(dfd,-10,10);S.dfdt=dfd;S.f+=dfd*dt;S.fmin=Math.min(S.fmin,S.f);S.fmax=Math.max(S.fmax,S.f);S.rocof=Math.max(S.rocof,Math.abs(dfd));
  if(Math.abs(dfd)>x.rocofTrip&&(!events.length||events.at(-1).type!=='ROCOF_EXCEED'||S.t-events.at(-1).t>5))events.push({t:S.t,type:'ROCOF_EXCEED',value:dfd});
  const qLoad=servedDemand*.18+(S.motorActive>0?x.motorMW*2.5:0),qCap=Math.min(x.qMax,Math.sqrt(Math.max(0,x.bP*x.bP-bp*bp))),qpcs=clamp((1-S.V)/Math.max(.005,x.qDroop)*qCap,-qCap,qCap),qDG=dg*.18;
  S.Q=qpcs+qDG-qLoad;const vTarget=1+S.Q/Math.max(servedDemand,1)*.04;S.V+=clamp((vTarget-S.V)*dt/3,-.02,.02);S.V=clamp(S.V,.65,1.2);S.vmin=Math.min(S.vmin,S.V);S.vmax=Math.max(S.vmax,S.V);
  if(x.bE>0)S.E=clamp(S.E-(bp>0?bp/x.eta:bp*x.eta)*dt/3600,0,x.bE);
  S.fuel+=S.fleet.reduce((a,g)=>a+(g.online?fuel(g.P,g.cap):0),0)*dt/3600;S.baseFuel+=baselineDispatch(rawLoad,x)*dt/3600;
  const largest=Math.max(0,...S.fleet.filter(g=>g.online).map(g=>g.cap)),remain=Math.max(0,onlineCap-largest),bAvail=Math.min(x.bP,Math.max(0,(S.E-x.bE*.2)*3600/60));
  S.fast10=Math.max(0,S.fleet.filter(g=>g.online).reduce((a,g)=>a+Math.min(g.cap-g.P,x.rampUp*10),0)+Math.min(bAvail,x.bP));S.spin60=Math.max(0,S.fleet.filter(g=>g.online).reduce((a,g)=>a+Math.min(g.cap-g.P,x.rampUp*60),0)+bAvail);S.start10=S.fleet.filter(g=>!g.online&&g.cool<=0&&x.startDelay<=600).reduce((a,g)=>a+g.cap,0);S.n1=remain+bAvail+(S.gridAvailable&&S.pccClosed?x.gridMW:0)>=rawLoad*1.1;
  S.energyResidualMax=Math.max(S.energyResidualMax,Math.abs(imbalance));blackStep(dt);S.op=opState();
  if(Math.floor(S.t/dt)%2===0)series.push({t:S.t,pv:S.pv,wind:S.wind,dg,b:bp,grid,Sload:servedDemand,f:S.f,df:S.f-x.f0,soc:x.bE?100*S.E/x.bE:0,V:S.V,Q:S.Q,op:S.op});if(series.length>50000)series.splice(0,10000);
}
function fault(type){
  if(!started)return;
  if(type==='dg'){const g=S.fleet.filter(g=>g.online).sort((a,b)=>b.cap-a.cap)[0];if(g){g.online=false;g.P=0;g.cool=300;events.push({t:S.t,type:'DG_TRIP'});log(`${ts(S.t)} largest DG tripped`);}}
  if(type==='pv'){S.pvScale=.2;S.faultPVUntil=S.t+300;events.push({t:S.t,type:'PV_CLOUD'});log(`${ts(S.t)} PV cloud event`);}
  if(type==='grid'){S.gridAvailable=false;S.pccClosed=false;events.push({t:S.t,type:'GRID_LOSS'});if(!S.x.islandable){S.fleet.forEach(g=>{g.online=false;g.P=0;});S.bPwr=0;log(`${ts(S.t)} grid loss — islanding not permitted`);}else log(`${ts(S.t)} grid loss — island transition`);}
  if(type==='black'){S.gridAvailable=false;S.pccClosed=false;S.fleet.forEach(g=>{g.online=false;g.P=0;g.start=0;});S.black='BLACK START: DC/UPS';S.blackTimer=5;events.push({t:S.t,type:'BLACK_START'});log(`${ts(S.t)} black-start sequence initiated`);}
}
function setK(id,v,c=''){const e=$(id);e.className='kpi '+c;e.querySelector('b').textContent=v;}
function update(){
  if(!started)return;const x=S.x,soc=x.bE?100*S.E/x.bE:0,saved=Math.max(0,S.baseFuel-S.fuel),re=S.loadE?100*S.reToLoadE/S.loadE:0;
  setK('kFuel',`${S.fuel.toFixed(0)} L`);setK('kSave',`${saved.toFixed(0)} L`,saved>0?'ok':'');setK('kRE',`${re.toFixed(1)}%`,re>40?'ok':'');setK('kCurt',`${S.curtE.toFixed(2)} MWh`,S.curtE>1?'warn':'');setK('kFreq',`${S.fmin.toFixed(2)}/${S.fmax.toFixed(2)}`,S.fmin<S.x.uf1?'bad':'ok');setK('kRo',`${S.rocof.toFixed(2)} Hz/s`,S.rocof>S.x.rocofTrip?'bad':'');setK('kSOC',`${soc.toFixed(1)}%`,soc<20?'bad':soc<30?'warn':'ok');setK('kEENS',`${S.unservedE.toFixed(3)} MWh`,S.unservedE>0?'bad':'ok');
  $('bMode').textContent=S.op;$('bFreq').textContent=`${S.f.toFixed(3)} Hz`;$('bRun').textContent=running?'LIVE':started?'PAUSED':'IDLE';$('bRun').className='badge '+(running?'ok':'');
  $('pills').innerHTML=`<span class="pill ${S.n1?'ok':'bad'}">Gen N-1 ${S.n1?'OK':'FAIL'}</span><span class="pill ${Math.abs(S.f-x.f0)<.3?'ok':'bad'}">Δf ${(S.f-x.f0).toFixed(3)} Hz</span><span class="pill ${S.V>.9&&S.V<1.1?'ok':'bad'}">V ${S.V.toFixed(3)} pu</span><span class="pill">F10 ${S.fast10.toFixed(1)} MW</span><span class="pill">S60 ${S.spin60.toFixed(1)} MW</span><span class="pill">Start10 ${S.start10.toFixed(1)} MW</span><span class="pill">Imbalance ${S.energyResidualMax.toFixed(3)} MW</span>`;updateSLD();
}
function plot(id,keys,colors){
  const c=$(id),r=c.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2);c.width=Math.max(2,r.width*dpr);c.height=Math.max(2,r.height*dpr);const g=c.getContext('2d'),w=c.width,h=c.height;g.fillStyle='#fff';g.fillRect(0,0,w,h);if(series.length<2)return;
  const ml=42*dpr,mr=10*dpr,mt=10*dpr,mb=18*dpr,t0=series[0].t,t1=series.at(-1).t,vals=keys.flatMap(k=>series.map(d=>d[k]));let mn=Math.min(...vals),mx=Math.max(...vals);if(mn===mx){mn-=1;mx+=1;}if(keys.includes('f')){mn=Math.min(mn,S.x.f0-1);mx=Math.max(mx,S.x.f0+1);}const X=t=>ml+(w-ml-mr)*(t-t0)/Math.max(1,t1-t0),Y=v=>mt+(h-mt-mb)*(1-(v-mn)/(mx-mn));g.strokeStyle='#E5E9EE';for(let i=0;i<5;i++){const y=mt+(h-mt-mb)*i/4;g.beginPath();g.moveTo(ml,y);g.lineTo(w-mr,y);g.stroke();}
  keys.forEach((k,j)=>{g.beginPath();series.forEach((d,i)=>{const x=X(d.t),y=Y(d[k]);i?g.lineTo(x,y):g.moveTo(x,y);});g.strokeStyle=colors[j];g.lineWidth=(j===0?2.2:1.7)*dpr;g.stroke();});
}
function draw(){plot('pChart',['Sload','dg','pv','wind','b','grid'],['#64748B','#7C3AED','#D4840A','#0EA5E9','#16A34A','#8B5CF6']);plot('fChart',['f'],['#C026D3']);plot('vChart',['V'],['#B45309']);plot('qChart',['Q'],['#3B82F6']);}
function updateSLD(){const map={sldGrid:S.gridAvailable&&S.pccClosed,sldDG:S.fleet.some(g=>g.online),sldBESS:S.x.bP>0,sldPV:S.pv>0,sldWind:S.wind>0};for(const[k,v]of Object.entries(map))$(k).style.opacity=v?1:.2;$('sldText').textContent=`${S.op} · f ${S.f.toFixed(3)} Hz · V ${S.V.toFixed(3)} pu · SOC ${(S.x.bE?100*S.E/S.x.bE:0).toFixed(1)}%`;}
function loop(){if(!running)return;const n=Math.max(1,Math.round(10/S.x.dt));for(let i=0;i<n&&S.t<S.T;i++)step();update();draw();if(S.t>=S.T){running=false;log(`${ts(S.t)} simulation complete`);return;}raf=requestAnimationFrame(loop);}
function exportJSON(){
  if(!started)return;const sample=[],every=60;let next=0;for(const d of series)if(d.t>=next){sample.push(d);next+=every;}
  const out={modelVersion:VERSION,build:BUILD,generatedAt:new Date().toISOString(),scope:'Conceptual dynamic screening; not load-flow, short-circuit, EMT, protection coordination or detailed engineering.',inputs:S.x,mode,kpis:{fuel_L:S.fuel,fuelSavedBaseline_L:Math.max(0,S.baseFuel-S.fuel),renewableToLoad_pct:S.loadE?100*S.reToLoadE/S.loadE:0,curtailment_MWh:S.curtE,EENS_MWh:S.unservedE,fMin_Hz:S.fmin,fMax_Hz:S.fmax,rocofPeak_Hzs:S.rocof,Vmin_pu:S.vmin,Vmax_pu:S.vmax,finalSOC_pct:S.x.bE?100*S.E/S.x.bE:0,generationN1:S.n1,maxInstantaneousPowerImbalance_MW:S.energyResidualMax},events,timeseries:sample};
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/json'}));a.download=`energize-mine-sim-v6-${Date.now()}.json`;a.click();
}
function bind(){
  document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab').forEach(q=>q.classList.remove('active'));t.classList.add('active');mode=t.dataset.mode;$('gridGroup').style.display=mode==='offgrid'?'none':'block';validate();});
  document.querySelectorAll('input,select').forEach(e=>e.addEventListener('change',validate));
  $('start').onclick=()=>{if(!started&&!init())return;running=true;cancelAnimationFrame(raf);loop();};
  $('pause').onclick=()=>{running=false;cancelAnimationFrame(raf);update();};
  $('reset').onclick=()=>{running=false;cancelAnimationFrame(raf);started=false;init();};
  $('export').onclick=exportJSON;document.querySelectorAll('[data-fault]').forEach(b=>b.onclick=()=>fault(b.dataset.fault));window.addEventListener('resize',()=>started&&draw());validate();
}
document.addEventListener('DOMContentLoaded',bind);
})();