import { Color, DoubleSide, GreaterDepth, NotEqualStencilFunc, ReplaceStencilOp, Group, LineSegments, Mesh, MeshStandardMaterial, ShaderMaterial } from 'three';
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
    this.group.add(mesh, this.ghostGroup);
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
}
