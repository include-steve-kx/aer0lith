import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  FrontSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  NoBlending,
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
const BEAM_SIDES = 12;
const Z_AXIS = new Vector3(0, 0, 1);

function beamGeometry(includeCore: boolean): BufferGeometry {
  const positions: number[] = [];
  const layers: number[] = [];
  const rings = [
    [0, 0.05],
    [0.04, 0.55],
    [0.125, 1],
    [0.5, 1],
    [0.875, 1],
    [0.96, 0.55],
    [1, 0.05],
  ] as const;
  const addVertex = (z: number, radius: number, side: number, layer: number): void => {
    const angle = side / BEAM_SIDES * Math.PI * 2;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, z);
    layers.push(layer);
  };
  const addShell = (scale: number, layer: number): void => {
    for (let ring = 0; ring < rings.length - 1; ring += 1) {
      const [za, ra] = rings[ring];
      const [zb, rb] = rings[ring + 1];
      for (let side = 0; side < BEAM_SIDES; side += 1) {
        const next = (side + 1) % BEAM_SIDES;
        addVertex(za, ra * scale, side, layer);
        addVertex(za, ra * scale, next, layer);
        addVertex(zb, rb * scale, next, layer);
        addVertex(za, ra * scale, side, layer);
        addVertex(zb, rb * scale, next, layer);
        addVertex(zb, rb * scale, side, layer);
      }
    }
  };
  addShell(1, 0);
  if (includeCore) addShell(0.06, 1);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('aLayer', new BufferAttribute(new Float32Array(layers), 1));
  return geometry;
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

/** Three fixed draw resources: plasma shell/core, electric lines, and glass mask. */
export class PulseCannonView implements RefractionContributor {
  readonly group = new Group();
  readonly scene = new Scene();
  readonly plasma: Mesh<BufferGeometry, ShaderMaterial>;
  readonly electric: LineSegments<BufferGeometry, LineBasicMaterial>;
  readonly glass: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly electricPositions = new BufferAttribute(
    new Float32Array(ARC_COUNT * ARC_SEGMENTS * 2 * 3),
    3,
  ).setUsage(DynamicDrawUsage);
  private readonly rotation = new Quaternion();
  private readonly direction = new Vector3();
  private readonly start = new Vector3();
  private readonly axisX = new Vector3();
  private readonly axisY = new Vector3();
  private readonly arcColor = new Color();
  private readonly arcTarget = new Color('#38cfff');
  private readonly seed: number;
  readonly system: PulseCannonSystem;
  private disposed = false;

  constructor(system: PulseCannonSystem, seed: string) {
    this.system = system;
    this.seed = stringHash(`${seed}:pulse-cannon`);
    const vertex = `attribute float aLayer;uniform float uTime;varying float vLayer;varying vec3 vLocal;
      void main(){vLayer=aLayer;vLocal=position;vec3 p=position;float flame=(1.0-aLayer)*(.035*sin(position.z*31.0+uTime*42.0+position.x*9.0)+.02*sin(position.z*73.0-uTime*27.0));p.xy*=1.0+flame;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`;
    this.plasma = new Mesh(
      beamGeometry(true),
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPower: { value: 0 },
          uColor: { value: new Color('#9ffcff') },
        },
        vertexShader: vertex,
        fragmentShader: `uniform vec3 uColor;uniform float uPower;varying float vLayer;varying vec3 vLocal;
          void main(){float edge=pow(max(0.0,1.0-abs(vLocal.z-.5)*1.85),.22);vec3 color=mix(uColor,vec3(1.0),vLayer);float alpha=uPower*edge*mix(.035,.5,vLayer);gl_FragColor=vec4(color,alpha);}`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: FrontSide,
        blending: AdditiveBlending,
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

    this.glass = new Mesh(
      beamGeometry(false),
      new ShaderMaterial({
        uniforms: {
          tDepth: { value: null },
          uResolution: { value: new Vector2() },
          uRefraction: { value: 1.2 },
          uDispersion: { value: 0.3 },
          uSheen: { value: 0.035 },
          uPower: { value: 0 },
        },
        vertexShader: `varying vec3 vView;void main(){vec4 view=modelViewMatrix*vec4(position,1.0);vView=view.xyz;gl_Position=projectionMatrix*view;}`,
        fragmentShader: `uniform sampler2D tDepth;uniform vec2 uResolution;uniform float uPower;varying vec3 vView;${refractionOutput}
          void main(){if(uPower<.001)discard;if(gl_FragCoord.z>texture2D(tDepth,gl_FragCoord.xy/uResolution).r+.000001)discard;vec3 n=normalize(cross(dFdx(vView),dFdy(vView)));if(!gl_FrontFacing)n=-n;float grazing=1.0-abs(dot(n,normalize(-vView)));gl_FragColor=glassVector(n,uPower,grazing);}`,
        side: DoubleSide,
        blending: NoBlending,
        depthWrite: true,
      }),
    );
    this.glass.frustumCulled = false;
    this.group.add(this.plasma, this.electric);
    this.scene.add(this.glass);
    this.hide();
  }

