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

function v67CommitmentState(){
  if(!S.commitmentGovernance){
    S.commitmentGovernance={
      startDeficitSeconds:0,
      lowLoadSeconds:0,
      transitionLockSeconds:0,
      lastAction:'INITIAL',
      starts:0,
      stops:0,
    };
  }
  return S.commitmentGovernance;
}

function v67CanStart(g){
  return g.state==='OFF'&&g.cool<=0&&g.offTime>=3600;
}

function v67StopCandidate(run){
  return [...run]
    .filter(g=>g.runTime>=7200)
    .sort((a,b)=>a.P-b.P||a.cap-b.cap)
    .at(0);
}

function updateCommitment(required,dt,connected){
  const x=S.x;
  const gov=v67CommitmentState();
  gov.transitionLockSeconds=Math.max(0,gov.transitionLockSeconds-dt);

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
        gov.transitionLockSeconds=1800;
        gov.lastAction='SYNCHRONIZED';
        log(`${ts(S.t)} ${g.type} synchronized · minimum-up timer active`);
      }
    }
  }

  const starting=S.fleet.some(g=>g.state==='STARTING');
  const comm=committedCap();
  const firmBess=v67FirmBessReserveMW(x);
  const startNeed=Math.max(required*1.15,x.load*.62);
  const startDeficit=startNeed>comm*.90||required>comm+firmBess*.35;

  gov.startDeficitSeconds=startDeficit?gov.startDeficitSeconds+dt:Math.max(0,gov.startDeficitSeconds-2*dt);

  if(gov.transitionLockSeconds<=0&&!starting&&gov.startDeficitSeconds>=300){
    const g=S.fleet.find(v67CanStart);
    if(g){
      g.state='STARTING';g.start=x.startDelay;
      gov.startDeficitSeconds=0;
      gov.lowLoadSeconds=0;
      gov.transitionLockSeconds=Math.max(900,x.startDelay);
      gov.lastAction='START_REQUEST';
      gov.starts++;
      events.push({t:S.t,type:'DG_START_HYSTERESIS'});
      log(`${ts(S.t)} start request ${g.type} · sustained capacity deficit`);
    }
  }

  const run=S.fleet.filter(g=>g.online);
  const candidate=v67StopCandidate(run);
  const minRunning=3;
  const soc=x.bE?S.E/x.bE:1;
  const minDispatch=run.reduce((sum,g)=>sum+g.cap*x.minLoad,0);
  const lowDispatch=required<minDispatch*.72;
  const renewableAvailable=(S.pv||0)+(S.wind||0);
  const renewableSupport=renewableAvailable>Math.max(1,x.load*.18);
  const storageReady=!x.bE||soc>=Math.max(x.socTarget-.03,x.socLow+.18);
  const postN1=candidate?v67PostContingencyCapacity(run,candidate,x):0;
  const n1Requirement=Math.max(x.load*1.05,required*1.15);
  const mayStop=Boolean(candidate)
    &&run.length>minRunning
    &&lowDispatch
    &&renewableSupport
    &&storageReady
    &&postN1>=n1Requirement
    &&!starting
    &&gov.transitionLockSeconds<=0;

  gov.lowLoadSeconds=mayStop?gov.lowLoadSeconds+dt:Math.max(0,gov.lowLoadSeconds-2*dt);

  if(candidate&&gov.lowLoadSeconds>=3600){
    candidate.online=false;candidate.state='OFF';
    candidate.P=candidate.Pcmd=candidate.Pgov=candidate.Pmech=0;
    candidate.fuelRack=candidate.turbo=0;
    candidate.cool=3600;candidate.low=0;candidate.offTime=0;
    gov.lowLoadSeconds=0;
    gov.startDeficitSeconds=0;
    gov.transitionLockSeconds=3600;
    gov.lastAction='STOPPED';
    gov.stops++;
    events.push({t:S.t,type:'DG_STOP_RENEWABLE_OPTIMIZATION'});
    log(`${ts(S.t)} ${candidate.type} stopped · 60 min low-load dwell, N-1 retained`);
  }
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

window.V6_RENEWABLE_DISPATCH_POLICY='renewables-first-n1-hysteresis-r2';
