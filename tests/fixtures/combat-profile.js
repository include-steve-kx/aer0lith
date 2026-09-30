import '../../src/styles.css';
import '@fontsource/share-tech-mono/400.css';
import { Vector3, Quaternion } from 'three';
import { App } from '../../src/App.ts';
import { DEFAULT_COMBAT } from '../../src/combat/settings.ts';
const markup=await (await fetch('/index.html')).text();
const template=new DOMParser().parseFromString(markup,'text/html');for(const s of template.querySelectorAll('script'))s.remove();document.body.innerHTML=template.body.innerHTML;
const app=new App(document.querySelector('#app'),'combat-validation');
const panel=document.createElement('pre');panel.style.cssText='position:fixed;z-index:300;left:10px;top:10px;color:white;background:#121c28e8;font:12px monospace;padding:10px;max-height:90vh;overflow:auto;pointer-events:none';document.body.append(panel);
const phases=['rocks only','markers only','missiles without markers','impacts only','all effects'];let phase=-1,start=performance.now(),results=[],samples=[],timings={},calls={},phaseStart=0;
let densityCalls=0,collisionCalls=0,launched=0;const originalDensity=app.terrainModel.densityAt.bind(app.terrainModel),originalCollision=app.terrainModel.collisionDensityAt.bind(app.terrainModel);
app.terrainModel.densityAt=(...args)=>{densityCalls++;return originalDensity(...args);};app.terrainModel.collisionDensityAt=(...args)=>{collisionCalls++;return originalCollision(...args);};
for(const [owner,method,label] of [[app.combatHud,'update','marker HUD'],[app.combatView,'sync','combat buffers'],[app.meteors,'advance','meteor motion'],[app.meteors,'sweepShip','ship sweep'],[app.meteors,'avoidance','avoidance'],[app.missiles,'update','missile simulation'],[app.impacts,'update','impact simulation'],[app.post,'render','render submission']]){const fn=owner[method].bind(owner);owner[method]=(...args)=>{const before=performance.now(),d=densityCalls,c=collisionCalls;const result=fn(...args);timings[label]=(timings[label]||0)+performance.now()-before;calls[label]=(calls[label]||0)+(densityCalls-d);calls[label+' cells']=(calls[label+' cells']||0)+(collisionCalls-c);return result;};}
const ship=app.flight.position.clone(),q=new Quaternion(),direction=new Vector3(0,0,1);app.flight.update=()=>{};app.flight.speed=60;
function resetPhase(index){app.resetCombat();app.flight.position.copy(ship);app.flight.orientation.identity();app.flight.cameraOrientation.identity();const settings={...DEFAULT_COMBAT,meteorSpeed:0,meteorSpin:0,meteorInterval:40,missileEnabled:index===2||index===4,meteorMarkers:index===1||index===4};app.meteors.configure(settings);app.missiles.configure(settings);app.impacts.configure(settings);app.combatView.configure(settings);
 for(let i=0;i<6;i++){const z=140+(i%3)*60,path=app.terrainModel.sample(z);const m=app.meteors.spawnAt(new Vector3(path.x+(i%2?1:-1)*16,path.y+(i%2?9:-9),z),14,16+i);m.detected=index===0?0:8;}
 samples=[];phaseStart=performance.now();launched=app.missiles.launches;
}
function summary(){const keys=Object.keys(samples[0]?.times??{});return {phase:phases[phase],frames:samples.length,launches:app.missiles.launches-launched,frame:stats(samples.map(s=>s.total)),subsystems:Object.fromEntries(keys.map(k=>[k,{...stats(samples.map(s=>s.times[k]||0)),meanDensityCalls:Math.round(samples.reduce((sum,s)=>sum+(s.calls[k]||0),0)/samples.length)}]))};}
function stats(values){values.sort((a,b)=>a-b);const n=values.length;return {mean:+(values.reduce((a,b)=>a+b,0)/Math.max(1,n)).toFixed(3),p50:+(values[Math.floor(n*.5)]||0).toFixed(3),p95:+(values[Math.floor(n*.95)]||0).toFixed(3),max:+(values[n-1]||0).toFixed(3)};}
const original=app.frame;
app.frame=(now)=>{if(phase<0){phase=0;resetPhase(phase);}if(now-phaseStart>6500){results.push(summary());phase++;if(phase===phases.length){app.paused=true;app.running=false;panel.textContent=JSON.stringify(results,null,2);return;}resetPhase(phase);}
 if((phase===3||phase===4)&&Math.floor((now-phaseStart)/800)!==app.profileBurst){app.profileBurst=Math.floor((now-phaseStart)/800);for(const m of app.meteors.rocks)if(m.active)app.impacts.spawn(m,m.position,direction);}
 timings={};calls={};const before=performance.now();original(now);const total=performance.now()-before;if(now-phaseStart>1000)samples.push({total,times:timings,calls});panel.textContent=JSON.stringify({phase:phases[phase],frames:samples.length,lastMs:+total.toFixed(2),timings,calls,completed:results},null,2);};app.start();
