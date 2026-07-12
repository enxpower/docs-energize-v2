'use strict';

function v67FirmBessReserveMW(x){
  if(!x.bE||!x.bP)return 0;
  const usableMWh=Math.max(0,S.E-x.bE*x.socLow);
  return Math.min(x.bP,usableMWh*6); // firm ten-minute bridge
}

function v67PostContingencyCapacity(run,candidate,x){
  const remaining=run.filter(g=>g!==candidate);
  const capacity=remaining.reduce((sum,g)=>sum+g.cap,0);
  const largest=Math.max(0,...remaining.map(g=>g.cap));
  return Math.max(0,capacity-largest)+v67FirmBessReserveMW(x);
}

function updateCommitment(required,dt,connected){
  const x=S.x;
  for(const g of S.fleet){
    g.runTime=g.online?g.runTime+dt:0;
    g.offTime=!g.online?g.offTime+dt:0;
    if(g.cool>0)g.cool=Math.max(0,g.cool-dt);
    if(g.state==='STARTING'){
      g.start-=dt;
      if(g.start<=0){
        g.state='RUNNING';g.online=true;
        g.P=g.Pcmd=g.Pgov=g.Pmech=g.cap*x.minLoad;
        g.fuelRack=g.turbo=x.minLoad;g.runTime=0;
        log(`${ts(S.t)} ${g.type} synchronized`);
      }
    }
  }

  const starting=S.fleet.some(g=>g.state==='STARTING');
  const comm=committedCap();
  const startThreshold=Math.max(required*1.12,x.load*.55);
  if(startThreshold>comm*.9&&!starting){
    const g=S.fleet.find(q=>q.state==='OFF'&&q.cool<=0&&q.offTime>=600);
    if(g){g.state='STARTING';g.start=x.startDelay;log(`${ts(S.t)} start request ${g.type}`);}
  }

  const run=S.fleet.filter(g=>g.online);
  const renewableSurplus=Math.max(0,(S.pv||0)+(S.wind||0)-Math.max(0,x.load-(S.bP||0)));
  const lowDispatch=required<run.reduce((sum,g)=>sum+g.cap*x.minLoad,0)*.55;
  const mayOptimize=run.length>2&&(connected||renewableSurplus>.5||lowDispatch);

  if(mayOptimize){
    const candidate=run.at(-1);
    const postN1=v67PostContingencyCapacity(run,candidate,x);
    const n1Requirement=Math.max(x.load*1.03,required*1.12);
    if(postN1>=n1Requirement){
      candidate.low+=dt;
      if(candidate.low>600&&candidate.runTime>=1800){
        candidate.online=false;candidate.state='OFF';
        candidate.P=candidate.Pcmd=candidate.Pgov=candidate.Pmech=0;
        candidate.fuelRack=candidate.turbo=0;
        candidate.cool=900;candidate.low=0;candidate.offTime=0;
        events.push({t:S.t,type:'DG_STOP_RENEWABLE_OPTIMIZATION'});
        log(`${ts(S.t)} ${candidate.type} stopped · renewable-priority N-1 dispatch`);
      }
    }else candidate.low=0;
  }else run.forEach(g=>g.low=0);
}

function bessFastCommand(residual,connected,dt){
  const x=S.x,L=bessLimits();
  S.fMeas=firstOrder(S.fMeas,S.f,.35,dt);
  const df=S.fMeas-x.f0,dead=.045;
  const ferr=Math.abs(df)>dead?df-Math.sign(df)*dead:0;
  let cmd=-residual;

  if(!connected&&S.t>=S.startupUntil){
    cmd+=clamp(-ferr/(x.bDroop*x.f0)*x.bP,-.14*x.bP,.14*x.bP)
      +clamp(-2*x.Hb*x.bP/x.f0*S.dfdt,-.06*x.bP,.06*x.bP);
  }

  if(Math.abs(cmd)<Math.max(.04,.006*x.bP))cmd=0;
  cmd=clamp(cmd,-L.chg,L.dis);

  const renewableCharging=cmd<0&&residual>0;
  const tau=renewableCharging?.25:(S.t<S.startupUntil?.6:1.2);
  const rampRate=renewableCharging?1.5*x.bP:.9*x.bP;
  S.bCmd=firstOrder(S.bCmd,cmd,tau,dt);
  S.bP=rampAbs(S.bCmd,S.bP,rampRate,dt);
  return S.bP;
}

window.V6_RENEWABLE_DISPATCH_POLICY='renewables-first-n1-r1';
