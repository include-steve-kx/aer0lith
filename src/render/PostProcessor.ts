import type { RefractionContributor } from '../combat/types.ts';
import { PROBE } from '../core/config.ts';
import {
  Color,
  DepthTexture,
  DepthStencilFormat,
  UnsignedInt248Type,
  Matrix4,
  Vector3,
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
import { ScanGlass } from './ScanGlass.ts';
import { motionBlurExposure, motionBlurStreak } from './MotionBlur.ts';
import type { FlightEffects } from './FlightEffects.ts';

export class PostProcessor {
  private readonly renderer: WebGLRenderer;
  private readonly effectScene = new Scene();
  private readonly glowScene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;
  private readonly glowMaterial: ShaderMaterial;
  private target: WebGLRenderTarget;
  private processedTarget: WebGLRenderTarget;
  private readonly wakeTarget: WebGLRenderTarget;
  private readonly crystalTarget: WebGLRenderTarget;
  private readonly savedClearColor = new Color();
  private readonly neutralRefraction = new Color(128 / 255, 128 / 255, 0);
  private width = 1;
  private height = 1;
  private scale = 1;
  private crtEnabled = true;
  private glowEnabled = true;
  private motionBlurEnabled = true;
  private motionBlurStrength = 0.45;
  private motionBlurStartSpeed = 20;
  private readonly scanGlass = new ScanGlass();
  private disposed = false;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.target = this.createTarget(1, 1);
    this.processedTarget = this.createTarget(1, 1);
    this.target.stencilBuffer = true;
    this.target.depthTexture = new DepthTexture(1, 1, UnsignedInt248Type);
    this.target.depthTexture.format = DepthStencilFormat;
    // Keep the established glass effects on their original single-output
    // framebuffer. Their shaders only declare location 0 and must never be
    // rendered while a second color attachment is active.
    this.wakeTarget = this.createTarget(1, 1);
    this.wakeTarget.texture.name = 'refraction-vectors';
    this.wakeTarget.depthTexture = new DepthTexture(1, 1);
    // Crystal owns this MRT target: its shader explicitly writes both
    // attachments, so there are no undefined outputs from legacy glass.
    this.crystalTarget = this.createTarget(1, 1, 2);
    this.crystalTarget.textures[0].name = 'crystal-refraction-vectors';
    this.crystalTarget.textures[1].name = 'crystal-body';
    this.crystalTarget.depthTexture = new DepthTexture(1, 1);
    this.material = new ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uResolution: { value: new Vector2(1, 1) },
        tDepth: { value: this.target.depthTexture },
        tWake: { value: this.wakeTarget.texture },
        tWakeDepth: { value: this.wakeTarget.depthTexture },
        tCrystalWake: { value: this.crystalTarget.textures[0] },
        tCrystalBody: { value: this.crystalTarget.textures[1] },
        tCrystalDepth: { value: this.crystalTarget.depthTexture },
        uWakeEnabled: { value: 0 },
        uCrystalEnabled: { value: 0 },
        uProjection: { value: new Matrix4() },
        uProjectionInverse: { value: new Matrix4() },
        uTravelView: { value: new Vector3() },
        uShipView: { value: new Vector3() },
        uBlurLimit: { value: 12 },
        uBlurPixels: { value: 0 },
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
        uniform sampler2D tDepth;
        uniform sampler2D tWake, tWakeDepth;
        uniform sampler2D tCrystalWake, tCrystalBody, tCrystalDepth;
        uniform float uWakeEnabled, uCrystalEnabled;
        uniform mat4 uProjection;
        uniform mat4 uProjectionInverse;
        uniform vec3 uTravelView;
        uniform vec3 uShipView;
        uniform float uBlurLimit;
        uniform float uBlurPixels;
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
        vec3 viewPosition(vec2 uv, float depth) {
          vec4 p = uProjectionInverse * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
          return p.xyz / p.w;
        }
        float shipMask(vec3 p, float depth) {
          return depth < 0.99999 ? smoothstep(7.0, 9.0, distance(p, uShipView)) : 1.0;
        }
        vec3 motionSample(vec2 uv) {
          vec3 center = texture2D(tDiffuse, uv).rgb;
          if (uBlurLimit <= 0.0 || dot(uTravelView, uTravelView) < 0.0000001) return center;
          float depth = texture2D(tDepth, uv).x;
          vec3 p = viewPosition(uv, depth);
          // The dot renderer has gaps with no depth. A modest proxy distance
          // lets bright dots extend into those gaps rather than merely dimming.
          if (depth >= 0.99999) p *= 80.0 / max(0.001, -p.z);
          float mask = shipMask(p, depth);
          vec4 previous = uProjection * vec4(p + uTravelView, 1.0);
          if (previous.w <= 0.001 || mask < 0.001) return center;
          vec2 streak = uv - (previous.xy / previous.w * 0.5 + 0.5);
          // Physical reprojection alone is subpixel over most of this large
          // world. Give it a speed-dependent screen-space floor, retaining
          // its direction, depth response, sharp ship, and clear center.
          float pixels = length(streak * uResolution);
          if (pixels < 0.0001) return center;
          float limit = uBlurLimit * uResolution.y / 1080.0;
          float minimum = uBlurPixels * uResolution.y / 1080.0;
          streak *= min(limit, max(pixels, minimum)) / pixels;
          streak *= mask * smoothstep(0.10, 0.65, length(uv - 0.5) * 1.7);
          vec3 total = center;
          float weight = 1.0;
          for (int i = 0; i < 12; i++) {
            float t = (float(i) + 0.5) / 12.0 - 0.5;
            vec2 sampleUv = clamp(uv + streak * t, vec2(0.001), vec2(0.999));
            float sampleDepth = texture2D(tDepth, sampleUv).x;
            float sampleWeight = shipMask(viewPosition(sampleUv, sampleDepth), sampleDepth);
            sampleWeight *= 1.0 - abs(t);
            total += texture2D(tDiffuse, sampleUv).rgb * sampleWeight;
            weight += sampleWeight;
          }
          return total / weight;
        }
        vec2 refractedUv(vec2 uv, vec2 offset, float glassDepth) {
          if (dot(offset, offset) < 0.000000000001) return uv;
          vec2 candidate = clamp(uv + offset, 0.5 / uResolution, 1.0 - 0.5 / uResolution);
          // Reject a displaced sample that would pull foreground geometry into
          // the wake, especially the ship's sharp wing silhouette.
          return texture2D(tDepth, candidate).r < glassDepth - 0.000001 ? uv : candidate;
        }
        vec2 glassOffset(vec4 glass) {
          return ((glass.rg * 255.0 - 128.0) / 127.0) * 84.0
            * (uResolution.y / 1080.0) / uResolution;
        }
        float glassSheen(vec4 glass) {
          return max(0.0, (glass.a * 255.0 - 1.0) / 254.0);
        }
        vec3 applyGlassOptics(
          vec3 color,
          vec2 surfaceUv,
          vec2 centerUv,
          vec2 offset,
          float dispersion,
          float sheen,
          float depth
        ) {
          if (dispersion > 0.001) {
            vec3 base = texture2D(tDiffuse, centerUv).rgb;
            color.r += texture2D(
              tDiffuse, refractedUv(surfaceUv, offset * (1.0 + dispersion), depth)
            ).r - base.r;
            color.b += texture2D(
              tDiffuse, refractedUv(surfaceUv, offset * (1.0 - dispersion), depth)
            ).b - base.b;
          }
          return mix(color, vec3(0.8, 0.9, 1.0), sheen);
        }
        vec3 resolveWakeBehind(vec2 surfaceUv, float frontDepth) {
          if (uWakeEnabled < 0.5) return motionSample(surfaceUv);
          vec4 wake = texture2D(tWake, surfaceUv);
          if (wake.a <= 0.001) return motionSample(surfaceUv);
          float depth = texture2D(tWakeDepth, surfaceUv).r;
          if (depth <= frontDepth + 0.000001) return motionSample(surfaceUv);
          vec2 offset = glassOffset(wake);
          vec2 centerUv = refractedUv(surfaceUv, offset, depth);
          return applyGlassOptics(
            motionSample(centerUv), surfaceUv, centerUv, offset,
            wake.b, glassSheen(wake), depth
          );
        }
        vec3 resolveCrystalBehind(vec2 surfaceUv, float frontDepth) {
          if (uCrystalEnabled < 0.5) return motionSample(surfaceUv);
          vec4 crystalWake = texture2D(tCrystalWake, surfaceUv);
          if (crystalWake.a <= 0.001) return motionSample(surfaceUv);
          float depth = texture2D(tCrystalDepth, surfaceUv).r;
          if (depth <= frontDepth + 0.000001) return motionSample(surfaceUv);
          vec2 offset = glassOffset(crystalWake);
          vec2 centerUv = refractedUv(surfaceUv, offset, depth);
          vec3 color = applyGlassOptics(
            motionSample(centerUv), surfaceUv, centerUv, offset,
            crystalWake.b, glassSheen(crystalWake), depth
          );
          vec4 body = texture2D(tCrystalBody, surfaceUv);
          return body.a > 0.001 ? mix(color, body.rgb, body.a) : color;
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
          vec2 originalUv = uv;
          vec4 wake = vec4(0.0);
          vec4 crystalWake = vec4(0.0);
          float wakeDepth = 1.0;
          float crystalDepth = 1.0;
          bool hasWake = false;
          bool hasCrystal = false;
          if (uWakeEnabled > 0.5) {
            wake = texture2D(tWake, originalUv);
            hasWake = wake.a > 0.001;
            if (hasWake) wakeDepth = texture2D(tWakeDepth, originalUv).r;
          }
          if (uCrystalEnabled > 0.5) {
            crystalWake = texture2D(tCrystalWake, originalUv);
            hasCrystal = crystalWake.a > 0.001;
            if (hasCrystal) crystalDepth = texture2D(tCrystalDepth, originalUv).r;
          }
          vec3 color;
          if (hasWake && (!hasCrystal || wakeDepth <= crystalDepth)) {
            vec2 offset = glassOffset(wake);
            uv = refractedUv(originalUv, offset, wakeDepth);
            color = resolveCrystalBehind(uv, wakeDepth);
            color = applyGlassOptics(
              color, originalUv, uv, offset, wake.b, glassSheen(wake), wakeDepth
            );
          } else if (hasCrystal) {
            vec2 offset = glassOffset(crystalWake);
            uv = refractedUv(originalUv, offset, crystalDepth);
            color = resolveWakeBehind(uv, crystalDepth);
            color = applyGlassOptics(
              color, originalUv, uv, offset, crystalWake.b,
              glassSheen(crystalWake), crystalDepth
            );
            vec4 crystalBody = texture2D(tCrystalBody, originalUv);
            if (crystalBody.a > 0.001) {
              color = mix(color, crystalBody.rgb, crystalBody.a);
            }
          } else {
            color = motionSample(originalUv);
          }
          vec3 base = texture2D(tDiffuse, uv).rgb;
          color.r += texture2D(tDiffuse, uv + aberration).r - base.r;
          color.b += texture2D(tDiffuse, uv - aberration).b - base.b;
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
        uNativeOutput: { value: 0 },
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
        uniform float uNativeOutput;
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
          // Match the native renderer when motion blur is the only effect.
          // Keep the existing CRT/glow presentation's tonal response intact.
          if (uNativeOutput > 0.5) {
            #include <colorspace_fragment>
          }
        }
      `,
    });
    this.glowScene.add(new Mesh(new PlaneGeometry(2, 2), this.glowMaterial));
  }

  private createTarget(width: number, height: number, count = 1): WebGLRenderTarget {
    const target = new WebGLRenderTarget(width, height, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
      count,
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
    this.wakeTarget.setSize(renderWidth, renderHeight);
    this.crystalTarget.setSize(renderWidth, renderHeight);
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

  setMotionBlurSettings(enabled: boolean, strength: number, startSpeed: number, maxPixels: number): void {
    this.motionBlurEnabled = enabled;
    this.motionBlurStrength = strength;
    this.motionBlurStartSpeed = startSpeed;
    this.material.uniforms.uBlurLimit.value = Math.max(0, Math.min(32, maxPixels));
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

  setScanSettings(
    enabled: boolean,
    strength: number,
    dispersion: number,
    fadeDuration = 0.8,
    flutter = 0.04,
    flutterRate = 1,
    speed: number = PROBE.speed,
  ): void {
    this.scanGlass.configure(
      enabled,
      strength,
      dispersion,
      fadeDuration,
      flutter,
      flutterRate,
      speed,
    );
  }

  setScanWave(worldCenter: Vector3, origin: Vector3, radius: number, expanding: boolean): void {
    this.scanGlass.sync(worldCenter, origin, radius, expanding);
  }

  render(scene: Scene, camera: OrthographicCamera | import('three').PerspectiveCamera, time: number, crash: number,
    velocity = new Vector3(), shipPosition = new Vector3(), flightEffects?: FlightEffects,
    contributors: readonly RefractionContributor[] = [], crystalContributor?: RefractionContributor): void {
    const wakeActive = flightEffects?.hasWake ?? false;
    const glassActive = wakeActive || this.scanGlass.active || contributors.some(c => c.active);
    const crystalActive = crystalContributor?.active ?? false;
    const refractionActive = glassActive || crystalActive;
    this.material.uniforms.uWakeEnabled.value = glassActive ? 1 : 0;
    this.material.uniforms.uCrystalEnabled.value = crystalActive ? 1 : 0;
    const exposure = this.motionBlurEnabled
      ? motionBlurExposure(velocity.length(), this.motionBlurStrength, this.motionBlurStartSpeed) : 0;
    this.material.uniforms.uBlurPixels.value = this.motionBlurEnabled
      ? motionBlurStreak(velocity.length(), this.motionBlurStrength, this.motionBlurStartSpeed) : 0;
    this.glowMaterial.uniforms.uNativeOutput.value = !this.crtEnabled && !this.glowEnabled && crash <= 0 ? 1 : 0;
    camera.updateMatrixWorld();
    this.material.uniforms.uProjection.value.copy(camera.projectionMatrix);
    this.material.uniforms.uProjectionInverse.value.copy(camera.projectionMatrixInverse);
    this.material.uniforms.uShipView.value.copy(shipPosition).applyMatrix4(camera.matrixWorldInverse);
    this.material.uniforms.uTravelView.value.copy(velocity)
      .transformDirection(camera.matrixWorldInverse).multiplyScalar(velocity.length() * exposure);
    // Keep one linear scene/output path even when effects are disabled. Native
    // rendering mixes fog in output color space, which otherwise changes the
    // entire scene's brightness when the local refraction pass is toggled.
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uCrash.value = crash;
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    if (refractionActive) {
      this.renderer.getClearColor(this.savedClearColor);
      const clearAlpha = this.renderer.getClearAlpha();
      const autoClear = this.renderer.autoClear;
      try {
        this.renderer.setClearColor(this.neutralRefraction, 0);
        this.renderer.autoClear = false;
        if (glassActive) {
          this.renderer.setRenderTarget(this.wakeTarget);
          this.renderer.clear();
          if (this.scanGlass.active) {
            this.scanGlass.prepare(this.target.depthTexture!, this.wakeTarget.width, this.wakeTarget.height, time);
            this.renderer.render(this.scanGlass.scene, camera);
          }
          if (wakeActive && flightEffects) {
            flightEffects.prepareWake(this.target.depthTexture!, this.wakeTarget.width, this.wakeTarget.height);
            this.renderer.render(flightEffects.wakeScene, camera);
          }
          for (const contributor of contributors) {
            if (!contributor.active) continue;
            contributor.prepare(this.target.depthTexture!, this.wakeTarget.width, this.wakeTarget.height, time);
            this.renderer.render(contributor.scene, camera);
          }
        }
        if (crystalActive && crystalContributor) {
          this.renderer.setRenderTarget(this.crystalTarget);
          this.renderer.clear();
          crystalContributor.prepare(
            this.target.depthTexture!, this.crystalTarget.width, this.crystalTarget.height, time,
          );
          this.renderer.render(crystalContributor.scene, camera);
        }
      } finally {
        this.renderer.autoClear = autoClear;
        this.renderer.setClearColor(this.savedClearColor, clearAlpha);
      }
    }
    this.renderer.setRenderTarget(this.processedTarget);
    this.renderer.render(this.effectScene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.glowScene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scanGlass.dispose();
    for (const scene of [this.effectScene, this.glowScene]) {
      for (const child of scene.children) if (child instanceof Mesh) child.geometry.dispose();
      scene.clear();
    }
    this.material.dispose();
    this.glowMaterial.dispose();
    this.target.dispose();
    this.processedTarget.dispose();
    this.wakeTarget.dispose();
    this.crystalTarget.dispose();
  }

}