  sync(origin: Vector3): void {
    const shot = this.system.shot;
    if (this.disposed || !this.system.visualActive) {
      this.hide();
      return;
    }
    const settings = this.system.settings;
    const length = shot.visualStart.distanceTo(shot.visualEnd);
    const progress = Math.min(1, shot.age / Math.max(1e-6, shot.duration));
    const power = Math.max(0.75, Math.sin(Math.PI * Math.min(1, progress * 1.15)))
      * (1 - progress * progress);
    this.start.copy(shot.visualStart).sub(origin);
    this.direction.copy(shot.direction);
    this.rotation.setFromUnitVectors(Z_AXIS, this.direction);
    this.plasma.visible = this.glass.visible = true;
    this.plasma.position.copy(this.start);
    this.glass.position.copy(this.start);
    this.plasma.quaternion.copy(this.rotation);
    this.glass.quaternion.copy(this.rotation);
    this.plasma.scale.set(shot.radius, shot.radius, length);
    this.glass.scale.copy(this.plasma.scale);
    this.plasma.updateMatrixWorld();
    this.glass.updateMatrixWorld();
    const plasma = this.plasma.material.uniforms;
    plasma.uTime.value = shot.age;
    plasma.uPower.value = power;
    plasma.uColor.value.set(settings.pulseColor);
    const glass = this.glass.material.uniforms;
    glass.uPower.value = power;
    glass.uRefraction.value = settings.pulseRefraction;
    glass.uDispersion.value = settings.pulseDispersion;
    this.syncElectric(length, shot.radius, power, settings.pulseElectricStrength, shot.id, shot.age);
  }

  private syncElectric(
    length: number,
    radius: number,
    power: number,
    strength: number,
    shotId: number,
    age: number,
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
    let vertex = 0;
    for (let arc = 0; arc < ARC_COUNT; arc += 1) {
      for (let segment = 0; segment < ARC_SEGMENTS; segment += 1) {
        for (let endpoint = 0; endpoint < 2; endpoint += 1) {
          const point = segment + endpoint;
          const t = point / ARC_SEGMENTS;
          const envelope = Math.sin(Math.PI * t) * radius * (0.58 + random01(this.seed, shotId, arc, 91) * 0.25);
          const angle = random01(this.seed, shotId, arc, point) * Math.PI * 2
            + arc / ARC_COUNT * Math.PI * 2 + age * (5 + arc * 0.27);
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
    this.electric.visible = true;
    material.color.copy(this.arcColor.set(this.system.settings.pulseColor).lerp(this.arcTarget, 0.55));
    material.opacity = Math.min(1, power * strength * 0.8);
  }

  private hide(): void {
    this.plasma.visible = false;
    this.electric.visible = false;
    this.glass.visible = false;
    this.electric.geometry.setDrawRange(0, 0);
  }

  /** Compile normally dormant Pulse materials during loading, not on first fire. */
  prewarm(renderer: WebGLRenderer, mainScene: Scene, camera: Camera): void {
    if (this.disposed) return;
    this.plasma.visible = true;
    this.electric.visible = true;
    this.glass.visible = true;
    renderer.compile(mainScene, camera);
    renderer.compile(this.scene, camera);
    this.hide();
  }

  get active(): boolean {
    return !this.disposed
      && this.system.visualActive
      && (this.system.settings.pulseRefraction > 0 || this.system.settings.pulseDispersion > 0);
  }

  prepare(depth: Texture, width: number, height: number): void {
    const uniforms = this.glass.material.uniforms;
    uniforms.tDepth.value = depth;
    uniforms.uResolution.value.set(width, height);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.plasma.geometry.dispose();
    this.plasma.material.dispose();
    this.electric.geometry.dispose();
    this.electric.material.dispose();
    this.glass.geometry.dispose();
    this.glass.material.dispose();
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
});
