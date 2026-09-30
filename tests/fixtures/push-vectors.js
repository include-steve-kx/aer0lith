// Development-only deterministic integration/visual check; never imported by the app.
import '../../src/styles.css';
import { App } from '../../src/App.ts';
import { DEFAULT_COMBAT } from '../../src/combat/settings.ts';
import { Vector3 } from 'three';
const markup = new DOMParser().parseFromString(await (await fetch('/index.html')).text(), 'text/html');
for (const s of markup.querySelectorAll('script')) s.remove();
document.body.innerHTML = markup.body.innerHTML;
const app = new App(document.querySelector('#app'), 'push-vector-validation');
app.syncViews();
app.cameraRig.camera.position.copy(app.flight.position).add(new Vector3(45, 35, -65)).sub(app.renderOrigin);
app.cameraRig.controls.target.copy(app.flight.position).add(new Vector3(0, 5, 75)).sub(app.renderOrigin);
app.cameraRig.camera.lookAt(app.cameraRig.controls.target);
app.togglePause();
const settings = {...DEFAULT_COMBAT, meteorProximityEnabled:false, missileEnabled:false};
for (const owner of [app.meteors,app.impacts,app.missiles,app.combatView]) owner.configure(settings);
app.meteors.reset();
app.meteors.updateProximity(.01,app.flight.position,app.flight.position,app.flight.orientation);
for (const [x,y,z,size] of [[-24,4,70,6],[0,14,110,12],[35,0,90,18]]) {
  const rock=app.meteors.spawnAt(app.flight.position.clone().add(new Vector3(x,y,z)),size,0);
  if (rock) rock.detected=8;
}
const panel=document.createElement('div'); panel.style.cssText='position:fixed;z-index:500;left:20px;bottom:100px;background:#141c20;color:white;padding:12px;font:12px monospace';
const status=document.createElement('output'); panel.append(status); document.body.append(panel);
function button(label,action){const b=document.createElement('button');b.textContent=label;b.onclick=action;panel.append(b);}
button('Triple tap test',()=>{
  app.input.boost.reset(); app.root.focus();
  for(let i=0;i<3;i++) {
    window.dispatchEvent(new KeyboardEvent('keydown',{code:'ShiftLeft',bubbles:true}));
    app.input.read(.1);
    window.dispatchEvent(new KeyboardEvent('keyup',{code:'ShiftLeft',bubbles:true}));
  }
  status.textContent=`locked=${app.input.boost.locked} active=${app.input.boost.active} `;
});
button('Unlock test',()=>{
  app.root.focus(); window.dispatchEvent(new KeyboardEvent('keydown',{code:'ShiftLeft',bubbles:true}));
  window.dispatchEvent(new KeyboardEvent('keyup',{code:'ShiftLeft',bubbles:true}));
  status.textContent=`locked=${app.input.boost.locked} active=${app.input.boost.active} `;
});
button('Blast speed test',()=>{
  app.flight.takeManualControl(); app.flight.speed=120; app.flight.throttle=1;
  app.flight.applyExternalImpulse(new Vector3(30,0,0),2);
  // Isolate telemetry from random terrain collisions in this deterministic fixture.
  const collision = app.terrainModel.collisionDensityAt;
  app.terrainModel.collisionDensityAt = () => -1000;
  try { app.flight.update(1/120,{pitch:0,roll:0,yaw:0,throttle:1}); }
  finally { app.terrainModel.collisionDensityAt = collision; }
  app.updateHud(1/60);
  status.textContent=`propulsion=${app.flight.speed} actual=${app.flight.actualSpeed.toFixed(3)} hud=${document.querySelector('#speed-value').textContent} `;
});
app.start();
