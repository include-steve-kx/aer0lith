import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  ConeGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoBlending,
  Object3D,
  Quaternion,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  Vector2,
  Vector3,
} from 'three';
import { COMBAT_LIMITS, type CombatSettings } from './settings.ts';
import { MeteorSystem } from './MeteorSystem.ts';
import { PushVectorView } from './PushVectorView.ts';
import { MissileSystem } from './MissileSystem.ts';
import { ImpactSystem } from './ImpactSystem.ts';
import { refractionOutput } from '../render/RefractionShader.ts';
import type { RefractionContributor } from './types.ts';

function cornerGeometry(): BufferGeometry {
  const positions: number[] = [],
    offsets: number[] = [];
  const box = new BoxGeometry(1, 1, 1),
    triangles = box.toNonIndexed(),
    p = triangles.getAttribute('position');
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      for (const z of [-1, 1])
        for (let axis = 0; axis < 3; axis++) {
          const center = [x * 0.5, y * 0.5, z * 0.5],
            scale = [0, 0, 0];
          center[axis] -= center[axis] * 0.22;
          scale[axis] = 0.22;
          for (let i = 0; i < p.count; i++) {
            positions.push(
              p.getX(i) * scale[0] + center[0],
              p.getY(i) * scale[1] + center[1],
              p.getZ(i) * scale[2] + center[2],
            );
            offsets.push(
              axis === 0 ? 0 : p.getX(i),
              axis === 1 ? 0 : p.getY(i),
              axis === 2 ? 0 : p.getZ(i),
            );
          }
        }
  box.dispose();
  triangles.dispose();
  const g = new BufferGeometry();
  g.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  g.setAttribute(
    'thicknessOffset',
    new BufferAttribute(new Float32Array(offsets), 3),
  );
  return g;
}
const alphaVertex = `attribute float aAlpha; varying float vAlpha; void main(){vAlpha=aAlpha;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`;
const alphaFragment = `uniform vec3 uColor;varying float vAlpha;void main(){if(vAlpha<.001)discard;gl_FragColor=vec4(uColor,vAlpha);}`;
export class RibbonBatch {
  readonly geometry = new BufferGeometry();
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  readonly positions: BufferAttribute;
  readonly colors: BufferAttribute;
  readonly alphas?: BufferAttribute;
  count = 0;
  constructor(
    capacity: number,
    { lit = false, opaque = false }: { lit?: boolean; opaque?: boolean } = {},
  ) {
    this.positions = new BufferAttribute(
      new Float32Array(capacity * 3),
      3,
    ).setUsage(DynamicDrawUsage);
    this.colors = new BufferAttribute(
      new Float32Array(capacity * 3),
      3,
    ).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positions);
    this.geometry.setAttribute('color', this.colors);
    if (!opaque) {
      this.alphas = new BufferAttribute(new Float32Array(capacity), 1).setUsage(
        DynamicDrawUsage,
      );
      this.geometry.setAttribute('alpha', this.alphas);
    }
    this.geometry.setDrawRange(0, 0);
    this.mesh = new Mesh(
      this.geometry,
      new ShaderMaterial({
        transparent: !opaque,
        depthWrite: opaque,
        side: DoubleSide,
        vertexShader: opaque
          ? `attribute vec3 color;varying vec3 vColor;void main(){vColor=color;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`
          : `attribute vec3 color;attribute float alpha;varying vec3 vColor;varying float vAlpha;void main(){vColor=color;vAlpha=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: opaque
          ? `varying vec3 vColor;void main(){gl_FragColor=vec4(vColor,1.0);}`
          : `varying vec3 vColor;varying float vAlpha;void main(){if(vAlpha<.001)discard;gl_FragColor=vec4(vColor${lit ? '' : ' '},vAlpha);}`,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opaque ? 2 : lit ? 7 : 4;
  }
  vertex(p: Vector3, color: Color, alpha: number): void {
    const i = this.count++;
    this.positions.setXYZ(i, p.x, p.y, p.z);
    this.colors.setXYZ(i, color.r, color.g, color.b);
    this.alphas?.setX(i, alpha);
  }
  finish(): void {
    this.geometry.setDrawRange(0, this.count);
    // Upload only the live prefix, not the entire worst-case pool every frame.
    for (const attribute of [this.positions, this.colors, this.alphas]) {
      if (!attribute) continue;
      attribute.clearUpdateRanges();
      if (this.count > 0) {
        attribute.addUpdateRange(0, this.count * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    }
    this.mesh.visible = this.count > 0;
  }
  dispose(): void {
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}
export class CombatView implements RefractionContributor {
  private readonly pushVectors = new PushVectorView();
  readonly group = new Group();
  readonly scene = new Scene();
  private readonly rockMeshes: InstancedMesh[];
  private readonly rockMaterial = new MeshStandardMaterial({
    roughness: 0.94,
    metalness: 0.03,
    flatShading: true,
  });
  private readonly boxSizes = new InstancedBufferAttribute(
    new Float32Array(COMBAT_LIMITS.meteors * 3),
    3,
  );
  private readonly debugMeshes: InstancedMesh[];
  private readonly boxes: InstancedMesh;
  private readonly boxAlpha = new InstancedBufferAttribute(
    new Float32Array(COMBAT_LIMITS.meteors),
    1,
  ).setUsage(DynamicDrawUsage);
  private readonly missilesMesh: InstancedMesh;
  private readonly debugRocks: InstancedMesh;
  private readonly debugPaths: RibbonBatch;
  private readonly trails = new RibbonBatch(
    COMBAT_LIMITS.trails * (COMBAT_LIMITS.samples - 1) * 6,
  );
  private readonly fragments: RibbonBatch;
  private readonly glass: InstancedMesh;
  private readonly pulse: InstancedMesh;
  private readonly rings: InstancedMesh;
  private readonly explosionAlpha = new InstancedBufferAttribute(
    new Float32Array(COMBAT_LIMITS.explosions),
    1,
  ).setUsage(DynamicDrawUsage);
  private readonly explosionAge = new InstancedBufferAttribute(
    new Float32Array(COMBAT_LIMITS.explosions),
    1,
  ).setUsage(DynamicDrawUsage);
  private readonly dummy = new Object3D();
  private readonly tint = new Color();
  private readonly rockColor = new Color();
  private readonly dangerColor = new Color();
  private readonly color = new Color();
  private readonly p = new Vector3();
  private readonly b = new Vector3();
  private readonly c = new Vector3();
  private readonly side = new Vector3();
  private readonly tangent = new Vector3();
  private readonly view = new Vector3();
  private readonly normal = new Vector3();
  private readonly lightDirection = new Vector3(.3,.8,.5).normalize();
  private readonly cameraWorld = new Vector3();
  private readonly identity = new Quaternion();
  private disposed = false;
  settings: CombatSettings;
  readonly meteors: MeteorSystem;
  readonly missiles: MissileSystem;
  readonly impacts: ImpactSystem;
  constructor(
    meteors: MeteorSystem,
    missiles: MissileSystem,
    impacts: ImpactSystem,
  ) {
    this.meteors = meteors;
    this.missiles = missiles;
    this.impacts = impacts;
    this.settings = meteors.settings;
    this.rockMeshes = meteors.library.variants.map((v) => {
      const mesh = new InstancedMesh(
        v.geometry,
        this.rockMaterial,
        COMBAT_LIMITS.meteors,
      );
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.setColorAt(0, new Color(1, 1, 1));
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });
    this.debugMeshes = meteors.library.variants.map((v) => {
      const mesh = new InstancedMesh(
        v.geometry,
        new MeshBasicMaterial({
          color: '#ffee66',
          wireframe: true,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
        }),
        COMBAT_LIMITS.meteors,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    });
    const corners = cornerGeometry();
    corners.setAttribute('aSize', this.boxSizes);
    corners.setAttribute('aAlpha', this.boxAlpha);
    this.boxes = new InstancedMesh(
      corners,
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color() },
          uThickness: { value: 0.12 },
        },
        vertexShader: `attribute float aAlpha;attribute vec3 aSize,thicknessOffset;uniform float uThickness;varying float vAlpha;void main(){vAlpha=aAlpha;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position+thicknessOffset*uThickness/aSize,1.0);}`,
        fragmentShader: alphaFragment,
        transparent: true,
        depthWrite: false,
      }),
      COMBAT_LIMITS.meteors,
    );
    this.boxes.renderOrder = 5;
    this.boxes.frustumCulled = false;
    const missileGeometry = new ConeGeometry(0.22, 1.8, 4);
    missileGeometry.rotateX(Math.PI / 2);
    this.missilesMesh = new InstancedMesh(
      missileGeometry,
      new MeshBasicMaterial({ color: '#e6e6e6' }),
      COMBAT_LIMITS.missiles,
    );
    this.missilesMesh.frustumCulled = false;
    this.debugRocks = new InstancedMesh(
      new SphereGeometry(1, 12, 8),
      new MeshBasicMaterial({
        color: '#ffee66',
        wireframe: true,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
      COMBAT_LIMITS.meteors,
    );
    this.debugRocks.frustumCulled = false;
    this.debugPaths = new RibbonBatch(COMBAT_LIMITS.missiles * 6);
    let maxShard = 0;
    for (const v of meteors.library.variants)
      for (const pieces of v.shards.values())
        for (const s of pieces)
          maxShard = Math.max(maxShard, s.positions.length / 3);
    this.fragments = new RibbonBatch(COMBAT_LIMITS.fragments * maxShard, {
      lit: true,
      opaque: true,
    });
    const sphere = new SphereGeometry(1, 20, 12);
    sphere.setAttribute('aAlpha', this.explosionAlpha);
    sphere.setAttribute('aAge', this.explosionAge);
    const vertex = `attribute float aAlpha,aAge;varying float vAlpha;varying vec3 vView,vNormal;void main(){vAlpha=aAlpha;vec3 p=position*(1.0+.025*sin(position.x*9.0+position.y*7.0+aAge*13.0));vec4 view=modelViewMatrix*instanceMatrix*vec4(p,1.0);vView=view.xyz;vNormal=normalMatrix*mat3(instanceMatrix)*normal;gl_Position=projectionMatrix*view;}`;
    const glassMaterial = new ShaderMaterial({
      uniforms: {
        tDepth: { value: null },
        uResolution: { value: new Vector2() },
        uRefraction: { value: 0.8 },
        uDispersion: { value: 0.16 },
        uSheen: { value: 0.06 },
        uDebug: { value: 0 },
      },
      side: DoubleSide,
      blending: NoBlending,
      depthWrite: true,
      vertexShader: vertex,
      fragmentShader: `uniform sampler2D tDepth;uniform vec2 uResolution;uniform float uDebug;varying float vAlpha;varying vec3 vView,vNormal;${refractionOutput}
      void main(){if(uDebug>.5||vAlpha<.001)discard;if(gl_FragCoord.z>texture2D(tDepth,gl_FragCoord.xy/uResolution).r+.000001)discard;vec3 n=normalize(cross(dFdx(vView),dFdy(vView)));if(!gl_FrontFacing)n=-n;float grazing=pow(1.0-abs(dot(n,normalize(-vView))),2.0);gl_FragColor=glassVector(n,vAlpha,grazing);}`,
    });
    this.glass = new InstancedMesh(
      sphere,
      glassMaterial,
      COMBAT_LIMITS.explosions,
    );
    this.glass.frustumCulled = false;
    this.scene.add(this.glass);
    this.pulse = new InstancedMesh(
      sphere,
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color('#a8d6df') },
          uBrightness: { value: 0.6 },
          uDebug: { value: 0 },
        },
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: vertex,
        fragmentShader: `uniform vec3 uColor;uniform float uBrightness,uDebug;varying float vAlpha;varying vec3 vView,vNormal;void main(){float rim=pow(1.0-abs(dot(normalize(vNormal),normalize(-vView))),3.0);gl_FragColor=vec4(uDebug>.5?vec3(.9,.55,.15):uColor,uDebug>.5?.85:vAlpha*rim*uBrightness*.35);}`,
      }),
      COMBAT_LIMITS.explosions,
    );
    this.pulse.frustumCulled = false;
    const ringGeometry = new RingGeometry(0.94, 1, 48);
    ringGeometry.setAttribute('aAlpha', this.explosionAlpha);
    this.rings = new InstancedMesh(
      ringGeometry,
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color('#d0e9ee') } },
        vertexShader: alphaVertex,
        fragmentShader: alphaFragment,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
      COMBAT_LIMITS.explosions,
    );
    this.rings.frustumCulled = false;
    this.group.add(
      this.pushVectors.group,
      this.boxes,
      this.missilesMesh,
      this.trails.mesh,
      this.fragments.mesh,
      this.pulse,
      this.rings,
      this.debugRocks,
      this.debugPaths.mesh,
    );
  }
  configure(settings: CombatSettings): void {
    this.settings = settings;
    this.rockMaterial.color.set(0xffffff);
    this.rockColor.set(settings.meteorColor);
    this.dangerColor.set(settings.meteorDangerColor);
    (this.boxes.material as ShaderMaterial).uniforms.uColor.value.set(
      settings.meteorTargetColor,
    );
    (this.missilesMesh.material as MeshBasicMaterial).color.set(
      settings.missileColor,
    );
    const glass = this.glass.material as ShaderMaterial;
    glass.uniforms.uRefraction.value = settings.explosionRefraction;
    glass.uniforms.uDispersion.value = settings.explosionDispersion;
    glass.uniforms.uDebug.value = settings.explosionDebug ? 1 : 0;
    const pulse = this.pulse.material as ShaderMaterial;
    pulse.uniforms.uBrightness.value = settings.explosionBrightness;
    pulse.uniforms.uDebug.value = settings.explosionDebug ? 1 : 0;
    pulse.blending = settings.explosionDebug ? NoBlending : AdditiveBlending;
    (this.boxes.material as ShaderMaterial).uniforms.uThickness.value =
      settings.meteorTargetThickness;
  }
  private ribbon(
    batch: RibbonBatch,
    a: Vector3,
    b: Vector3,
    width: number,
    color: Color,
    alphaA: number,
    alphaB: number,
  ): void {
    this.tangent.subVectors(b, a);
    this.view.subVectors(this.cameraWorld, a);
    this.side.crossVectors(this.tangent, this.view);
    if (this.side.lengthSq() < 1e-12) this.side.set(1, 0, 0);
    this.side.normalize().multiplyScalar(width * 0.5);
    this.p.copy(a).add(this.side);
    batch.vertex(this.p, color, alphaA);
    this.p.copy(a).sub(this.side);
    batch.vertex(this.p, color, alphaA);
    this.p.copy(b).add(this.side);
    batch.vertex(this.p, color, alphaB);
    this.p.copy(a).sub(this.side);
    batch.vertex(this.p, color, alphaA);
    this.p.copy(b).sub(this.side);
    batch.vertex(this.p, color, alphaB);
    this.p.copy(b).add(this.side);
    batch.vertex(this.p, color, alphaB);
  }
  sync(
    origin: Vector3,
    camera: Camera,
    markers: boolean,
    debug: boolean,
  ): void {
    this.pushVectors.sync(this.meteors, origin, markers);
    camera.getWorldPosition(this.cameraWorld);
    this.rockMeshes.forEach((m) => (m.count = 0));
    this.debugMeshes.forEach((m) => (m.count = 0));
    let boxes = 0,
      rocks = 0;
    for (let slot = 0; slot < this.meteors.rocks.length; slot++) {
      const m = this.meteors.rocks[slot];
      if (!m.active) continue;
      this.dummy.position.copy(m.position).sub(origin);
      this.dummy.quaternion.copy(m.orientation);
      this.dummy.scale.setScalar(m.diameter);
      this.dummy.updateMatrix();
      const mesh = this.rockMeshes[m.variant],
        i = mesh.count++;
      mesh.setMatrixAt(i, this.dummy.matrix);
      mesh.setColorAt(i, this.tint.copy(this.rockColor)
        .lerp(this.dangerColor, this.meteors.dangerIntensity(m))
        .multiplyScalar(m.brightness + m.hitFlash * 5));
      if (debug) {
        const d = this.debugMeshes[m.variant];
        d.setMatrixAt(d.count++, this.dummy.matrix);
      }
      if (markers && this.settings.meteorMarkers && m.detected > 0) {
        const bounds = mesh.geometry.boundingBox!;
        bounds
          .getSize(this.dummy.scale)
          .multiplyScalar(m.diameter)
          .addScalar(0.4);
        bounds
          .getCenter(this.dummy.position)
          .multiplyScalar(m.diameter)
          .applyQuaternion(m.orientation)
          .add(m.position)
          .sub(origin);
        this.dummy.updateMatrix();
        this.boxes.setMatrixAt(boxes, this.dummy.matrix);
        this.boxSizes.setXYZ(
          boxes,
          this.dummy.scale.x,
          this.dummy.scale.y,
          this.dummy.scale.z,
        );
        this.boxAlpha.setX(boxes++, Math.min(1, m.detected));
      }
      if (debug) {
        this.dummy.position.copy(m.position).sub(origin);
        this.dummy.scale.setScalar(m.radius);
        this.dummy.updateMatrix();
        this.debugRocks.setMatrixAt(rocks++, this.dummy.matrix);
      }
    }
    for (const mesh of this.rockMeshes) {
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const mesh of this.debugMeshes) {
      mesh.visible = mesh.count > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.boxSizes.needsUpdate = true;
    this.boxes.visible = boxes > 0;
    this.boxes.count = boxes;
    this.boxes.instanceMatrix.needsUpdate = true;
    this.boxAlpha.needsUpdate = true;
    this.debugRocks.visible = rocks > 0;
    this.debugRocks.count = rocks;
    this.debugRocks.instanceMatrix.needsUpdate = true;
    let count = 0;
    this.debugPaths.count = 0;
    for (const m of this.missiles.missiles)
      if (m.active) {
        this.dummy.position.copy(m.position).sub(origin);
        this.dummy.quaternion.copy(m.orientation);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.missilesMesh.setMatrixAt(count++, this.dummy.matrix);
        if (debug) {
          this.b.copy(m.previous).sub(origin);
          this.c.copy(m.position).sub(origin);
          this.ribbon(
            this.debugPaths,
            this.b,
            this.c,
            0.16,
            this.tint.set('#ffee66'),
            1,
            1,
          );
        }
      }
    this.missilesMesh.visible = count > 0;
    this.missilesMesh.count = count;
    this.missilesMesh.instanceMatrix.needsUpdate = true;
    this.debugPaths.finish();
    this.trails.count = 0;
    this.tint.set(this.settings.missileTrailColor);
    for (const t of this.missiles.trails) {
      if (!t.active) continue;
      let length = 0;
      for (let n = 0; n < t.count - 1; n++) {
        const i = (t.head - n + COMBAT_LIMITS.samples) % COMBAT_LIMITS.samples,
          j = (i - 1 + COMBAT_LIMITS.samples) % COMBAT_LIMITS.samples;
        const ageA = this.missiles.time - t.times[i],
          ageB = this.missiles.time - t.times[j];
        if (ageA > this.settings.missileTrailLife) break;
        this.b.fromArray(t.positions, i * 3).sub(origin);
        this.c.fromArray(t.positions, j * 3).sub(origin);
        length += this.b.distanceTo(this.c);
        if (length > this.settings.missileTrailLength) break;
        this.ribbon(
          this.trails,
          this.b,
          this.c,
          this.settings.missileTrailWidth,
          this.tint,
          this.settings.missileTrailOpacity *
            Math.max(0, 1 - ageA / this.settings.missileTrailLife) ** 2,
          this.settings.missileTrailOpacity *
            Math.max(0, 1 - ageB / this.settings.missileTrailLife) ** 2,
        );
      }
    }
    this.trails.finish();
    this.fragments.count = 0;
    for (const f of this.impacts.fragments) {
      if (!f.active || !f.template) continue;
      const t = f.template;
      for (let v = 0; v < t.shades.length; v++) {
        this.p
          .fromArray(t.positions, v * 3)
          .sub(t.center)
          .multiplyScalar(f.scale * f.lifeScale)
          .applyQuaternion(f.orientation)
          .add(f.position)
          .sub(origin);
        this.normal.fromArray(t.normals, v * 3).applyQuaternion(f.orientation);
        const light =
          0.55 +
          0.45 *
            Math.max(0, this.normal.dot(this.lightDirection));
        this.color.copy(f.color).multiplyScalar(t.shades[v] * light);
        this.fragments.vertex(this.p, this.color, 1);
      }
    }
    this.fragments.finish();
    count = 0;
    for (const e of this.impacts.explosions) {
      if (!e.active) continue;
      const t = e.age / e.life,
        r = Math.max(0.01, e.radius * (1 - (1 - t) ** 2));
      this.dummy.position.copy(e.position).sub(origin);
      this.dummy.quaternion.copy(this.identity);
      this.dummy.scale.setScalar(r);
      this.dummy.updateMatrix();
      this.glass.setMatrixAt(count, this.dummy.matrix);
      this.pulse.setMatrixAt(count, this.dummy.matrix);
      this.dummy.quaternion.copy(camera.quaternion);
      this.dummy.scale.setScalar(r * 1.1);
      this.dummy.updateMatrix();
      this.rings.setMatrixAt(count, this.dummy.matrix);
      this.explosionAlpha.setX(count, Math.min(1, t / 0.06) * (1 - t) ** 2);
      this.explosionAge.setX(count, e.age);
      count++;
    }
    for (const mesh of [this.glass, this.pulse, this.rings]) {
      mesh.visible = count > 0;
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.explosionAlpha.needsUpdate = true;
    this.explosionAge.needsUpdate = true;
  }
  get active(): boolean {
    return (
      !this.disposed &&
      this.glass.count > 0 &&
      (this.settings.explosionRefraction > 0 ||
        this.settings.explosionDispersion > 0)
    );
  }
  prepare(depth: Texture, width: number, height: number): void {
    const m = this.glass.material as ShaderMaterial;
    m.uniforms.tDepth.value = depth;
    m.uniforms.uResolution.value.set(width, height);
    m.uniformsNeedUpdate = true;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.rockMeshes.forEach((m) => m.dispose());
    this.rockMaterial.dispose();
    this.debugMeshes.forEach((m) => {
      (m.material as MeshBasicMaterial).dispose();
      m.dispose();
    });
    const geometry = new Set<BufferGeometry>();
    for (const mesh of [
      this.boxes,
      this.missilesMesh,
      this.debugRocks,
      this.glass,
      this.pulse,
      this.rings,
    ]) {
      geometry.add(mesh.geometry);
      (mesh.material as ShaderMaterial | MeshBasicMaterial).dispose();
      mesh.dispose();
    }
    geometry.forEach((g) => g.dispose());
    this.pushVectors.dispose();
    this.trails.dispose();
    this.fragments.dispose();
    this.debugPaths.dispose();
    this.group.clear();
    this.scene.clear();
  }
}
