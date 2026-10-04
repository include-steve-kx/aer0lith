import { DoubleSide, Mesh, NoBlending, Scene, ShaderMaterial, SphereGeometry, Texture, Vector2, Vector3 } from 'three';
import { PROBE } from '../core/config.ts';
import { refractionOutput } from './RefractionShader.ts';

/** One pooled spherical membrane. The terrain probe owns its origin and radius. */
export class ScanGlass {
  readonly scene = new Scene();
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private enabled = true;
  private expanding = false;
  private radius = 0;
  private fadeDuration = 0.8;
  private speed: number = PROBE.speed;
  private maxRadius: number = PROBE.maxRadius;
  private disposed = false;
  private flutterRate = 1;
  private lastTime: number | undefined;
  private readonly worldCenter = new Vector3();

  constructor() {
    const material = new ShaderMaterial({
      uniforms: {
        tDepth: { value: null }, uResolution: { value: new Vector2(1, 1) },
        uFlutterTime: { value: 0 }, uFlutter: { value: 0.04 }, uFade: { value: 0 },
        uRefraction: { value: 1 }, uDispersion: { value: 0.12 }, uSheen: { value: 0.075 },
      },
      vertexShader: `
        uniform float uFlutterTime, uFlutter;
        varying vec3 vView, vNormal, vDirection;
        void main() {
          vec3 d = normalize(position);
          vec3 k1 = vec3(6.0, 3.0, 5.0), k2 = vec3(-4.0, 9.0, 3.0), k3 = vec3(7.0, -5.0, 10.0);
          vec3 phases = vec3(dot(d, k1), dot(d, k2), dot(d, k3))
            + uFlutterTime * vec3(2.8, -3.6, 4.5);
          vec3 weights = vec3(0.55, 0.3, 0.15);
          float radius = 1.0 + uFlutter * dot(sin(phases), weights);
          vec3 gradient = uFlutter * (k1 * cos(phases.x) * weights.x
            + k2 * cos(phases.y) * weights.y + k3 * cos(phases.z) * weights.z);
          // Analytic normals follow the displaced membrane, keeping its glass
          // smooth and its distortion aligned with the fluttering silhouette.
          vec3 surfaceNormal = normalize(d - (gradient - d * dot(d, gradient)) / radius);
          vec4 view = modelViewMatrix * vec4(d * radius, 1.0);
          vView = view.xyz;
          vNormal = normalMatrix * surfaceNormal;
          vDirection = d;
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `
        uniform sampler2D tDepth;
        uniform vec2 uResolution;
        uniform float uFlutterTime, uFlutter, uFade;
        varying vec3 vView, vNormal, vDirection;
        ${refractionOutput}
        void main() {
          // The shell bends scenery behind its own surface, not terrain at a
          // particular radial distance. Foreground objects stay untouched.
          if (gl_FragCoord.z > texture2D(tDepth, gl_FragCoord.xy / uResolution).r + 0.000001) discard;
          vec3 n = normalize(vNormal);
          if (!gl_FrontFacing) n = -n;
          float grazing = pow(1.0 - abs(dot(n, normalize(-vView))), 2.0);
          vec3 direction = normalize(vDirection);
          vec2 ripple = vec2(
            sin(direction.y * 24.0 + direction.z * 13.0 - uFlutterTime * 3.0),
            sin(direction.x * 21.0 - direction.z * 17.0 + uFlutterTime * 2.4));
          n = normalize(n + vec3(ripple * uFlutter * 4.5, 0.0));
          float coverage = uFade * (0.5 + grazing * 0.5);
          if (coverage < 0.001) discard;
          gl_FragColor = glassVector(n, coverage, grazing);
        }`,
      side: DoubleSide, blending: NoBlending, depthWrite: true,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 64, 32), material);
    // Shader displacement is bounded by 12% of radius; include it in culling.
    this.mesh.geometry.computeBoundingSphere();
    this.mesh.geometry.boundingSphere!.radius = 1.12;
    this.mesh.name = 'pooled expanding scan glass membrane';
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  configure(
    enabled: boolean,
    strength: number,
    dispersion: number,
    fadeDuration = 0.8,
    flutter = 0.04,
    flutterRate = 1,
    speed: number = PROBE.speed,
    maxRadius: number = PROBE.maxRadius,
  ): void {
    if (this.enabled !== enabled) this.lastTime = undefined;
    this.enabled = enabled;
    this.flutterRate = Math.max(0, Math.min(4, flutterRate));
    this.speed = Math.max(1, speed);
    this.maxRadius = Math.max(1, maxRadius);
    this.mesh.material.uniforms.uFlutter.value = Math.max(0, Math.min(0.12, flutter));
    this.fadeDuration = Math.max(0.15, fadeDuration);
    this.mesh.material.uniforms.uRefraction.value = strength;
    this.mesh.material.uniforms.uDispersion.value = dispersion;
    this.refresh();
  }

  sync(worldCenter: Vector3, origin: Vector3, radius: number, expanding: boolean): void {
    // A replacement scan just resets this same mesh's pose. It never spawns a
    // second sphere, material, texture, or animation callback.
    if (expanding && (!this.expanding || radius < this.radius || !this.worldCenter.equals(worldCenter))) {
      this.lastTime = undefined;
      this.mesh.material.uniforms.uFlutterTime.value = 0;
    }
    this.worldCenter.copy(worldCenter);
    this.mesh.position.copy(worldCenter).sub(origin);
    this.radius = Math.max(0, Math.min(this.maxRadius, radius));
    this.mesh.scale.setScalar(Math.max(0.001, this.radius));
    this.expanding = expanding;
    this.refresh();
  }

  private refresh(): void {
    const fadeIn = Math.min(1, this.radius / 20);
    const fadeOut = Math.min(1, Math.max(
      0,
      (this.maxRadius - this.radius) / (this.speed * this.fadeDuration),
    ));
    this.mesh.material.uniforms.uFade.value = fadeIn * fadeOut;
    this.mesh.visible = !this.disposed && this.enabled && this.expanding && this.radius > 0
      && fadeOut > 0 && this.mesh.material.uniforms.uRefraction.value > 0;
  }

  get active(): boolean { return this.mesh.visible; }

  prepare(depth: Texture, width: number, height: number, time: number): void {
    const uniforms = this.mesh.material.uniforms;
    uniforms.tDepth.value = depth;
    uniforms.uResolution.value.set(width, height);
    if (this.lastTime !== undefined) {
      uniforms.uFlutterTime.value += Math.max(0, time - this.lastTime) * this.flutterRate;
    }
    this.lastTime = time;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.visible = false;
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
