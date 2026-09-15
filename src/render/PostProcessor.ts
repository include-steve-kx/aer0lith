import {
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

export class PostProcessor {
  private readonly renderer: WebGLRenderer;
  private readonly effectScene = new Scene();
  private readonly glowScene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly glowMaterial: ShaderMaterial;
  private target: WebGLRenderTarget;
  private processedTarget: WebGLRenderTarget;
  private width = 1;
  private height = 1;
  private scale = 1;
  private crtEnabled = true;
  private glowEnabled = true;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.target = this.createTarget(1, 1);
    this.processedTarget = this.createTarget(1, 1);
    this.material = new ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uResolution: { value: new Vector2(1, 1) },
        uTime: { value: 0 },
        uCrash: { value: 0 },
        uCrtEnabled: { value: 1 },
        uCurvature: { value: 0.022 },
        uRgbMaskStrength: { value: 1 },
        uScanlineStrength: { value: 1 },
        uGrainStrength: { value: 1 },
        uVignetteStrength: { value: 1 },
        uChromaticStrength: { value: 1 },
        uDitherStrength: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 uResolution;
        uniform float uTime;
        uniform float uCrash;
        uniform float uCrtEnabled;
        uniform float uCurvature;
        uniform float uRgbMaskStrength;
        uniform float uScanlineStrength;
        uniform float uGrainStrength;
        uniform float uVignetteStrength;
        uniform float uChromaticStrength;
        uniform float uDitherStrength;
        varying vec2 vUv;
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float bayer(vec2 p) {
          vec2 f = mod(floor(p), 4.0);
          return mod(f.x + f.y * 2.0, 4.0) / 4.0;
        }
        void main() {
          vec2 curved = vUv * 2.0 - 1.0;
          curved *= 1.0 + dot(curved, curved) * uCurvature * uCrtEnabled;
          vec2 uv = curved * 0.5 + 0.5;
          if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            return;
          }
          if (uCrash > 0.0) {
            float band = step(0.72, hash(vec2(floor(uv.y * 37.0), floor(uTime * 22.0))));
            uv.x += (hash(vec2(floor(uv.y * 58.0), uTime)) - 0.5) * 0.045 * uCrash * band;
          }
          vec2 texel = 1.0 / uResolution;
          vec2 aberration = vec2(
            texel.x * (0.58 * uChromaticStrength * uCrtEnabled + 3.2 * uCrash),
            0.0
          );
          vec3 color;
          color.r = texture2D(tDiffuse, uv + aberration).r;
          color.g = texture2D(tDiffuse, uv).g;
          color.b = texture2D(tDiffuse, uv - aberration).b;
          float scanWave = sin(uv.y * uResolution.y * 3.14159);
          float scan = 1.0 - 0.12 * uScanlineStrength * uCrtEnabled * (1.0 - scanWave);
          float phosphorColumn = mod(floor(uv.x * uResolution.x), 3.0);
          vec3 phosphor = vec3(0.82);
          if (phosphorColumn < 1.0) phosphor.r = 1.24;
          else if (phosphorColumn < 2.0) phosphor.g = 1.24;
          else phosphor.b = 1.24;
          phosphor = vec3(1.0) + (phosphor - vec3(1.0)) * uRgbMaskStrength * uCrtEnabled;
          float grainTime = floor(uTime * 18.0);
          float grain = (hash(floor(uv * uResolution) + grainTime) - 0.5)
            * 0.022 * uGrainStrength * uCrtEnabled;
          float dither = (bayer(gl_FragCoord.xy) - 0.5) / 110.0
            * uDitherStrength * uCrtEnabled;
          vec2 edge = uv * (1.0 - uv);
          float vignette = clamp(pow(16.0 * edge.x * edge.y, 0.13), 0.0, 1.0);
          float vignetteFactor = 1.0
            - (1.0 - (0.82 + vignette * 0.18)) * uVignetteStrength * uCrtEnabled;
          color = (color * scan * phosphor + grain + dither) * vignetteFactor;
          color += vec3(0.3, 0.0, 0.14) * uCrash * step(0.84, hash(vec2(floor(uv.y * 80.0), grainTime)));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.effectScene.add(new Mesh(new PlaneGeometry(2, 2), this.material));
    this.glowMaterial = new ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.processedTarget.texture },
        uTexel: { value: new Vector2(1, 1) },
        uGlowStrength: { value: 3 },
        uGlowRadius: { value: 3 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 uTexel;
        uniform float uGlowStrength;
        uniform float uGlowRadius;
        varying vec2 vUv;
        vec3 glowSample(vec2 offset) {
          vec3 sampleColor = texture2D(tDiffuse, vUv + offset * uTexel).rgb;
          float signal = smoothstep(0.22, 0.76, max(sampleColor.r, max(sampleColor.g, sampleColor.b)));
          return sampleColor * signal;
        }
        void main() {
          vec3 base = texture2D(tDiffuse, vUv).rgb;
          vec3 nearGlow =
            glowSample(vec2(2.0, 0.0) * uGlowRadius) + glowSample(vec2(-2.0, 0.0) * uGlowRadius) +
            glowSample(vec2(0.0, 2.0) * uGlowRadius) + glowSample(vec2(0.0, -2.0) * uGlowRadius) +
            glowSample(vec2(1.5, 1.5) * uGlowRadius) + glowSample(vec2(-1.5, 1.5) * uGlowRadius) +
            glowSample(vec2(1.5, -1.5) * uGlowRadius) + glowSample(vec2(-1.5, -1.5) * uGlowRadius);
          vec3 wideGlow =
            glowSample(vec2(5.0, 0.0) * uGlowRadius) + glowSample(vec2(-5.0, 0.0) * uGlowRadius) +
            glowSample(vec2(0.0, 5.0) * uGlowRadius) + glowSample(vec2(0.0, -5.0) * uGlowRadius);
          vec3 color = base + (nearGlow * 0.064 + wideGlow * 0.03) * uGlowStrength;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.glowScene.add(new Mesh(new PlaneGeometry(2, 2), this.glowMaterial));
  }

  private createTarget(width: number, height: number): WebGLRenderTarget {
    const target = new WebGLRenderTarget(width, height, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
    });
    return target;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const pixelRatio = this.renderer.getPixelRatio();
    const renderWidth = Math.max(1, Math.floor(width * pixelRatio * this.scale));
    const renderHeight = Math.max(1, Math.floor(height * pixelRatio * this.scale));
    this.target.setSize(renderWidth, renderHeight);
    this.processedTarget.setSize(renderWidth, renderHeight);
    this.material.uniforms.uResolution.value.set(renderWidth, renderHeight);
    this.glowMaterial.uniforms.uTexel.value.set(1 / renderWidth, 1 / renderHeight);
  }

  setScale(scale: number): void {
    const next = Math.max(0.65, Math.min(1, scale));
    if (Math.abs(next - this.scale) < 0.01) return;
    this.scale = next;
    this.resize(this.width, this.height);
  }

  setGlowSettings(enabled: boolean, strength: number, radius: number): void {
    this.glowEnabled = enabled;
    this.glowMaterial.uniforms.uGlowStrength.value = enabled ? strength : 0;
    this.glowMaterial.uniforms.uGlowRadius.value = radius;
  }

  setCrtSettings(
    enabled: boolean,
    curvature: number,
    rgbMask: number,
    scanlines: number,
    grain: number,
    vignette: number,
    chromatic: number,
    dither: number,
  ): void {
    this.crtEnabled = enabled;
    this.material.uniforms.uCrtEnabled.value = enabled ? 1 : 0;
    this.material.uniforms.uCurvature.value = curvature;
    this.material.uniforms.uRgbMaskStrength.value = rgbMask;
    this.material.uniforms.uScanlineStrength.value = scanlines;
    this.material.uniforms.uGrainStrength.value = grain;
    this.material.uniforms.uVignetteStrength.value = vignette;
    this.material.uniforms.uChromaticStrength.value = chromatic;
    this.material.uniforms.uDitherStrength.value = dither;
  }

  render(scene: Scene, camera: OrthographicCamera | import('three').PerspectiveCamera, time: number, crash: number): void {
    if (!this.crtEnabled && !this.glowEnabled && crash <= 0 && this.scale >= 0.999) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uCrash.value = crash;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(this.processedTarget);
    this.renderer.render(this.effectScene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.glowScene, this.camera);
  }
}
