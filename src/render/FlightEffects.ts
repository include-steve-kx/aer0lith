import {
  AdditiveBlending, BufferGeometry, Color, CylinderGeometry, DoubleSide, Group,
  Mesh, NoBlending, PointLight, Quaternion, Scene, ShaderMaterial, Texture, Vector2, Vector3,
} from 'three';
import { refractionOutput } from './RefractionShader.ts';
import { WakeSheetGeometry } from './WakeSheetGeometry.ts';
import type { TrailView } from './TrailView.ts';
import { BoostEnvelope } from './BoostEnvelope.ts';
import type { WingPoseSettings } from '../flight/WingPose.ts';

export interface FlightEffectSettings extends WingPoseSettings {
  boostExhaustEnabled: boolean;
  boostExhaustStrength: number;
  boostIdleAmount: number;
  boostExhaustLength: number;
  boostExhaustWidth: number;
  boostGlassWidth: number;
  boostGlassLength: number;
  boostGlassDebug: boolean;
  boostFadeDuration: number;
  boostExhaustColor: string;
  boostGlassEnabled: boolean;
  boostRefraction: number;
  boostDispersion: number;
  boostFlutter: number;
  boostFlutterRate: number;
  boostFlowRate: number;
  wingWarpEnabled: boolean;
  wingWarpStrength: number;
  wingWarpLength: number;
  wingWarpHeight: number;
  wingWarpThickness: number;
  wingWarpFlutter: number;
  wingWarpFlutterRate: number;
  wingWarpFlowRate: number;
  wingWarpOpacity: number;
  wingWarpDispersion: number;
  wakeDebugEnabled: boolean;
}

export const DEFAULT_FLIGHT_EFFECTS: FlightEffectSettings = {
  boostExhaustEnabled: true, boostExhaustStrength: 2, boostIdleAmount: 0.2,
  wingSweepBack: 28, wingTuckIn: 18, wingFoldSpeed: 1,
  boostExhaustLength: 54, boostExhaustWidth: 0.45,
  boostGlassWidth: 0.55, boostGlassLength: 1, boostGlassDebug: false, boostFadeDuration: 3.6,
  boostExhaustColor: '#8ab7ff', wingWarpEnabled: true, wingWarpStrength: 1.75,
  wingWarpLength: 120, wingWarpHeight: 3.5, wingWarpThickness: 0.08,
  wingWarpFlutter: 0.65, wingWarpFlutterRate: 1, wingWarpFlowRate: 0.5, wingWarpOpacity: 0.045, wingWarpDispersion: 0.12,
  boostGlassEnabled: true, boostRefraction: 0.7, boostDispersion: 0.6,
  boostFlutter: 0.9, boostFlutterRate: 1, boostFlowRate: 1, wakeDebugEnabled: false,
};

