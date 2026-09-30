import { Color, EdgesGeometry, GreaterDepth, NotEqualStencilFunc, ReplaceStencilOp, Group, LineSegments, Mesh, MeshStandardMaterial, ShaderMaterial } from 'three';
import { PALETTE } from '../core/config.ts';
import { createAircraftGeometry } from './createAircraftGeometry.ts';

export class AircraftView {
  readonly group = new Group();
  private readonly bodyMaterial = new MeshStandardMaterial({
    color: PALETTE.plane, roughness: 0.78, metalness: 0.12, flatShading: true,
    stencilWrite: true, stencilRef: 1, stencilZPass: ReplaceStencilOp,
  });

  private readonly ghostGroup = new Group();
  private readonly ghostMaterial = new ShaderMaterial({
    uniforms: { uColor: { value: new Color('#fff0a3') }, uOpacity: { value: 0.13 } },
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
        float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(-vView))), 2.0);
        float facet = 0.78 + 0.22 * abs(dot(normalize(vNormal), normalize(vec3(0.4, 0.8, 0.5))));
        gl_FragColor = vec4(uColor * facet, uOpacity * (1.25 + 0.2 * rim));
      }`,
    transparent: true, depthWrite: false, depthFunc: GreaterDepth,
    stencilWrite: true, stencilWriteMask: 0, stencilFunc: NotEqualStencilFunc, stencilRef: 1,
  });
  private readonly outlineMaterial = new ShaderMaterial({
    uniforms: { uColor: { value: new Color('#d7e2e6') }, uOpacity: { value: 0.42 } },
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

  constructor() {
    this.group.name = 'Lance / minimal X-wing';
    const geometry = createAircraftGeometry();
    const mesh = new Mesh(geometry, this.bodyMaterial);
    mesh.name = 'monochrome hull and four blades';
    // World opaque geometry first; mark only the ship fragments that are visible.
    mesh.renderOrder = 1;
    this.group.add(mesh, this.ghostGroup);
    const ghost = new Mesh(geometry, this.ghostMaterial);
    const outline = new LineSegments(new EdgesGeometry(geometry, 18), this.outlineMaterial);
    ghost.name = 'occluded ship silhouette'; outline.name = 'occluded ship edges';
    ghost.renderOrder = 8; outline.renderOrder = 9;
    this.ghostGroup.add(ghost, outline);
  }

  setColor(value: string): void {
    this.bodyMaterial.color.set(value);
  }

  setOcclusionSettings(enabled: boolean, opacity: number): void {
    this.ghostGroup.visible = enabled && opacity > 0;
    this.ghostMaterial.uniforms.uOpacity.value = opacity;
    this.outlineMaterial.uniforms.uOpacity.value = Math.min(0.8, opacity * 3.2);
  }

  setCockpitMode(active: boolean): void {
    this.group.visible = !active;
  }
}
