import {
  AdditiveBlending,
  Camera,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  NoBlending,
  Object3D,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector2,
  Vector3,
} from "three";
import { RibbonBatch } from "./CombatView.ts";
import { COMBAT_LIMITS } from "./settings.ts";
import { refractionOutput } from "../render/RefractionShader.ts";
import type { RefractionContributor } from "./types.ts";
import type { BulletSystem } from "./BulletSystem.ts";
/** Five fixed batches. Straight trails use analytic age/length clipping, not sample rings. */
export class BulletView implements RefractionContributor {
  readonly group = new Group();
  readonly scene = new Scene();
  readonly bolts = new RibbonBatch(COMBAT_LIMITS.bullets * 6);
  readonly trails = new RibbonBatch(COMBAT_LIMITS.bulletTrails * 24);
  readonly sparks = new RibbonBatch(COMBAT_LIMITS.sparks * 18);
  readonly flame: InstancedMesh;
  readonly glass: InstancedMesh;
  private readonly pulse = new InstancedBufferAttribute(new Float32Array(4), 1);
  private readonly dummy = new Object3D();
  private readonly z = new Vector3(0, 0, 1);
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly side = new Vector3();
  private readonly v = new Vector3();
  private readonly direction = new Vector3();
  private readonly eye = new Vector3();
  private readonly color = new Color();
  private readonly rotation = new Quaternion();
  private disposed = false;
  readonly system: BulletSystem;
  constructor(system: BulletSystem) {
    this.system = system;
    const g = new SphereGeometry(1, 8, 6);
    g.setAttribute("aPulse", this.pulse);
    const vertex = `attribute float aPulse;uniform float uTime;varying float vPulse;varying vec3 vView;varying vec3 vLocal;
    void main(){vPulse=aPulse;vLocal=position;vec3 p=position;p.xy*=1.0+.12*sin(position.z*13.0+uTime*65.0+position.x*7.0+position.y*5.0);vec4 v=modelViewMatrix*instanceMatrix*vec4(p,1.);vView=v.xyz;gl_Position=projectionMatrix*v;}`;
    // No per-shot objects or lights. The same four instances serve opaque debug and flame.
    const flameMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new Color() },
        uDebug: { value: 0 },
      },
      vertexShader: vertex,
      fragmentShader: `uniform vec3 uColor;uniform float uDebug;varying float vPulse;varying vec3 vLocal;void main(){if(vPulse<.001)discard;float alpha=vPulse*pow(max(0.,1.-abs(vLocal.z)),.6);gl_FragColor=vec4(uDebug>.5?vec3(.2,.85,1.):uColor,uDebug>.5?1.:alpha);}`,
    });
    this.flame = new InstancedMesh(g, flameMaterial, 4);
    this.glass = new InstancedMesh(
      g,
      new ShaderMaterial({
        side: DoubleSide,
        blending: NoBlending,
        depthWrite: true,
        uniforms: {
          uTime: { value: 0 },
          tDepth: { value: null },
          uResolution: { value: new Vector2() },
          uRefraction: { value: 0.3 },
          uDispersion: { value: 0.06 },
          uSheen: { value: 0.02 },
        },
        vertexShader: vertex,
        fragmentShader: `uniform sampler2D tDepth;uniform vec2 uResolution;varying float vPulse;varying vec3 vView;${refractionOutput}
      void main(){if(vPulse<.001)discard;if(gl_FragCoord.z>texture2D(tDepth,gl_FragCoord.xy/uResolution).r+.000001)discard;vec3 n=normalize(cross(dFdx(vView),dFdy(vView)));if(!gl_FrontFacing)n=-n;float grazing=1.-abs(dot(n,normalize(-vView)));gl_FragColor=glassVector(n,vPulse,grazing);}`,
      }),
      4,
    );
    this.flame.frustumCulled = this.glass.frustumCulled = false;
    this.group.add(
      this.bolts.mesh,
      this.trails.mesh,
      this.sparks.mesh,
      this.flame,
    );
    this.scene.add(this.glass);
  }
  private ribbon(
    batch: RibbonBatch,
    from: Vector3,
    to: Vector3,
    width: number,
    alphaA: number,
    alphaB: number,
  ): void {
    this.direction.subVectors(to, from);
    this.side.subVectors(this.eye, from).cross(this.direction);
    if (this.side.lengthSq() < 1e-10) this.side.set(1, 0, 0);
    this.side.normalize().multiplyScalar(width * 0.5);
    batch.vertex(this.v.copy(from).sub(this.side), this.color, alphaA);
    batch.vertex(this.v.copy(from).add(this.side), this.color, alphaA);
    batch.vertex(this.v.copy(to).add(this.side), this.color, alphaB);
    batch.vertex(this.v.copy(from).sub(this.side), this.color, alphaA);
    batch.vertex(this.v.copy(to).add(this.side), this.color, alphaB);
    batch.vertex(this.v.copy(to).sub(this.side), this.color, alphaB);
  }
  sync(origin: Vector3, camera: Camera, shipQ: Quaternion): void {
    const s = this.system,
      settings = s.settings;
    this.eye.copy(camera.position);
    this.bolts.count = this.trails.count = this.sparks.count = 0;
    this.color.set(settings.bulletColor);
    for (const b of s.bullets)
      if (b.active) {
        this.b.copy(b.position).sub(origin);
        this.a
          .copy(this.b)
          .addScaledVector(b.direction, -Math.min(b.length, b.distance));
        this.ribbon(this.bolts, this.a, this.b, b.diameter, 0.7, 1);
      }
    this.color.set(settings.bulletTrailColor);
    for (const t of s.trails)
      if (t.active) {
        const end = t.distance,
          min = Math.max(
            0,
            end - settings.bulletTrailLength,
            (s.time - settings.bulletTrailLife - t.birth) * t.speed,
          );
        if (min >= end) continue;
        for (let j = 0; j < 4; j++) {
          const da = min + ((end - min) * j) / 4,
            db = min + ((end - min) * (j + 1)) / 4;
          this.a.copy(t.origin).addScaledVector(t.direction, da).sub(origin);
          this.b.copy(t.origin).addScaledVector(t.direction, db).sub(origin);
          const aa = Math.max(
              0,
              1 - (s.time - t.birth - da / t.speed) / settings.bulletTrailLife,
            ),
            ab = Math.max(
              0,
              1 - (s.time - t.birth - db / t.speed) / settings.bulletTrailLife,
            );
          this.ribbon(
            this.trails,
            this.a,
            this.b,
            settings.bulletTrailWidth,
            (aa * aa * settings.bulletTrailOpacity * j) / 4,
            (ab * ab * settings.bulletTrailOpacity * (j + 1)) / 4,
          );
        }
      }
    this.color.set(settings.muzzleColor);
    for (const spark of s.sparks) {
      const age = s.time - spark.birth;
      if (age < 0 || age >= 0.12) continue;
      for (let axis = 0; axis < 3; axis++) {
        this.a.copy(spark.position).sub(origin);
        this.b.copy(this.a);
        this.a.setComponent(axis, this.a.getComponent(axis) - 0.3 - age * 5);
        this.b.setComponent(axis, this.b.getComponent(axis) + 0.3 + age * 5);
        this.ribbon(this.sparks, this.a, this.b, 0.055, 1 - age / 0.12, 0);
      }
    }
    this.bolts.finish();
    this.trails.finish();
    this.sparks.finish();
    let count = 0;
    for (let i = 0; i < 4; i++) {
      const f = s.flashes[i],
        age = s.time - f.birth,
        power = age >= 0 && age < f.life ? (1 - age / f.life) ** 2 : 0;
      if (!power) continue;
      this.pulse.setX(count, power);
      this.direction.copy(f.direction).applyQuaternion(shipQ);
      this.dummy.position
        .copy(s.muzzles[i])
        .sub(origin)
        .addScaledVector(this.direction, settings.muzzleLength * 0.5);
      this.rotation.setFromUnitVectors(this.z, this.direction);
      this.dummy.quaternion.copy(this.rotation);
      const scale = settings.muzzleDebug ? 1.25 : 1;
      this.dummy.scale.set(
        settings.muzzleWidth * 0.5 * scale,
        settings.muzzleWidth * 0.5 * scale,
        settings.muzzleLength * 0.5 * scale,
      );
      this.dummy.updateMatrix();
      this.flame.setMatrixAt(count, this.dummy.matrix);
      this.dummy.scale.multiplyScalar(settings.muzzleDebug ? 1 : 1.25);
      this.dummy.updateMatrix();
      this.glass.setMatrixAt(count, this.dummy.matrix);
      count++;
    }
    this.pulse.needsUpdate = true;
    this.flame.count = this.glass.count = count;
    this.flame.visible = count > 0;
    this.glass.visible = count > 0 && !settings.muzzleDebug;
    this.flame.instanceMatrix.needsUpdate =
      this.glass.instanceMatrix.needsUpdate = count > 0;
    const fm = this.flame.material as ShaderMaterial,
      gm = this.glass.material as ShaderMaterial;
    fm.uniforms.uColor.value.set(settings.muzzleColor);
    fm.uniforms.uTime.value = gm.uniforms.uTime.value = s.time;
    fm.uniforms.uDebug.value = settings.muzzleDebug ? 1 : 0;
    fm.blending = settings.muzzleDebug ? NoBlending : AdditiveBlending;
    fm.depthWrite = settings.muzzleDebug;
    gm.uniforms.uRefraction.value = settings.muzzleRefraction;
    gm.uniforms.uDispersion.value = settings.muzzleDispersion;
  }
  get active(): boolean {
    return (
      this.glass.visible &&
      (this.system.settings.muzzleRefraction > 0 ||
        this.system.settings.muzzleDispersion > 0)
    );
  }
  prepare(depth: Texture, width: number, height: number): void {
    const u = (this.glass.material as ShaderMaterial).uniforms;
    u.tDepth.value = depth;
    u.uResolution.value.set(width, height);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bolts.dispose();
    this.trails.dispose();
    this.sparks.dispose();
    this.flame.geometry.dispose();
    (this.flame.material as ShaderMaterial).dispose();
    (this.glass.material as ShaderMaterial).dispose();
    this.flame.dispose();
    this.glass.dispose();
    this.group.removeFromParent();
    this.scene.clear();
  }
}
