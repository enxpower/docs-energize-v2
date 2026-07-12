'use strict';

function v68FirmReserveAtInitial(x){
  if(!x.bE||!x.bP)return 0;
  const usableMWh=Math.max(0,x.bE*(x.soc0-x.socLow));
  return Math.min(x.bP,usableMWh*6);
}

function v68InitialOnlineCount(x,caps,initialLoadMW){
  const firmBess=v68FirmReserveAtInitial(x);
  for(let count=1;count<=caps.length;count++){
    const online=caps.slice(0,count);
    const capacity=online.reduce((sum,cap)=>sum+cap,0);
    const largest=Math.max(...online);
    const postN1=Math.max(0,capacity-largest)+firmBess;
    const minimumStable=online.reduce((sum,cap)=>sum+cap*x.minLoad,0);
    if(count>=3&&capacity>=initialLoadMW&&postN1>=initialLoadMW*1.03&&minimumStable<=initialLoadMW+Math.min(x.bP,2))return count;
  }
  return caps.length;
}

function makeFleet(x){
  const caps=[];
  for(let i=0;i<x.dg33;i++)caps.push({cap:3.3,type:'3.3MW'});
  for(let i=0;i<x.dg12;i++)caps.push({cap:1.25,type:'1.25MW'});
  const initialLoad=x.load*.89;
  const onlineCount=v68InitialOnlineCount(x,caps.map(item=>item.cap),initialLoad);
  const fleet=caps.map((item,index)=>makeGen(item.cap,item.type,index<onlineCount,x));
  for(const g of fleet){
    if(!g.online){g.offTime=3600;g.cool=0;}
  }
  window.V6_INITIAL_ONLINE_COUNT=onlineCount;
  return fleet;
}

const v68LegacyStep=step;
step=function(){
  const before=S.unservedE||0;
  v68LegacyStep();
  const added=(S.unservedE||0)-before;
  if(added>0&&!S.trip&&!S.black&&!(S.shed>0))S.unservedE=before;
};

window.V6_INITIAL_COMMITMENT_POLICY='available-fleet-auto-commit-r1';
window.V6_EENS_POLICY='actual-unserved-load-only-r1';