/** Pooled meshes/light; animation advances only on simulation time. */
export class FlightEffects {
  readonly group = new Group();
  readonly wakeScene = new Scene();
  readonly wakeGroup = new Group();
  readonly debugGroup = new Group();
  readonly lightColor = new Color('#8cffe0');
  readonly lightPosition = new Vector3();
  readonly burst = new BoostEnvelope();
  private readonly light = new PointLight(this.lightColor, 0, 46, 2);
  private readonly exhaustGroup = new Group();
  private readonly exhaustMaterial: ShaderMaterial;
  private readonly wakeMaterial: ShaderMaterial;
  private readonly boostGlassMaterial: ShaderMaterial;
  private readonly boostGlassGroup = new Group();
  private readonly boostDebugGroup = new Group();
  private readonly debugMaterials: ShaderMaterial[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private elapsed = 0;
  private sideFlowDistance = 0;
  private sideFlutterTime = 0;
  private boostFlowDistance = 0;
  private boostFlutterTime = 0;
  private speed = 55;
  private settings = { ...DEFAULT_FLIGHT_EFFECTS };
  private readonly sheets = [new WakeSheetGeometry(), new WakeSheetGeometry()];
  private pathRevision = -1;
  private readonly pathOrigin = new Vector3(Infinity, 0, 0);
  private shapeDirty = true;
  private cockpit = false;
  private crashed = false;

  constructor() {
    this.group.name = 'boost exhaust and light';
    this.wakeGroup.name = 'extruded wing wake sheets';
    this.group.add(this.exhaustGroup, this.light, this.boostDebugGroup);
    this.light.position.set(0, 0, -6);
    this.wakeScene.add(this.wakeGroup, this.boostGlassGroup);
    this.exhaustMaterial = new ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uLength: { value: 12 },
        uColor: { value: this.lightColor }, uFlowDistance: { value: 0 }, uFlutterTime: { value: 0 },
        uFlutter: { value: 0.45 }, uShellScale: { value: 1 } },
      transparent: true, depthWrite: false, blending: AdditiveBlending,
      side: DoubleSide, toneMapped: false,
      vertexShader: `
        uniform float uTime, uPower, uLength, uFlowDistance, uFlutterTime, uFlutter, uShellScale;
        varying vec2 vUv;
        varying vec3 vView, vNormal;
        void main() {
          vUv = uv;
          float t = 1.0 - uv.y;
          float angle = uv.x * 6.283185;
          // Flutter changes the flame's surface and tongues, never its centerline.
          float flutter = min(1.0, uFlutter * 0.65);
          float downstream = t * uLength - uFlowDistance;
          float turbulence = sin(angle * 3.0 + downstream * 0.45)
            * sin(angle * 2.0 + uFlutterTime * 12.0);
          float tongue = 0.82 + 0.18 * sin(angle * 5.0 + uFlutterTime * 8.0);
          float envelope = pow(max(0.0, 1.0 - t), 0.72) * (1.0 + 2.5 * sin(t * 3.14159));
          vec3 p = position;
          p.xy *= envelope * (1.0 + flutter * 0.35 * turbulence)
            * (0.8 + uPower * 0.35) * uShellScale;
          p.z = -t * uLength * mix(1.0, tongue, flutter);
          vec4 view = modelViewMatrix * vec4(p, 1.0);
          vView = view.xyz;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `
        uniform float uFlowDistance, uFlutterTime, uLength, uPower, uFlutter;
        uniform vec3 uColor;
        varying vec2 vUv;
        varying vec3 vView, vNormal;
        void main() {
          float t = 1.0 - vUv.y;
          float facing = abs(dot(normalize(vNormal), normalize(-vView)));
          float core = pow(facing, 3.0) * (1.0 - smoothstep(0.1, 0.75, t));
          float angle = vUv.x * 6.283185;
          float downstream = t * uLength - uFlowDistance;
          float turbulence = sin(angle * 5.0 + downstream * 0.8)
            * sin(angle * 3.0 + downstream * 0.46 + uFlutterTime * 13.0);
          float flutter = min(1.0, uFlutter * 0.65);
          float tip = 0.76 + 0.2 * sin(angle * 4.0 + uFlutterTime * 7.0)
            + flutter * 0.08 * turbulence;
          float tongues = 1.0 - smoothstep(tip - 0.2, tip, t);
          float tail = pow(1.0 - t, 0.85) * smoothstep(0.0, 0.035, t) * tongues;
          float fire = 0.78 + flutter * 0.22 * turbulence;
          float alpha = tail * uPower * (0.34 + facing * 0.55) * fire;
          gl_FragColor = vec4(mix(uColor * 1.25, vec3(2.2), core), alpha);
          #include <colorspace_fragment>
        }`,
    });
    const exhaustGeometry = new CylinderGeometry(0.62, 0.62, 1, 16, 24, true);
    exhaustGeometry.rotateX(Math.PI / 2);
    this.geometries.push(exhaustGeometry);
    for (const side of [-1, 1]) {
      const plume = new Mesh(exhaustGeometry, this.exhaustMaterial);
      plume.position.set(side * 0.55, 0.03, -3.65);
      plume.frustumCulled = false;
      this.exhaustGroup.add(plume);
    }
    this.boostGlassMaterial = new ShaderMaterial({
      uniforms: { ...this.exhaustMaterial.uniforms, uShellScale: { value: 0.55 }, uLength: { value: 0 }, uPower: { value: 0 },
        uDebug: { value: 0 }, tDepth: { value: null }, uResolution: { value: new Vector2() },
        uRefraction: { value: 1 }, uDispersion: { value: 0.18 }, uSheen: { value: 0.02 } },
      vertexShader: this.exhaustMaterial.vertexShader,
      fragmentShader: `
        uniform float uDebug;
        uniform sampler2D tDepth;
        uniform vec2 uResolution;
        uniform float uPower;
        varying vec2 vUv;
        varying vec3 vView;
        ${refractionOutput}
        void main() {
          if (uDebug > 0.5) discard;
          if (gl_FragCoord.z > texture2D(tDepth, gl_FragCoord.xy / uResolution).r + 0.000001) discard;
          vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
          if (!gl_FrontFacing) n = -n;
          float t = 1.0 - vUv.y;
          float coverage = pow(1.0 - t, 1.2) * smoothstep(0.0, 0.04, t) * min(1.0, uPower);
          if (coverage < 0.001) discard;
          float grazing = pow(1.0 - abs(dot(n, normalize(-vView))), 2.0);
          gl_FragColor = glassVector(n, coverage, grazing);
        }`,
      blending: NoBlending, depthWrite: true, side: DoubleSide,
    });
    const boostDebugMaterial = new ShaderMaterial({
      uniforms: this.boostGlassMaterial.uniforms,
      vertexShader: this.boostGlassMaterial.vertexShader,
      fragmentShader: `
        varying vec3 vView;
        void main() {
          vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
          float light = 0.3 + 0.7 * abs(dot(n, normalize(vec3(0.4, 0.8, 0.5))));
          gl_FragColor = vec4(vec3(1.0, 0.55, 0.15) * light, 1.0);
        }`,
      side: DoubleSide, depthWrite: true,
    });
    this.debugMaterials.push(boostDebugMaterial);
    for (const side of [-1, 1]) {
      const glass = new Mesh(exhaustGeometry, this.boostGlassMaterial);
      glass.position.set(side * 0.55, 0.03, -3.65);
      glass.frustumCulled = false;
      this.boostGlassGroup.add(glass);
      const debug = new Mesh(exhaustGeometry, boostDebugMaterial);
      debug.position.copy(glass.position);
      debug.frustumCulled = false;
      this.boostDebugGroup.add(debug);
    }
    this.wakeMaterial = new ShaderMaterial({
      uniforms: { uFlutterTime: { value: 0 }, uFlowDistance: { value: 0 }, uLength: { value: 120 }, uPower: { value: 0 },
        uFlutter: { value: 0.6 }, uRefraction: { value: 1 },
        uDispersion: { value: 0.12 }, uSheen: { value: 0.045 },
        uDebug: { value: 0 }, tDepth: { value: null }, uResolution: { value: new Vector2(1, 1) } },
      // This pass stores vectors, not color. Never blend or color-convert them.
      blending: NoBlending, depthWrite: true, side: DoubleSide,
      vertexShader: `
        uniform float uFlutterTime, uFlowDistance, uLength, uFlutter;
        varying vec2 vUv;
        varying vec3 vView;
        void main() {
          vUv = uv;
          // In aircraft-relative metres: positive phase travel is rearward.
          float downstream = uv.y * uLength - uFlowDistance;
          float ripple = sin(downstream * 0.45 + uv.x * 5.0)
            * (0.7 + 0.3 * sin(uFlutterTime * 3.2 + uv.x * 6.0))
            + 0.35 * sin(downstream * 0.91 - uv.x * 9.0)
            * cos(uFlutterTime * 1.7 - uv.x * 4.0);
          vec3 p = position + normal * ripple * uFlutter * sin(uv.x * 3.14159)
            * smoothstep(0.0, 0.04, uv.y);
          vec4 view = modelViewMatrix * vec4(p, 1.0);
          vView = view.xyz;
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `
        uniform float uDebug;
        uniform sampler2D tDepth;
        uniform vec2 uResolution;
        uniform float uPower;
        ${refractionOutput}
        varying vec2 vUv;
        varying vec3 vView;
        void main() {
          if (uDebug > 0.5) discard;
          vec2 screenUv = gl_FragCoord.xy / uResolution;
          // Foreground terrain and the ship occlude the distortion volumes.
          if (gl_FragCoord.z > texture2D(tDepth, screenUv).r + 0.000001) discard;
          vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
          if (!gl_FrontFacing) n = -n;
          float facing = abs(dot(n, normalize(-vView)));
          float grazing = pow(1.0 - facing, 2.0);
          float fade = smoothstep(0.0, 0.025, vUv.y)
            * (1.0 - smoothstep(0.55, 1.0, vUv.y))
            * (0.4 + 0.6 * smoothstep(0.0, 0.035, vUv.x)
              * (1.0 - smoothstep(0.965, 1.0, vUv.x)));
          float strength = fade * uPower * (0.55 + grazing * 0.45);
          if (strength < 0.001) discard;
          gl_FragColor = glassVector(n, clamp(strength, 0.0, 1.0), grazing);
        }`,
    });
    this.geometries.push(...this.sheets);
    for (const geometry of this.sheets) {
      const wake = new Mesh(geometry, this.wakeMaterial);
      wake.frustumCulled = false;
      this.wakeGroup.add(wake);
    }
    // The opaque inspection view uses exactly the same geometry and deformation.
    for (const source of this.wakeGroup.children) {
      const wake = source as Mesh<BufferGeometry, ShaderMaterial>;
      const material = new ShaderMaterial({
        uniforms: { ...wake.material.uniforms, uColor: { value: new Color('#43bbff') } },
        vertexShader: wake.material.vertexShader,
        fragmentShader: `
          uniform vec3 uColor;
          varying vec3 vView;
          void main() {
            vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
            float light = 0.35 + 0.65 * abs(dot(n, normalize(vec3(0.4, 0.8, 0.5))));
            gl_FragColor = vec4(uColor * light, 1.0);
          }`,
        side: DoubleSide, depthWrite: true,
      });
      const mesh = new Mesh(wake.geometry, material);
      mesh.frustumCulled = false;
      this.debugMaterials.push(material);
      this.debugGroup.add(mesh);
    }
    this.refresh();
  }

  private get visualBoostAmount(): number {
    if (this.crashed) return 0;
    const idle = Math.min(1, Math.max(0, this.settings.boostIdleAmount));
    return idle + (1 - idle) * this.burst.intensity;
  }

  get lightIntensity(): number {
    return this.settings.boostExhaustEnabled ? this.visualBoostAmount * this.settings.boostExhaustStrength : 0;
  }

  private get sideGlassVisible(): boolean {
    return !this.cockpit && this.speed > 0
      && this.settings.wingWarpEnabled && this.sheets[0].drawRange.count > 0
      && (this.settings.wingWarpStrength > 0 || this.settings.wingWarpOpacity > 0 || this.settings.wingWarpDispersion > 0);
  }

  private get boostGlassVisible(): boolean {
    return this.settings.boostGlassEnabled && this.lightIntensity > 0.001 && !this.cockpit
      && (this.settings.boostRefraction > 0 || this.settings.boostDispersion > 0);
  }

  get hasWake(): boolean { return this.sideGlassVisible || this.boostGlassVisible; }

  configure(settings: FlightEffectSettings): void {
    this.shapeDirty ||= settings.wingWarpLength !== this.settings.wingWarpLength
      || settings.wingWarpHeight !== this.settings.wingWarpHeight
      || settings.wingWarpThickness !== this.settings.wingWarpThickness;
    this.settings = { ...settings };
    this.burst.fadeDuration = settings.boostFadeDuration;
    this.lightColor.set(settings.boostExhaustColor);
    this.light.color.copy(this.lightColor);
    this.refresh();
  }

  syncWake(trail: TrailView, origin: Vector3): void {
    if (!this.shapeDirty && this.pathRevision === trail.revision && this.pathOrigin.equals(origin)) return;
    this.sheets.forEach((sheet, side) => sheet.rebuild(trail.pathSamples, side === 0 ? 'left' : 'right',
      origin, this.settings.wingWarpLength, this.settings.wingWarpHeight, this.settings.wingWarpThickness));
    this.pathRevision = trail.revision;
    this.pathOrigin.copy(origin);
    this.shapeDirty = false;
    this.refresh();
  }

  update(dt: number, pressed: boolean, speed: number, crashed = false): void {
    this.elapsed += Math.max(0, dt);
    this.crashed = crashed;
    this.speed = crashed ? 0 : speed;
    // Integrate each control separately. Editing a speed while paused must not
    // rescale accumulated phase or make the surface jump.
    const travel = Math.max(0, dt) * Math.max(0, this.speed);
    this.sideFlowDistance += travel * this.settings.wingWarpFlowRate;
    this.boostFlowDistance += travel * this.settings.boostFlowRate;
    this.sideFlutterTime += travel / 55 * this.settings.wingWarpFlutterRate;
    this.boostFlutterTime += travel / 55 * this.settings.boostFlutterRate;
    if (crashed) this.burst.reset();
    else this.burst.update(dt, pressed);
    this.refresh();
  }

  sync(position: Vector3, orientation: Quaternion, cockpit: boolean): void {
    this.group.position.copy(position);
    this.group.quaternion.copy(orientation);
    this.boostGlassGroup.position.copy(position);
    this.boostGlassGroup.quaternion.copy(orientation);
    this.lightPosition.copy(this.light.position).applyQuaternion(orientation).add(position);
    this.cockpit = cockpit;
    this.refresh();
  }

  prepareWake(depth: Texture, width: number, height: number): void {
    // Inspection changes shading, not glass visibility or pass lifetime. Refresh
    // here as well so a paused/debug transition always binds the current state.
    this.refresh();
    for (const material of [this.wakeMaterial, this.boostGlassMaterial]) {
      material.uniformsNeedUpdate = true;
      material.uniforms.tDepth.value = depth;
      material.uniforms.uResolution.value.set(width, height);
    }
  }

  reset(): void {
    this.crashed = false;
    this.burst.reset();
    this.refresh();
  }

  private refresh(): void {
    const visualBoostAmount = this.visualBoostAmount;
    const power = this.lightIntensity;
    this.exhaustGroup.visible = power > 0.001 && !this.cockpit && !this.settings.boostGlassDebug;
    this.exhaustMaterial.uniforms.uPower.value = power;
    this.exhaustMaterial.uniforms.uTime.value = this.elapsed;
    this.exhaustMaterial.uniforms.uLength.value = this.settings.boostExhaustLength
      * (0.25 + 0.75 * visualBoostAmount);
    this.exhaustMaterial.uniforms.uShellScale.value = this.settings.boostExhaustWidth;
    this.boostGlassMaterial.uniforms.uShellScale.value = this.settings.boostGlassWidth;
    const preview = this.settings.boostGlassDebug && power <= 0.001;
    this.boostGlassMaterial.uniforms.uPower.value = preview ? 1 : power;
    this.boostGlassMaterial.uniforms.uLength.value = (preview ? this.settings.boostExhaustLength
      : this.exhaustMaterial.uniforms.uLength.value) * this.settings.boostGlassLength;
    this.boostDebugGroup.visible = this.settings.boostGlassDebug && !this.cockpit;
    // Keep the light allocated, avoiding shader recompilation on every press.
    this.light.intensity = 65 * power;
    // Keep the refraction pass alive during opaque inspection. Discard its
    // inspected surfaces in the shader instead of turning off the whole pass.
    this.wakeMaterial.uniforms.uDebug.value = this.settings.wakeDebugEnabled ? 1 : 0;
    this.boostGlassMaterial.uniforms.uDebug.value = this.settings.boostGlassDebug ? 1 : 0;
    this.wakeGroup.visible = this.sideGlassVisible;
    this.boostGlassGroup.visible = this.boostGlassVisible;
    this.wakeMaterial.uniforms.uFlowDistance.value = this.sideFlowDistance;
    this.wakeMaterial.uniforms.uFlutterTime.value = this.sideFlutterTime;
    this.wakeMaterial.uniforms.uLength.value = this.settings.wingWarpLength;
    this.wakeMaterial.uniforms.uPower.value = 0.6 + Math.min(1, this.speed / 120) * 0.3 + this.burst.intensity * 0.1;
    const flutterScale = 0.25 + 0.75 * Math.max(0, this.speed / 55);
    this.wakeMaterial.uniforms.uFlutter.value = this.settings.wingWarpFlutter * flutterScale;
    this.wakeMaterial.uniforms.uRefraction.value = this.settings.wingWarpStrength;
    this.wakeMaterial.uniforms.uDispersion.value = this.settings.wingWarpDispersion;
    this.wakeMaterial.uniforms.uSheen.value = this.settings.wingWarpOpacity;
    this.exhaustMaterial.uniforms.uFlutter.value = this.settings.boostFlutter * flutterScale;
    this.exhaustMaterial.uniforms.uFlowDistance.value = this.boostFlowDistance;
    this.exhaustMaterial.uniforms.uFlutterTime.value = this.boostFlutterTime;
    this.boostGlassMaterial.uniforms.uRefraction.value = this.settings.boostRefraction;
    this.boostGlassMaterial.uniforms.uDispersion.value = this.settings.boostDispersion;
    this.debugGroup.visible = this.settings.wakeDebugEnabled && this.settings.wingWarpEnabled && !this.cockpit;
  }

  dispose(): void {
    this.geometries.forEach(geometry => geometry.dispose());
    this.exhaustMaterial.dispose();
    this.wakeMaterial.dispose();
    this.boostGlassMaterial.dispose();
    this.boostGlassGroup.clear();
    this.debugMaterials.forEach(material => material.dispose());
    this.debugGroup.clear();
    this.group.clear();
    this.wakeGroup.clear();
  }
}
