import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { DynamicObstacleProvider } from '../src/combat/types.ts';
import type { FlightImpactSnapshot } from '../src/core/types.ts';
import { FLIGHT } from '../src/core/config.ts';
import { FlightController } from '../src/flight/FlightController.ts';
import { DEFAULT_FLIGHT_TUNING } from '../src/flight/FlightTuning.ts';
import { RouteProgress } from '../src/flight/RouteProgress.ts';
import { CollisionSparkView } from '../src/render/CollisionSparkView.ts';
import {
  navigationAngleChanged,
  navigationArrowGeometry,
  routeArrowOrientation,
} from '../src/render/NavigationArrowView.ts';
import {
  createDriftMeterGeometry,
  DRIFT_METER_CENTER,
  DRIFT_METER_OUTER_RADIUS,
  driftMeterPoint,
} from '../src/ui/DriftMeterGeometry.ts';
import type { ProceduralTerrain } from '../src/world/TerrainModel.ts';

const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
const openTerrain = {
  sample: () => ({ x: 0, y: 50, floorY: -150, tangentX: 0, tangentY: 0,
    width: 10000, height: 10000, openness: 1 }),
  densityAt: () => -1000,
  collisionDensityAt: () => -1000,
} as unknown as ProceduralTerrain;

function collide(
  velocity: Vector3,
  normal: Vector3,
  surfaceVelocity = new Vector3(),
): { flight: FlightController; impact: FlightImpactSnapshot } {
  const flight = new FlightController(openTerrain);
  flight.takeManualControl();
  flight.configure({
    ...DEFAULT_FLIGHT_TUNING,
    normalAcceleration: 0,
    normalGrip: 0,
    collisionSeparationSpeed: 0,
  });
  flight.speed = velocity.length();
  flight.controlVelocity.copy(velocity);
  let first = true;
  flight.obstacles = {
    sweepShip: (_from, _to, _fromQ, _toQ, _cockpit, hit) => {
      if (!first || !hit) return false;
      first = false;
      hit.point.set(0, 0, 0);
      hit.localPoint.set(0, 0, 0);
      hit.normal.copy(normal);
      hit.surfaceVelocity.copy(surfaceVelocity);
      return true;
    },
    clearance: () => true,
    avoidance: () => false,
  } satisfies DynamicObstacleProvider;
  let snapshot: FlightImpactSnapshot | undefined;
  flight.onImpact = value => { snapshot = {
    ...value,
    point: value.point.clone(),
    localPoint: value.localPoint.clone(),
    normal: value.normal.clone(),
    surfaceVelocity: value.surfaceVelocity.clone(),
    relativeVelocityBefore: value.relativeVelocityBefore.clone(),
    relativeVelocityAfter: value.relativeVelocityAfter.clone(),
    tangentialDirection: value.tangentialDirection.clone(),
  }; };
  flight.update(FLIGHT.fixedStep, neutral);
  assert.ok(snapshot);
  return { flight, impact: snapshot };
}

test('collision response applies restitution and Coulomb-style friction while losing energy', () => {
  const { flight, impact } = collide(new Vector3(-10, 0, 20), new Vector3(1, 0, 0));
  assert.ok(Math.abs(impact.relativeVelocityAfter.x - 1.8) < 1e-10);
  assert.ok(Math.abs(impact.relativeVelocityAfter.z - 14) < 1e-10);
  assert.ok(impact.relativeVelocityAfter.lengthSq() < impact.relativeVelocityBefore.lengthSq());
  assert.ok(impact.dissipatedEnergy > 0);
  assert.ok(flight.controlVelocity.equals(impact.relativeVelocityAfter));
});

test('moving-surface collision uses meteor-relative velocity', () => {
  const surface = new Vector3(5, 0, 0);
  const { flight, impact } = collide(new Vector3(-5, 0, 12), new Vector3(1, 0, 0), surface);
  assert.deepEqual(impact.surfaceVelocity.toArray(), surface.toArray());
  assert.deepEqual(impact.relativeVelocityBefore.toArray(), [-10, 0, 12]);
  assert.ok(Math.abs(impact.relativeVelocityAfter.x - 1.8) < 1e-10);
  assert.ok(Math.abs(impact.relativeVelocityAfter.z - 6) < 1e-10);
  assert.ok(flight.controlVelocity.clone().add(flight.externalVelocity)
    .equals(impact.relativeVelocityAfter.clone().add(surface)));
});

