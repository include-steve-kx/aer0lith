import { ConeGeometry, CylinderGeometry, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Object3D, ShaderMaterial, Vector3, Color } from 'three';
import { COMBAT_LIMITS } from './settings.ts';
import type { MeteorSystem } from './MeteorSystem.ts';

/** Two fixed batches; no per-rock objects or terrain visibility queries. */
export class PushVectorView {
  readonly group = new Group();
  readonly shafts: InstancedMesh;
  readonly heads: InstancedMesh;
  private readonly alpha = new InstancedBufferAttribute(new Float32Array(COMBAT_LIMITS.meteors), 1).setUsage(DynamicDrawUsage);
  private readonly material = new ShaderMaterial({
    uniforms: { color: { value: new Color() } },
    transparent: true, depthWrite: false, depthTest: false,
    vertexShader: 'attribute float arrowAlpha; varying float fade; void main(){fade=arrowAlpha;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform vec3 color; varying float fade; void main(){gl_FragColor=vec4(color,fade);}',
  });
  private readonly pose = new Object3D();
  private readonly impulse = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private disposed = false;
  constructor() {
    const shaft = new CylinderGeometry(1, 1, 1, 5), head = new ConeGeometry(1, 1, 6);
    shaft.translate(0, 0.5, 0); head.translate(0, 0.5, 0);
    shaft.setAttribute('arrowAlpha', this.alpha); head.setAttribute('arrowAlpha', this.alpha);
    this.shafts = new InstancedMesh(shaft, this.material, COMBAT_LIMITS.meteors);
    this.heads = new InstancedMesh(head, this.material, COMBAT_LIMITS.meteors);
    for (const mesh of [this.shafts, this.heads]) {
      mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 8;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage); this.group.add(mesh);
    }
  }
  sync(meteors: MeteorSystem, origin: Vector3, visible: boolean): void {
    const settings = meteors.settings;
    this.material.uniforms.color.value.set(settings.meteorTargetColor);
    let count = 0;
    if (visible && settings.meteorMarkers && settings.meteorPushVectorScale > 0)
      for (const rock of meteors.rocks) {
        if (!rock.active || rock.detected <= 0) continue;
        meteors.predictExplosionImpulse(this.impulse, rock);
        const length = this.impulse.length() * settings.meteorPushVectorScale;
        if (length < 1e-6) continue;
        this.impulse.normalize();
        const headLength = Math.min(1.5, length * 0.125), shaftLength = length - headLength;
        const width = Math.min(0.08, length * 0.0125);
        this.pose.quaternion.setFromUnitVectors(this.up, this.impulse);
        this.pose.position.copy(rock.position).sub(origin);
        this.pose.scale.set(width, shaftLength, width); this.pose.updateMatrix();
        this.shafts.setMatrixAt(count, this.pose.matrix);
        this.pose.position.addScaledVector(this.impulse, shaftLength);
        this.pose.scale.set(width * 3, headLength, width * 3); this.pose.updateMatrix();
        this.heads.setMatrixAt(count, this.pose.matrix);
        this.alpha.setX(count++, Math.min(1, rock.detected));
      }
    for (const mesh of [this.shafts, this.heads]) {
      mesh.count = count; mesh.visible = count > 0;
      mesh.instanceMatrix.clearUpdateRanges();
      if (count) { mesh.instanceMatrix.addUpdateRange(0, count * 16); mesh.instanceMatrix.needsUpdate = true; }
    }
    this.alpha.clearUpdateRanges();
    if (count) { this.alpha.addUpdateRange(0, count); this.alpha.needsUpdate = true; }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of [this.shafts, this.heads]) { mesh.geometry.dispose(); mesh.dispose(); }
    this.material.dispose(); this.group.clear();
  }
}
