import assert from 'node:assert/strict';
import test from 'node:test';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { MeteorSystem } from '../src/combat/MeteorSystem.ts';
import { RockLibrary } from '../src/combat/geometry.ts';
import { PushVectorView } from '../src/combat/PushVectorView.ts';
import { explosionImpulse } from '../src/combat/ExplosionForce.ts';
import { DEFAULT_COMBAT } from '../src/combat/settings.ts';
import { FlightController } from '../src/flight/FlightController.ts';
import type { ProceduralTerrain } from '../src/world/TerrainModel.ts';
const air = { densityAt:()=>-1000, collisionDensityAt:()=>-1000,
  sample:()=>({x:0,y:0,tangentX:0,tangentY:0,openness:1,width:200,height:200,floorY:-100}) };
const library = new RockLibrary('push-vectors');
test.after(()=>library.dispose());
const zero = new Vector3(), q = new Quaternion();
const neutral = { pitch:0, roll:0, yaw:0, throttle:0 };

test('speed is measured travel including blast vectors, opposite thrust, rolls, and reset', () => {
  for (const impulse of [new Vector3(30,0,0),new Vector3(0,0,30),new Vector3(0,0,-30)]) {
    const flight = new FlightController(air as unknown as ProceduralTerrain);
    flight.speed = 120; flight.throttle = 1;
    const before = flight.position.clone();
    flight.applyExternalImpulse(impulse,2);
    flight.update(.01,{...neutral,throttle:1});
    assert.equal(flight.speed,120);
    assert.ok(Math.abs(flight.actualSpeed-flight.position.distanceTo(before)/.01)<1e-9);
    const blast = impulse.clone().multiplyScalar(1-.01/4).add(new Vector3(0,0,120));
    assert.ok(Math.abs(flight.actualSpeed-blast.length())<1e-8);
    assert.notEqual(flight.actualSpeed,120);
    const frozen = flight.actualSpeed; flight.update(0,neutral); assert.equal(flight.actualSpeed,frozen);
    flight.reset(); assert.equal(flight.actualSpeed,flight.speed);
  }
  const flight = new FlightController(air as unknown as ProceduralTerrain);
  flight.startRoll(1); flight.update(.1,neutral);
  assert.ok(flight.actualSpeed>flight.speed);
});

test('arrows start at rock center and end at the exact shared impulse times the display scale', () => {
  const meteors = new MeteorSystem(air,library,'arrows'), view = new PushVectorView();
  const rock = meteors.spawnAt(new Vector3(100,10,100),12,0)!;
  rock.detected=8;
  const origin = new Vector3(0,0,90), shaft = new Matrix4(), head = new Matrix4();
  for (const diameter of [6,12,18]) {
    rock.diameter=diameter;
    for (const scale of [.5,2,10]) {
      meteors.configure({...DEFAULT_COMBAT,meteorPushVectorScale:scale,meteorProximityEnabled:false});
      meteors.updateProximity(.01,zero,new Vector3(10,20,30),q);
      view.sync(meteors,origin,true);
      const impulse=meteors.predictExplosionImpulse(new Vector3(),rock);
      const direct=explosionImpulse(new Vector3(),meteors.shipPosition,rock.position,
        meteors.shipVelocity,new Vector3(0,0,1),diameter,30,400,.5);
      assert.ok(impulse.distanceTo(direct)<1e-9);
      view.shafts.getMatrixAt(0,shaft); view.heads.getMatrixAt(0,head);
      assert.ok(new Vector3().applyMatrix4(shaft).add(origin).distanceTo(rock.position)<1e-5);
      assert.ok(new Vector3(0,1,0).applyMatrix4(head).add(origin).distanceTo(rock.position.clone().addScaledVector(impulse,scale))<1e-4);
      assert.equal(view.heads.count,1);
    }
  }
  // Display remains live for paused settings changes; zero/outside radius has no false vector.
  meteors.configure({...DEFAULT_COMBAT,explosionPush:0}); view.sync(meteors,origin,true); assert.equal(view.heads.count,0);
  meteors.configure({...DEFAULT_COMBAT}); meteors.shipPosition.set(1000,0,0);
  view.sync(meteors,origin,true); assert.equal(view.heads.count,0);
  meteors.shipPosition.copy(zero); view.sync(meteors,origin,false); assert.equal(view.heads.count,0);
  rock.detected=0; view.sync(meteors,origin,true); assert.equal(view.heads.count,0);
  rock.detected=8; rock.active=false; view.sync(meteors,origin,true); assert.equal(view.heads.count,0);
  view.dispose(); view.dispose(); meteors.dispose();
});

test('shared prediction equals destruction impulse, uses size, and handles coincident centers', () => {
  const meteors = new MeteorSystem(air,library,'destruction');
  meteors.configure({...DEFAULT_COMBAT,meteorProximityEnabled:false});
  meteors.updateProximity(.01,zero,zero,q);
  let previous=0;
  for (const diameter of [6,12,18]) {
    const rock=meteors.spawnAt(new Vector3(0,0,100),diameter,0)!;
    const expected=meteors.predictExplosionImpulse(new Vector3(),rock);
    assert.ok(expected.length()>previous); previous=expected.length();
    meteors.onDestroyed=(snapshot)=>assert.ok(meteors.predictExplosionImpulse(new Vector3(),snapshot).equals(expected));
    meteors.applyHit({slot:meteors.rocks.indexOf(rock),generation:rock.generation},new Vector3(0,0,95),new Vector3(1,0,0),true);
  }
  const coincident=meteors.predictExplosionImpulse(new Vector3(),{position:zero,diameter:12});
  assert.deepEqual(coincident.toArray(),[0,0,-15]);
  meteors.dispose();
});
