import {
  AdditiveBlending,
  Color,
  DoubleSide,
  GreaterDepth,
  Group,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NotEqualStencilFunc,
  ReplaceStencilOp,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../core/config.ts';
import { WingPose } from '../flight/WingPose.ts';
import { createAircraftEdgeGeometry, createAircraftGeometry } from './createAircraftGeometry.ts';

export class AircraftView {
  readonly group = new Group();
  private readonly bodyMaterial = new MeshStandardMaterial({
    color: PALETTE.plane, roughness: 0.78, metalness: 0.12, flatShading: true,
    side: DoubleSide,
    stencilWrite: true, stencilRef: 1, stencilZPass: ReplaceStencilOp,
  });

  private readonly ghostGroup = new Group();
  private readonly ghostMaterial = new ShaderMaterial({
    uniforms: { uColor: { value: new Color('#ffee66') }, uOpacity: { value: 0.5 } },
    vertexShader: `
      varying vec3 vNormal, vView;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        vView = view.xyz; vNormal = normalMatrix * normal;
        gl_Position = projectionMatrix * view;
        gl_Position.z -= 0.000001 * gl_Position.w;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec3 vNormal, vView;
      void main() {
        float facet = 0.78 + 0.22 * abs(dot(normalize(vNormal), normalize(vec3(0.4, 0.8, 0.5))));
        gl_FragColor = vec4(uColor * facet, uOpacity);
      }`,
    transparent: true, depthWrite: false, depthFunc: GreaterDepth,
    side: DoubleSide,
    stencilWrite: true, stencilWriteMask: 0, stencilFunc: NotEqualStencilFunc, stencilRef: 1,
  });
  private readonly outlineMaterial = new ShaderMaterial({
    uniforms: { uColor: { value: new Color('#ffffff') }, uOpacity: { value: 1 } },
    vertexShader: `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z -= 0.000001 * gl_Position.w;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() { gl_FragColor = vec4(uColor, uOpacity); }`,
    transparent: true, depthWrite: false, depthFunc: GreaterDepth,
    stencilWrite: true, stencilWriteMask: 0, stencilFunc: NotEqualStencilFunc, stencilRef: 1,
  });

  private readonly geometry;
  private readonly edgeGeometry;
  private readonly impactGeometry = new SphereGeometry(0.62, 10, 7);
  private readonly impactMaterial = new MeshBasicMaterial({
    color: '#ff2020',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  private readonly impactMarker = new Mesh(this.impactGeometry, this.impactMaterial);
  private impactRemaining = 0;
  private impactDuration = 0.65;
  private impactSeverity = 0;
  private readonly wings: WingPose;
  private wingRevision = -1;

  constructor(wings = new WingPose()) {
    this.wings = wings;
    this.group.name = 'Lance / minimal X-wing';
    this.geometry = createAircraftGeometry(wings);
    this.edgeGeometry = createAircraftEdgeGeometry(wings);
    const mesh = new Mesh(this.geometry, this.bodyMaterial);
    mesh.name = 'monochrome hull and four blades';
    // Terrain is order 1 and flocks are order 2. Draw after both before marking
    // visible pixels; sharing terrain order lets material sorting mask the ghost.
    mesh.renderOrder = 3;
    this.impactMarker.name = 'temporary aircraft impact flash';
    this.impactMarker.visible = false;
    this.impactMarker.renderOrder = 10;
    this.group.add(mesh, this.ghostGroup, this.impactMarker);
    const ghost = new Mesh(this.geometry, this.ghostMaterial);
    const outline = new LineSegments(this.edgeGeometry, this.outlineMaterial);
    ghost.name = 'occluded ship silhouette'; outline.name = 'occluded ship edges';
    ghost.renderOrder = 8; outline.renderOrder = 9;
    this.ghostGroup.add(ghost, outline);
    this.syncWings();
  }

  syncWings(): void {
    if (this.wingRevision === this.wings.revision) return;
    this.wingRevision = this.wings.revision;
    this.geometry.sync(this.wings);
    this.edgeGeometry.sync(this.wings);
  }

  setColor(value: string): void {
    this.bodyMaterial.color.set(value);
  }

  setOcclusionSettings(enabled: boolean, opacity: number, color = '#ffee66'): void {
    this.ghostGroup.visible = enabled;
    this.ghostMaterial.uniforms.uOpacity.value = opacity;
    this.ghostMaterial.uniforms.uColor.value.set(color);
    this.outlineMaterial.uniforms.uOpacity.value = 1;
  }

  setCockpitMode(active: boolean): void {
    this.group.visible = !active;
  }

  flashImpact(localPoint: Vector3, duration: number, severity: number): void {
    this.impactMarker.position.copy(localPoint);
    this.impactDuration = Math.max(0.05, duration);
    this.impactRemaining = this.impactDuration;
    this.impactSeverity = Math.max(0.15, Math.min(1, severity));
    const scale = 0.8 + this.impactSeverity * 0.8;
    this.impactMarker.scale.setScalar(scale);
    this.impactMarker.visible = true;
  }

  updateImpact(dt: number, frozen = false): void {
    if (this.impactRemaining <= 0) return;
    if (!frozen) this.impactRemaining = Math.max(0, this.impactRemaining - dt);
    if (this.impactRemaining <= 0) {
      this.impactMarker.visible = false;
      this.impactMaterial.opacity = 0;
      return;
    }
    const progress = 1 - this.impactRemaining / this.impactDuration;
    const flash = Math.sin(progress * Math.PI * 10) > 0 ? 1 : 0.2;
    this.impactMaterial.opacity = (this.impactRemaining / this.impactDuration)
      * flash * (0.35 + this.impactSeverity * 0.65);
  }

  get impactVisible(): boolean { return this.impactMarker.visible; }
  get impactPosition(): Readonly<Vector3> { return this.impactMarker.position; }

  dispose(): void {
    this.geometry.dispose();
    this.edgeGeometry.dispose();
    this.impactGeometry.dispose();
    this.bodyMaterial.dispose();
    this.ghostMaterial.dispose();
    this.outlineMaterial.dispose();
    this.impactMaterial.dispose();
  }
}