test('sustained contact does not repeatedly inject separation speed', () => {
  const flight = new FlightController(openTerrain);
  flight.takeManualControl();
  flight.configure({ ...DEFAULT_FLIGHT_TUNING, normalAcceleration: 0, normalGrip: 0 });
  flight.speed = 10;
  flight.controlVelocity.set(-10, 0, 0);
  flight.obstacles = {
    sweepShip: (_from, _to, _fromQ, _toQ, _cockpit, hit) => {
      if (!hit) return false;
      hit.point.set(0, 0, 0); hit.localPoint.set(0, 0, 0);
      hit.normal.set(1, 0, 0); hit.surfaceVelocity.set(0, 0, 0);
      return true;
    },
    clearance: () => true,
    avoidance: () => false,
  };
  let contacts = 0;
  flight.onImpact = () => { contacts += 1; };
  flight.update(FLIGHT.fixedStep, neutral);
  const separatedSpeed = flight.controlVelocity.x;
  for (let step = 0; step < 30; step += 1) flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(separatedSpeed, DEFAULT_FLIGHT_TUNING.collisionSeparationSpeed);
  assert.ok(flight.controlVelocity.x <= separatedSpeed + 1e-9);
  assert.equal(contacts, 1, 'a continuous scrape is one contact manifold');
});

test('collision results are independent of 30, 60, and 120 FPS render cadence', () => {
  const run = (fps: number): number[] => {
    const flight = new FlightController(openTerrain);
    flight.takeManualControl();
    flight.configure({ ...DEFAULT_FLIGHT_TUNING, normalAcceleration: 0, normalGrip: 0 });
    flight.speed = Math.hypot(10, 20);
    flight.controlVelocity.set(-10, 0, 20);
    let collisionPending = true;
    flight.obstacles = {
      sweepShip: (_from, _to, _fromQ, _toQ, _cockpit, hit) => {
        if (!collisionPending || !hit) return false;
        collisionPending = false;
        hit.point.set(0, 0, 0); hit.localPoint.set(0, 0, 0);
        hit.normal.set(1, 0, 0); hit.surfaceVelocity.set(0, 0, 0);
        return true;
      },
      clearance: () => true,
      avoidance: () => false,
    };
    let accumulator = 0;
    for (let frame = 0; frame < fps; frame += 1) {
      accumulator += 1 / fps;
      while (accumulator + 1e-12 >= FLIGHT.fixedStep) {
        flight.update(FLIGHT.fixedStep, neutral);
        accumulator -= FLIGHT.fixedStep;
      }
    }
    return [...flight.position.toArray(), ...flight.controlVelocity.toArray()];
  };
  const at120 = run(120);
  for (const fps of [30, 60]) {
    const result = run(fps);
    result.forEach((value, index) => assert.ok(Math.abs(value - at120[index]) < 1e-9));
  }
});

test('route progress requires sustained reverse travel and clears after forward recovery', () => {
  const progress = new RouteProgress();
  progress.reset(0);
  for (let step = 0; step < 89; step += 1) progress.update(1 / 120, -(step + 1) / 12, true, 0.75);
  assert.equal(progress.wrongWay, false);
  progress.update(1 / 120, -90 / 12, true, 0.75);
  assert.equal(progress.wrongWay, true);
  for (let step = 0; step < 29; step += 1) progress.update(1 / 120, -7.5 + (step + 1) / 12, true, 0.75);
  assert.equal(progress.wrongWay, true);
  progress.update(1 / 120, -5, true, 0.75);
  assert.equal(progress.wrongWay, false);
  progress.update(1, -100, false, 0.75);
  assert.equal(progress.wrongWay, false);
});

function impact(dissipatedSpeed: number): FlightImpactSnapshot {
  return {
    point: new Vector3(2, 3, 4), localPoint: new Vector3(), normal: new Vector3(0, 1, 0),
    surfaceVelocity: new Vector3(), relativeVelocityBefore: new Vector3(),
    relativeVelocityAfter: new Vector3(), tangentialDirection: new Vector3(1, 0, 0),
    normalSpeed: dissipatedSpeed, tangentialSpeed: dissipatedSpeed,
    dissipatedEnergy: dissipatedSpeed * dissipatedSpeed / 2, dissipatedSpeed,
    severity: Math.min(1, dissipatedSpeed / 80), source: 'terrain', initialContact: true,
  };
}

test('collision sparks scale with energy, remain bounded, freeze, and rebase', () => {
  const sparks = new CollisionSparkView();
  sparks.configure(DEFAULT_FLIGHT_TUNING);
  assert.equal(sparks.emit(impact(0), new Vector3()), 0);
  const slow = sparks.emit(impact(4), new Vector3());
  const fast = sparks.emit(impact(40), new Vector3());
  assert.ok(fast > slow);
  for (let index = 0; index < 30; index += 1) sparks.emit(impact(100), new Vector3());
  const camera = new PerspectiveCamera();
  camera.quaternion.copy(new Quaternion());
  sparks.update(0, camera, true);
  assert.ok(sparks.activeCount <= sparks.capacity);
  const active = sparks.activeCount;
  sparks.applyOriginShift(new Vector3(128, 0, 128));
  sparks.update(10, camera, true);
  assert.equal(sparks.activeCount, active, 'paused sparks do not age');
  sparks.update(10, camera, false);
  assert.equal(sparks.activeCount, 0);
  for (let frame = 0; frame < 60 * 60; frame += 1) {
    sparks.emit(impact(60), new Vector3());
    sparks.update(1 / 60, camera, false);
    assert.ok(sparks.activeCount <= sparks.capacity);
  }
  sparks.dispose();
});

