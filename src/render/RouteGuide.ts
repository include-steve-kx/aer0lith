import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Line,
  ShaderMaterial,
  Vector3,
} from 'three';
import { PALETTE } from '../core/config.ts';
import type { ProceduralTerrain } from '../world/TerrainModel.ts';

const GUIDE_STEP = 8;
const GUIDE_POINTS = 201;
const GUIDE_BLOCK_LENGTH = 1024;

export class RouteGuide {
  readonly line: Line;
  private readonly positions = new Float32Array(GUIDE_POINTS * 3);
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly terrain: ProceduralTerrain;
  private targetOpacity = 1;
  private presentationVisible = true;
  private routeBlock = Number.NaN;
  private readonly lastOrigin = new Vector3(Number.POSITIVE_INFINITY, 0, 0);

  constructor(terrain: ProceduralTerrain) {
    this.terrain = terrain;
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.material = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(PALETTE.gold) },
        uOpacity: { value: 0 },
        uAircraftZ: { value: 0 },
        fogColor: { value: new Color(PALETTE.fog) },
        fogDensity: { value: 0.00165 },
      },
      transparent: true,
      depthWrite: false,
      fog: true,
      vertexShader: `
        #include <fog_pars_vertex>
        uniform float uAircraftZ;
        uniform float uOpacity;
        varying float vAlpha;
        void main() {
          vec4 renderWorld = modelMatrix * vec4(position, 1.0);
          float ahead = renderWorld.z - uAircraftZ;
          vAlpha = smoothstep(12.0, 58.0, ahead) * uOpacity;
          vec4 mvPosition = viewMatrix * renderWorld;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <fog_pars_fragment>
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          if (vAlpha < 0.002) discard;
          gl_FragColor = vec4(uColor, vAlpha);
          #include <fog_fragment>
        }
      `,
    });
    this.line = new Line(this.geometry, this.material);
    this.line.frustumCulled = false;
  }

  update(worldPosition: Vector3, origin: Vector3): void {
    const nextBlock = Math.floor(worldPosition.z / GUIDE_BLOCK_LENGTH);
    const startZ = nextBlock * GUIDE_BLOCK_LENGTH - GUIDE_STEP * 16;
    if (nextBlock === this.routeBlock && origin.equals(this.lastOrigin)) return;
    this.routeBlock = nextBlock;
    this.lastOrigin.copy(origin);
    for (let index = 0; index < GUIDE_POINTS; index += 1) {
      const z = startZ + index * GUIDE_STEP;
      const path = this.terrain.sample(z);
      const offset = index * 3;
      this.positions[offset] = path.x - origin.x;
      this.positions[offset + 1] = path.y - origin.y;
      this.positions[offset + 2] = z - origin.z;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }

  updateAircraftPosition(renderPosition: Vector3): void {
    this.material.uniforms.uAircraftZ.value = renderPosition.z;
  }

  setColor(color: string): void {
    (this.material.uniforms.uColor.value as Color).set(color);
  }

  setAutopilotActive(active: boolean): void {
    this.targetOpacity = active ? 0.82 : 0;
  }

  setPresentationVisible(visible: boolean): void {
    this.presentationVisible = visible;
    this.line.visible = visible && this.material.uniforms.uOpacity.value > 0.005;
  }

  animate(dt: number): void {
    const smoothing = 1 - Math.exp(-dt / 0.42);
    const opacity = this.material.uniforms.uOpacity.value as number;
    this.material.uniforms.uOpacity.value = opacity + (this.targetOpacity - opacity) * smoothing;
    this.line.visible = this.presentationVisible && this.material.uniforms.uOpacity.value > 0.005;
  }
}
