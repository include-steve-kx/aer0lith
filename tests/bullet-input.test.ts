import assert from 'node:assert/strict';
import test from 'node:test';
import { getMaxListeners, setMaxListeners } from 'node:events';
import { InputManager, type InputActions, type PointerFlightControls } from '../src/flight/InputManager.ts';

class ElementStub extends EventTarget {
  tagName = 'DIV';
  style: Record<string,string> = {};
  classList = { add() {}, remove() {} };
  captured = new Set<number>();
  querySelectorAll() { return []; }
  contains() { return true; }
  closest(selector: string) {
    if (selector === 'button') return this.tagName === 'BUTTON' ? this : null;
    return this.tagName === 'INPUT' ? this : null;
  }
  focus() { (document as unknown as {activeElement: ElementStub}).activeElement = this; }
  setPointerCapture(id: number) { this.captured.add(id); }
  hasPointerCapture(id: number) { return this.captured.has(id); }
  releasePointerCapture(id: number) { this.captured.delete(id); }
  getBoundingClientRect() { return { left:0, top:0, width:100, height:100 }; }
}
function fireEvent(target: EventTarget, type: string, values: Record<string,unknown> = {}) {
  const event = new Event(type, {cancelable:true});
  for(const [key,value] of Object.entries(values)) Object.defineProperty(event,key,{value});
  target.dispatchEvent(event);
}
test('fire input queues quick taps, isolates focused controls and simultaneous pointers, and disposes listeners', () => {
  const names = ['window','document','Element','Node','HTMLButtonElement'];
  const before = names.map(name=>Object.getOwnPropertyDescriptor(globalThis,name));
  const root = new ElementStub(), win = new EventTarget(), doc = Object.assign(new EventTarget(), { activeElement:root, hidden:false, fullscreenElement:null });
  const defaults = [win,doc,ElementStub,ElementStub,ElementStub];
  names.forEach((name,i)=>Object.defineProperty(globalThis,name,{value:defaults[i],configurable:true}));
  const oldMax = getMaxListeners(new EventTarget()); setMaxListeners(100);
  let manual = 0, pulses = 0, probes = 0, views = 0, seeds = 0, fullscreens = 0;
  const actions = {onManualInput:()=>manual++,onRoll:()=>{},onToggleAutopilot:()=>{},onCycleCamera:()=>{},onSelectCamera:()=>{},onToggleAudio:()=>{},onReset:()=>{},onPause:()=>{},onNewSeed:()=>seeds++,onToggleExperienceMode:()=>views++,onToggleFullscreen:()=>fullscreens++,onTriggerProbe:()=>probes++,onTriggerPulse:()=>pulses++} satisfies InputActions;
  const button = () => Object.assign(new ElementStub(),{tagName:'BUTTON'});
  const fire = button(), throttle = button(), drift = button(), joystick = new ElementStub();
  const controls = { fireButton:fire, throttleButton:throttle, driftButton:drift, joystick, joystickThumb:new ElementStub(), rollLeftButton:button(), rollRightButton:button() } as unknown as PointerFlightControls;
  const input = new InputManager(root as unknown as HTMLElement,actions,controls);
  const key = (code: string, type='keydown', target:ElementStub=root, repeat=false) => fireEvent(win,type,{code,target,repeat});
  const pointer = (target:ElementStub,type:string,id:number) => fireEvent(target,type,{pointerId:id,pointerType:'touch',button:0,clientX:80,clientY:50});
  try {
    key('Space'); key('Space','keyup'); assert.equal(input.firing,false); assert.equal(input.consumeFire(),true); assert.equal(input.consumeFire(),false);
    key('Space'); input.clearFire(); key('Space','keydown',root,true); assert.equal(input.consumeFire(),false); key('Space','keyup');
    const setting = Object.assign(new ElementStub(),{tagName:'INPUT'}); doc.activeElement = setting; key('Space','keydown',setting); assert.equal(input.consumeFire(),false);
    const other = button(); doc.activeElement=other; key('Space','keydown',other); assert.equal(input.consumeFire(),false);
    doc.activeElement=root;
    key('Space'); pointer(fire,'pointerdown',3); input.consumeFire(); pointer(fire,'pointerup',3); assert.equal(input.firing,true,'pointer release preserves keyboard fire'); key('Space','keyup'); assert.equal(input.firing,false);
    pointer(joystick,'pointerdown',1); pointer(throttle,'pointerdown',2); pointer(fire,'pointerdown',3);
    assert.equal(input.firing,true); assert.ok(input.read().roll>0); assert.equal(input.read().throttle,1);
    key('ControlLeft'); assert.equal(input.read().throttle,1,'Control no longer overrides boost'); key('ControlLeft','keyup');
    pointer(fire,'pointercancel',3); assert.equal(input.consumeFire(),false); assert.equal(input.read().throttle,1,'fire cancellation preserves boost');
    pointer(joystick,'pointerup',1); pointer(throttle,'pointerup',2);
    pointer(drift,'pointerdown',6); assert.equal(input.read().driftHeld,true); pointer(drift,'pointerup',6); assert.equal(input.read().driftHeld,false);
    key('KeyJ'); assert.equal(input.read().driftHeld,true); key('KeyJ','keyup');
    key('KeyK'); assert.equal(input.read().boostHeld,true); key('KeyK','keyup');
    key('ShiftLeft'); assert.equal(input.read().boostHeld,false,'Shift is no longer boost'); key('ShiftLeft','keyup');
    pointer(fire,'pointerdown',4); pointer(fire,'pointerup',4); assert.equal(input.consumeFire(),true); assert.equal(input.consumeFire(),false);
    key('Space'); doc.hidden=true; fireEvent(doc,'visibilitychange'); assert.equal(input.consumeFire(),false);
    doc.hidden=false; key('Space','keyup'); key('Space'); fireEvent(win,'blur'); assert.equal(input.consumeFire(),false);
    const previousManual=manual; key('Space'); assert.equal(manual,previousManual);
    key('KeyF'); key('KeyF','keydown',root,true); assert.equal(probes,1); key('KeyF','keyup'); key('KeyF'); assert.equal(probes,2); key('KeyF','keyup');
    key('KeyG'); key('KeyG','keydown',root,true); assert.equal(pulses,1); key('KeyG','keyup'); key('KeyG'); assert.equal(pulses,2); key('KeyG','keyup');
    key('KeyU'); assert.equal(views,1); key('KeyU','keyup');
    key('KeyN'); assert.equal(seeds,0); key('KeyN','keyup');
    fireEvent(win,'keydown',{code:'KeyN',target:root,repeat:false,shiftKey:true}); assert.equal(seeds,1); key('KeyN','keyup');
    fireEvent(win,'keydown',{code:'Enter',target:root,repeat:false,altKey:true,ctrlKey:false,metaKey:false}); assert.equal(fullscreens,1);
    fireEvent(win,'keydown',{code:'KeyF',target:root,repeat:false,ctrlKey:true}); assert.equal(probes,2,'modified F remains a browser shortcut');
    key('KeyX'); key('KeyB'); key('KeyV');
    assert.deepEqual({ pulses, probes, views }, { pulses: 2, probes: 2, views: 1 }, 'retired shortcuts do nothing');
    input.dispose(); input.dispose(); key('Space'); pointer(fire,'pointerdown',5); assert.equal(input.consumeFire(),false);
  } finally {
    input.dispose(); setMaxListeners(oldMax);
    names.forEach((name,i)=>{if(before[i])Object.defineProperty(globalThis,name,before[i]!);else Reflect.deleteProperty(globalThis,name);});
  }
});