test('HUD route arrow reports camera-relative forward, side, and backward directions', () => {
  const camera = new PerspectiveCamera(55, 16 / 9, 0.1, 1000);
  const plane = new Vector3();
  const forward = routeArrowOrientation(camera, plane, new Vector3(0, 0, -160));
  assert.ok(Math.abs(forward.heading) < 1e-10);
  assert.ok(Math.abs(forward.elevation) < 1e-10);
  const right = routeArrowOrientation(camera, plane, new Vector3(160, 0, -160));
  assert.ok(right.heading > 0.7 && right.heading < 0.9);
  const behind = routeArrowOrientation(camera, plane, new Vector3(0, 0, 160));
  assert.ok(Math.abs(Math.abs(behind.heading) - Math.PI) < 1e-10);

  camera.fov = 82; camera.updateProjectionMatrix();
  const afterFov = routeArrowOrientation(camera, plane, new Vector3(160, 0, -160));
  assert.equal(afterFov.heading, right.heading, 'screen direction does not depend on FOV');

  camera.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  const cameraForward = routeArrowOrientation(camera, plane, new Vector3(0, 0, 160));
  assert.ok(Math.abs(cameraForward.heading) < 1e-10, 'forward depth means the route is aligned with the camera');
});

test('HUD route arrow writes its first angle and responds to later direction changes', () => {
  assert.equal(navigationAngleChanged(0, Number.NaN), true);
  assert.equal(navigationAngleChanged(0, 0), false);
  assert.equal(navigationAngleChanged(0.4, 0), true);
  assert.equal(navigationAngleChanged(-0.4, 0.4), true);
});

test('HUD route arrow builds four finite quadrangular-pyramid faces from tunable dimensions', () => {
  const compact = navigationArrowGeometry(22, 7, 12);
  const wide = navigationArrowGeometry(30, 10, 20);
  assert.equal(compact.tipDepth, -22);
  assert.equal(compact.faces.length, 4);
  assert.ok(wide.armLength > compact.armLength);
  for (const face of wide.faces) {
    assert.ok(face.width > 0 && face.height > 0);
    assert.match(face.matrix, /^matrix3d\([\d.,-]+\)$/);
    assert.doesNotMatch(face.matrix, /NaN|Infinity/);
  }
});

test('drift meter is a screen-centered, three-part symmetric annular sector', () => {
  const geometry = createDriftMeterGeometry(32, 1.5);
  assert.equal(geometry.segments.length, 3);
  assert.equal(DRIFT_METER_CENTER, 50);
  assert.equal(DRIFT_METER_OUTER_RADIUS, 50);
  assert.equal(driftMeterPoint(DRIFT_METER_OUTER_RADIUS, 0).x, 100,
    '50vw SVG places the outer edge at 75vw');
  assert.ok(Math.abs(geometry.segments[0].startDegrees + geometry.segments[2].endDegrees) < 1e-12);
  assert.ok(Math.abs(geometry.segments[0].endDegrees - geometry.segments[1].startDegrees) < 1e-12);
  assert.ok(Math.abs(geometry.segments[1].endDegrees - geometry.segments[2].startDegrees) < 1e-12);
  const arcLengthVw = geometry.centerRadius * 0.5 * geometry.sweepDegrees * Math.PI / 180;
  assert.ok(Math.abs(arcLengthVw - 32) < 1e-10);
  const firstCenterPoint = driftMeterPoint(
    geometry.centerRadius,
    geometry.segments[0].startDegrees,
  );
  assert.ok(geometry.segments[0].progressPath.startsWith(
    `M ${firstCenterPoint.x.toFixed(3)} ${firstCenterPoint.y.toFixed(3)}`,
  ), 'fill starts exactly at the radial cut without an inset gap');
  for (const degrees of [12, geometry.sweepDegrees * 0.5]) {
    const top = driftMeterPoint(DRIFT_METER_OUTER_RADIUS, -degrees);
    const bottom = driftMeterPoint(DRIFT_METER_OUTER_RADIUS, degrees);
    assert.ok(Math.abs(top.x - bottom.x) < 1e-12);
    assert.ok(Math.abs(top.y + bottom.y - 100) < 1e-12);
  }
});

test('drift meter arc length and radial thickness controls change independent dimensions', () => {
  const shortThin = createDriftMeterGeometry(20, 1);
  const longThin = createDriftMeterGeometry(44, 1);
  const shortThick = createDriftMeterGeometry(20, 4);
  assert.ok(longThin.sweepDegrees > shortThin.sweepDegrees);
  assert.equal(longThin.radialThickness, shortThin.radialThickness);
  assert.ok(shortThick.radialThickness > shortThin.radialThickness);
  assert.equal(shortThick.segments.length, 3);
});
