import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  NoBlending,
  PointLight,
  Quaternion,
  Scene,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { refractionOutput } from '../render/RefractionShader.ts';
import type { PulseCannonSystem } from './PulseCannonSystem.ts';
import type { RefractionContributor } from './types.ts';

const ARC_COUNT = 8;
const ARC_SEGMENTS = 16;
const BEAM_SIDES = 16;
const BEAM_RINGS = 24;
const BOOSTER_BASE_RADIUS = 0.62;
const BOOSTER_MAX_ENVELOPE = 2.36683;
const Z_AXIS = new Vector3(0, 0, 1);

function boosterEnvelope(t: number): number {
  const normalized = Math.max(0, Math.min(1, t));
  return Math.pow(Math.max(0, 1 - normalized), 0.72)
    * (1 + 2.5 * Math.sin(normalized * Math.PI));
}

function stringHash(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random01(seed: number, shot: number, arc: number, point: number): number {
  let value = seed ^ Math.imul(shot + 1, 0x9e3779b1)
    ^ Math.imul(arc + 1, 0x85ebca6b) ^ Math.imul(point + 1, 0xc2b2ae35);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return (value >>> 0) / 0x100000000;
}

/** One forward-facing booster plume, one electric batch, and one glass mask. */
export class PulseCannonView implements RefractionContributor {
  readonly group = new Group();
  readonly scene = new Scene();
  readonly plasma: Mesh<BufferGeometry, ShaderMaterial>;
  readonly electric: LineSegments<BufferGeometry, LineBasicMaterial>;
  readonly glass: Mesh<BufferGeometry, ShaderMaterial>;
  readonly glassDebug: Mesh<BufferGeometry, ShaderMaterial>;
  readonly beamLight = new PointLight('#9ffcff', 0, 180, 1.35);
  readonly electricLight = new PointLight('#6fe9ff', 0, 90, 1.5);
  readonly beamLightWorldPosition = new Vector3();
  readonly electricLightWorldPosition = new Vector3();
  private readonly beamGeometry = new CylinderGeometry(
    BOOSTER_BASE_RADIUS,
    BOOSTER_BASE_RADIUS,
    1,
    BEAM_SIDES,
    BEAM_RINGS,
    true,
  );
  private readonly electricPositions = new BufferAttribute(
    new Float32Array(ARC_COUNT * ARC_SEGMENTS * 2 * 3),
    3,
  ).setUsage(DynamicDrawUsage);
  private readonly rotation = new Quaternion();
  private readonly direction = new Vector3();
  private readonly start = new Vector3();
  private readonly worldStart = new Vector3();
  private readonly axisX = new Vector3();
  private readonly axisY = new Vector3();
  private readonly arcColor = new Color();
  private readonly arcTarget = new Color('#38cfff');
  private readonly seed: number;
  readonly system: PulseCannonSystem;
  private visualRadius = 0;
  private glassVisualRadius = 0;
  private visualLength = 0;
  private plasmaDebug = false;
  private electricDebug = false;
  private disposed = false;

  constructor(system: PulseCannonSystem, seed: string) {
    this.system = system;
    this.seed = stringHash(`${seed}:pulse-cannon`);
    this.beamGeometry.rotateX(Math.PI / 2);
    const vertex = `
      uniform float uPower,uLength,uFlowDistance,uFlutterTime,uFlutter,uShellScale;
      varying vec2 vUv;
      varying vec3 vView,vNormal;
      void main(){
        vUv=uv;
        float t=1.0-uv.y;
        float angle=uv.x*6.283185;
        float flutter=min(1.0,uFlutter*.65);
        float downstream=t*uLength-uFlowDistance;
        float turbulence=sin(angle*3.0+downstream*.45)
          *sin(angle*2.0+uFlutterTime*12.0);
        float tongue=.82+.18*sin(angle*5.0+uFlutterTime*8.0);
        float envelope=pow(max(0.0,1.0-t),.72)*(1.0+2.5*sin(t*3.14159));
        vec3 p=position;
        p.xy*=envelope*(1.0+flutter*.35*turbulence)
          *(.8+uPower*.35)*uShellScale;
        p.z=t*uLength*mix(1.0,tongue,flutter);
        vec4 view=modelViewMatrix*vec4(p,1.0);
        vView=view.xyz;
        vNormal=normalize(normalMatrix*normal);
        gl_Position=projectionMatrix*view;
      }`;
    this.plasma = new Mesh(
      this.beamGeometry,
      new ShaderMaterial({
        uniforms: {
          uPower: { value: 0 },
          uLength: { value: 0 },
          uFlowDistance: { value: 0 },
          uFlutterTime: { value: 0 },
          uFlutter: { value: 0.35 },
          uShellScale: { value: 1 },
          uBrightness: { value: 1.35 },
          uColor: { value: new Color('#9ffcff') },
          uDebug: { value: 0 },
        },
        vertexShader: vertex,
        fragmentShader: `
          uniform float uFlowDistance,uFlutterTime,uLength,uPower,uFlutter,uBrightness,uDebug;
          uniform vec3 uColor;
          varying vec2 vUv;
          varying vec3 vView,vNormal;
          void main(){
            vec3 normal=normalize(vNormal);
            if(uDebug>.5){float light=.3+.7*abs(dot(normal,normalize(vec3(.4,.8,.5))));gl_FragColor=vec4(uColor*light,1.0);return;}
            float t=1.0-vUv.y;
            float facing=abs(dot(normal,normalize(-vView)));
            float core=pow(facing,3.0)*(1.0-smoothstep(.1,.75,t));
            float angle=vUv.x*6.283185;
            float downstream=t*uLength-uFlowDistance;
            float turbulence=sin(angle*5.0+downstream*.8)
              *sin(angle*3.0+downstream*.46+uFlutterTime*13.0);
            float flutter=min(1.0,uFlutter*.65);
            float tip=.76+.2*sin(angle*4.0+uFlutterTime*7.0)+flutter*.08*turbulence;
            float tongues=1.0-smoothstep(tip-.2,tip,t);
            float tail=pow(1.0-t,.85)*smoothstep(0.0,.035,t)*tongues;
            float fire=.78+flutter*.22*turbulence;
            float alpha=tail*uPower*uBrightness*(.34+facing*.55)*fire;
            gl_FragColor=vec4(mix(uColor*1.25,vec3(2.2),core),alpha);
            #include <colorspace_fragment>
          }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.plasma.frustumCulled = false;
    this.plasma.renderOrder = 9;

    const electricGeometry = new BufferGeometry();
    electricGeometry.setAttribute('position', this.electricPositions);
    electricGeometry.setDrawRange(0, 0);
    this.electric = new LineSegments(
      electricGeometry,
      new LineBasicMaterial({
        color: '#6fe9ff',
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.electric.frustumCulled = false;
    this.electric.renderOrder = 10;

    const glassUniforms = {
      uPower: { value: 0 },
      uLength: { value: 0 },
      uFlowDistance: { value: 0 },
      uFlutterTime: { value: 0 },
      uFlutter: { value: 0.35 },
      uShellScale: { value: 1 },
      tDepth: { value: null as Texture | null },
      uResolution: { value: new Vector2() },
      uRefraction: { value: 1.2 },
      uDispersion: { value: 0.3 },
      uSheen: { value: 0.035 },
      uDebug: { value: 0 },
      uColor: { value: new Color('#9ffcff') },
    };
    this.glass = new Mesh(
      this.beamGeometry,
      new ShaderMaterial({
        uniforms: glassUniforms,
        vertexShader: vertex,
        fragmentShader: `
          uniform float uDebug,uPower;
          uniform sampler2D tDepth;
          uniform vec2 uResolution;
          varying vec2 vUv;
          varying vec3 vView;
          ${refractionOutput}
          void main(){
            if(uDebug>.5||uPower<.001)discard;
            if(gl_FragCoord.z>texture2D(tDepth,gl_FragCoord.xy/uResolution).r+.000001)discard;
            vec3 n=normalize(cross(dFdx(vView),dFdy(vView)));
            if(!gl_FrontFacing)n=-n;
            float t=1.0-vUv.y;
            float coverage=pow(1.0-t,1.2)*smoothstep(0.0,.04,t)*min(1.0,uPower);
            if(coverage<.001)discard;
            float grazing=pow(1.0-abs(dot(n,normalize(-vView))),2.0);
            gl_FragColor=glassVector(n,coverage,grazing);
          }`,
        side: DoubleSide,
        blending: NoBlending,
        depthWrite: true,
      }),
    );
    this.glassDebug = new Mesh(
      this.beamGeometry,
      new ShaderMaterial({
        uniforms: glassUniforms,
        vertexShader: vertex,
        fragmentShader: `uniform vec3 uColor;varying vec3 vView;void main(){vec3 n=normalize(cross(dFdx(vView),dFdy(vView)));float light=.3+.7*abs(dot(n,normalize(vec3(.4,.8,.5))));gl_FragColor=vec4(mix(uColor,vec3(1.0,.35,.1),.55)*light,1.0);}`,
        side: DoubleSide,
        depthWrite: true,
      }),
    );
    this.glass.frustumCulled = false;
    this.glassDebug.frustumCulled = false;
    this.glassDebug.renderOrder = 11;
    this.beamLight.name = 'Pulse beam illumination';
    this.electricLight.name = 'Pulse electric-front illumination';
    this.group.add(this.plasma, this.electric, this.glassDebug, this.beamLight, this.electricLight);
    this.scene.add(this.glass);
    this.hide();
  }

  sync(origin: Vector3): void {
    const shot = this.system.shot;
    const settings = this.system.settings;
    const live = this.system.visualActive;
    const debugPreview = shot.id > 0 && (
      settings.pulsePlasmaDebug || settings.pulseGlassDebug || settings.pulseElectricDebug
    );
    if (this.disposed || (!live && !debugPreview)) {
      this.hide();
      return;
    }
    const progress = Math.min(1, shot.age / Math.max(1e-6, shot.duration));
    const power = live ? Math.pow(1 - progress, settings.pulseFadePower) : 1;
    // The inner plasma radius is an independent visual control. Normalize the
    // booster-style envelope so its widest animated point matches that radius.
    this.visualRadius = settings.pulsePlasmaRadius;
    this.glassVisualRadius = this.visualRadius * settings.pulseGlassWidth;
    this.worldStart.copy(shot.visualStart);
    this.start.copy(this.worldStart).sub(origin);
    this.direction.subVectors(shot.visualEnd, shot.visualStart);
    this.visualLength = this.direction.length();
    if (!Number.isFinite(this.visualLength) || this.visualLength < 1e-6) {
      this.direction.copy(shot.direction);
      this.visualLength = 0;
    } else {
      this.direction.multiplyScalar(1 / this.visualLength);
    }
    this.rotation.setFromUnitVectors(Z_AXIS, this.direction);
    this.syncMeshTransforms();
    this.updateDebugModes(settings.pulsePlasmaDebug, settings.pulseElectricDebug);
    this.plasma.visible = live
      ? settings.pulseBrightness > 0 || settings.pulsePlasmaDebug
      : settings.pulsePlasmaDebug;
    this.glass.visible = live && !settings.pulseGlassDebug
      && (settings.pulseRefraction > 0 || settings.pulseDispersion > 0);
    this.glassDebug.visible = settings.pulseGlassDebug;

    const phaseDistance = shot.age * 55 * settings.pulseFlutterRate;
    const phaseTime = shot.age * settings.pulseFlutterRate;
    const plasma = this.plasma.material.uniforms;
    plasma.uPower.value = power;
    plasma.uLength.value = this.visualLength;
    plasma.uFlowDistance.value = phaseDistance;
    plasma.uFlutterTime.value = phaseTime;
    plasma.uFlutter.value = settings.pulseFlutter;
    const flutterWidth = 1 + Math.min(1, settings.pulseFlutter * 0.65) * 0.35;
    const powerWidth = 0.8 + power * 0.35;
    plasma.uShellScale.value = this.visualRadius
      / (BOOSTER_BASE_RADIUS * BOOSTER_MAX_ENVELOPE * flutterWidth * powerWidth);
    plasma.uBrightness.value = settings.pulseBrightness;
    plasma.uColor.value.set(settings.pulseColor);
    plasma.uDebug.value = settings.pulsePlasmaDebug ? 1 : 0;

    const glassLength = this.visualLength * settings.pulseGlassLength;
    const glass = this.glass.material.uniforms;
    glass.uPower.value = power;
    glass.uLength.value = glassLength;
    glass.uFlowDistance.value = phaseDistance;
    glass.uFlutterTime.value = phaseTime;
    glass.uFlutter.value = settings.pulseFlutter;
    glass.uShellScale.value = this.glassVisualRadius
      / (BOOSTER_BASE_RADIUS * BOOSTER_MAX_ENVELOPE * flutterWidth * powerWidth);
    glass.uRefraction.value = settings.pulseRefraction;
    glass.uDispersion.value = settings.pulseDispersion;
    glass.uDebug.value = settings.pulseGlassDebug ? 1 : 0;
    glass.uColor.value.set(settings.pulseColor);

    this.syncElectric(
      glassLength,
      this.glassVisualRadius * settings.pulseElectricSpread,
      power,
      live ? settings.pulseElectricStrength : (settings.pulseElectricDebug ? 1 : 0),
      shot.id,
      live ? shot.age : 1,
      live ? settings.pulseElectricTravelTime : 1,
      live ? settings.pulseElectricTrail : 1,
    );
    this.syncLights(origin, glassLength, power, live);
  }

  private syncMeshTransforms(): void {
    for (const mesh of [this.plasma, this.glass, this.glassDebug]) {
      mesh.position.copy(this.start);
      mesh.quaternion.copy(this.rotation);
      mesh.updateMatrixWorld();
    }
  }

  private syncLights(origin: Vector3, length: number, power: number, live: boolean): void {
    const settings = this.system.settings;
    this.beamLightWorldPosition.copy(this.worldStart).addScaledVector(this.direction, length * 0.35);
    this.beamLight.position.copy(this.beamLightWorldPosition).sub(origin);
    this.beamLight.color.set(settings.pulseBeamLightColor);
    this.beamLight.distance = settings.pulseBeamLightRange;
    this.beamLight.intensity = live && length > 0 ? settings.pulseBeamLightIntensity * power : 0;

    const electricHead = Math.min(1, this.system.shot.age / Math.max(1e-6, settings.pulseElectricTravelTime));
    const electricDistance = electricHead * length;
    this.electricLightWorldPosition.copy(this.worldStart).addScaledVector(this.direction, electricDistance);
    this.electricLight.position.copy(this.electricLightWorldPosition).sub(origin);
    this.electricLight.color.set(settings.pulseElectricLightColor);
    this.electricLight.distance = settings.pulseElectricLightRange;
    const electricVisible = live && settings.pulseElectricStrength > 0
      && this.system.shot.age <= settings.pulseElectricTravelTime * (1 + settings.pulseElectricTrail);
    this.electricLight.intensity = electricVisible
      ? settings.pulseElectricLightIntensity * power * Math.min(1, settings.pulseElectricStrength)
      : 0;
  }

  private updateDebugModes(plasmaDebug: boolean, electricDebug: boolean): void {
    if (plasmaDebug !== this.plasmaDebug) {
      this.plasmaDebug = plasmaDebug;
      const material = this.plasma.material;
      material.transparent = !plasmaDebug;
      material.blending = plasmaDebug ? NoBlending : AdditiveBlending;
      material.depthTest = plasmaDebug;
      material.depthWrite = plasmaDebug;
      material.needsUpdate = true;
    }
    if (electricDebug !== this.electricDebug) {
      this.electricDebug = electricDebug;
      const material = this.electric.material;
      material.transparent = !electricDebug;
      material.blending = electricDebug ? NoBlending : AdditiveBlending;
      material.depthTest = electricDebug;
      material.depthWrite = electricDebug;
      material.needsUpdate = true;
    }
  }

  private syncElectric(
    length: number,
    spreadRadius: number,
    power: number,
    strength: number,
    shotId: number,
    age: number,
    travelTime: number,
    trailLength: number,
  ): void {
    const material = this.electric.material;
    if (strength <= 0 || power <= 0) {
      this.electric.geometry.setDrawRange(0, 0);
      this.electric.visible = false;
      material.opacity = 0;
      return;
    }
    this.axisX.set(0, 1, 0).cross(this.direction);
    if (this.axisX.lengthSq() < 1e-8) this.axisX.set(1, 0, 0);
    else this.axisX.normalize();
    this.axisY.crossVectors(this.direction, this.axisX).normalize();
    const travelHead = age / Math.max(1e-6, travelTime);
    const head = Math.min(1, travelHead);
    const tail = Math.max(0, travelHead - trailLength);
    let vertex = 0;
    for (let arc = 0; arc < ARC_COUNT; arc += 1) {
      for (let segment = 0; segment < ARC_SEGMENTS; segment += 1) {
        const segmentStart = segment / ARC_SEGMENTS;
        const segmentEnd = (segment + 1) / ARC_SEGMENTS;
        if (segmentEnd < tail || segmentStart > head) continue;
        for (let endpoint = 0; endpoint < 2; endpoint += 1) {
          const point = segment + endpoint;
          const t = point / ARC_SEGMENTS;
          const envelope = boosterEnvelope(t) / BOOSTER_MAX_ENVELOPE * spreadRadius
            * (1 + random01(this.seed, shotId, arc, 91) * 0.18);
          const angle = random01(this.seed, shotId, arc, point) * Math.PI * 2
            + arc / ARC_COUNT * Math.PI * 2;
          const offsetX = Math.cos(angle) * envelope;
          const offsetY = Math.sin(angle) * envelope;
          this.electricPositions.setXYZ(
            vertex,
            this.start.x + this.direction.x * length * t + this.axisX.x * offsetX + this.axisY.x * offsetY,
            this.start.y + this.direction.y * length * t + this.axisX.y * offsetX + this.axisY.y * offsetY,
            this.start.z + this.direction.z * length * t + this.axisX.z * offsetX + this.axisY.z * offsetY,
          );
          vertex += 1;
        }
      }
    }
    this.electricPositions.clearUpdateRanges();
    this.electricPositions.addUpdateRange(0, vertex * 3);
    this.electricPositions.needsUpdate = true;
    this.electric.geometry.setDrawRange(0, vertex);
    this.electric.visible = vertex > 0;
    material.color.copy(this.arcColor.set(this.system.settings.pulseColor).lerp(this.arcTarget, 0.55));
    material.opacity = this.electricDebug ? 1 : Math.min(1, power * strength * 0.8);
  }

  private hide(): void {
    this.plasma.visible = false;
    this.electric.visible = false;
    this.glass.visible = false;
    this.glassDebug.visible = false;
    this.beamLight.intensity = 0;
    this.electricLight.intensity = 0;
    this.electric.geometry.setDrawRange(0, 0);
  }

  /** Compile normally dormant Pulse materials during loading, not on first fire. */
  prewarm(renderer: WebGLRenderer, mainScene: Scene, camera: Camera): void {
    if (this.disposed) return;
    this.plasma.visible = true;
    this.electric.visible = true;
    this.glassDebug.visible = true;
    this.glass.visible = true;
    renderer.compile(mainScene, camera);
    renderer.compile(this.scene, camera);
    this.hide();
  }

  get active(): boolean {
    return !this.disposed && this.system.visualActive && !this.system.settings.pulseGlassDebug
      && (this.system.settings.pulseRefraction > 0 || this.system.settings.pulseDispersion > 0);
  }

  get plasmaVisualRadius(): number { return this.visualRadius; }
  get glassRadius(): number { return this.glassVisualRadius; }
  get currentVisualLength(): number { return this.visualLength; }

  prepare(depth: Texture, width: number, height: number): void {
    const uniforms = this.glass.material.uniforms;
    uniforms.tDepth.value = depth;
    uniforms.uResolution.value.set(width, height);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.beamGeometry.dispose();
    this.plasma.material.dispose();
    this.electric.geometry.dispose();
    this.electric.material.dispose();
    this.glass.material.dispose();
    this.glassDebug.material.dispose();
    this.group.removeFromParent();
    this.scene.clear();
  }
}

export const PULSE_VIEW_COMPLEXITY = Object.freeze({
  plasmaDrawCalls: 1,
  electricDrawCalls: 1,
  refractionDrawCalls: 1,
  arcCount: ARC_COUNT,
  arcSegments: ARC_SEGMENTS,
  beamSides: BEAM_SIDES,
  beamRings: BEAM_RINGS,
});
