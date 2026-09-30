import { explosionImpulse } from './combat/ExplosionForce.ts';
import { BulletSystem } from './combat/BulletSystem.ts';
import { BulletView } from './combat/BulletView.ts';
import { RockLibrary } from './combat/geometry.ts';
import { MeteorSystem } from './combat/MeteorSystem.ts';
import { MissileSystem } from './combat/MissileSystem.ts';
import { ImpactSystem } from './combat/ImpactSystem.ts';
import { CombatView } from './combat/CombatView.ts';
import { CombatHud } from './ui/CombatHud.ts';
import type { ScanSnapshot, RefractionContributor } from './combat/types.ts';
import {
  AmbientLight,
  Color,
  DirectionalLight,
  FogExp2,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { AudioEngine } from './audio/AudioEngine.ts';
import { FLIGHT, PALETTE, TERRAIN } from './core/config.ts';
import type { CameraMode, ExperienceMode, FlightSnapshot } from './core/types.ts';
import { FlightController } from './flight/FlightController.ts';
import { InputManager } from './flight/InputManager.ts';
import { CockpitRoll } from './render/CockpitRoll.ts';
import { BoostCameraShake } from './render/BoostCameraShake.ts';
import { FlightEffects } from './render/FlightEffects.ts';
import { AircraftView } from './render/AircraftView.ts';
import { CameraRig } from './render/CameraRig.ts';
import { CollisionDebugView } from './render/CollisionDebugView.ts';
import { PostProcessor } from './render/PostProcessor.ts';
import { RouteGuide } from './render/RouteGuide.ts';
import { TrailView } from './render/TrailView.ts';
import { WindView } from './render/WindView.ts';
import { Hud } from './ui/Hud.ts';
import { SettingsPanel } from './ui/SettingsPanel.ts';
import { bindButtonAction } from './ui/bindButtonAction.ts';
import { ProceduralTerrain } from './world/TerrainModel.ts';
import { TerrainManager } from './world/TerrainManager.ts';
import { ProbeScheduler } from './world/ProbeScheduler.ts';
import { FlockSystem } from './world/FlockSystem.ts';

export class App {
  private readonly root: HTMLElement;
  private readonly sceneElement: HTMLElement;
  private readonly seed: string;
  private readonly scene = new Scene();
  private readonly renderer: WebGLRenderer;
  private readonly terrainModel: ProceduralTerrain;
  private readonly terrain: TerrainManager;
  private readonly rocks: RockLibrary;
  private readonly meteors: MeteorSystem;
  private readonly missiles: MissileSystem;
  private readonly bullets: BulletSystem;
  private readonly bulletView: BulletView;
  private readonly explosionImpulse = new Vector3();
  private readonly impacts: ImpactSystem;
  private readonly combatView: CombatView;
  private readonly combatHud = new CombatHud();
  private readonly refractionContributors: RefractionContributor[];
  private readonly scan: ScanSnapshot = { id: 0, center: new Vector3(), previousRadius: 0, radius: 0, expanding: false };
  private crtCurvature = 0;
  private readonly flocks: FlockSystem;
  private readonly flight: FlightController;
  private readonly aircraft = new AircraftView();
  private readonly flightEffects = new FlightEffects();
  private readonly cockpitRoll = new CockpitRoll();
  private readonly boostShake = new BoostCameraShake();
  private readonly collisionDebug = new CollisionDebugView();
  private readonly trail = new TrailView();
  private readonly wind = new WindView();
  private readonly route: RouteGuide;
  private readonly cameraRig: CameraRig;
  private readonly post: PostProcessor;
  private readonly hud = new Hud();
  private readonly settings = new SettingsPanel();
  private readonly audio = new AudioEngine();
  private readonly input: InputManager;
  private readonly probeScheduler = new ProbeScheduler();
  private readonly renderOrigin = new Vector3();
  private readonly renderPlanePosition = new Vector3();
  private readonly originShift = new Vector3();
  private readonly blurVelocity = new Vector3();
  private accumulator = 0;
  private lastTime = performance.now();
  private elapsed = 0;
  private lastHudUpdate = 0;
  private lastRouteUpdate = -1;
  private frameAverage = 60;
  private qualityTimer = 0;
  private resolutionMode: 'full' | 'balanced' | 'adaptive' = 'full';
  private adaptiveRenderScale = 1;
  private running = true;
  private paused = false;
  private renderElapsed = 0;
  private throttleActive = false;
  private experienceMode: ExperienceMode = 'analysis';
  private collisionDebugEnabled = false;

  constructor(root: HTMLElement, seed: string) {
    this.root = root;
    this.seed = seed;
    this.updateInputLayout();
    const sceneElement = document.getElementById('scene');
    if (!sceneElement) throw new Error('Missing scene mount');
    this.sceneElement = sceneElement;

    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(PALETTE.background, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.sceneElement.append(this.renderer.domElement);

    this.scene.background = new Color(PALETTE.background);
    this.scene.fog = new FogExp2(PALETTE.fog, 0.00165);
    this.scene.add(new AmbientLight(PALETTE.terrainPoints, 1.0));
    const keyLight = new DirectionalLight(PALETTE.offWhite, 1.7);
    keyLight.position.set(-80, 145, -60);
    this.scene.add(keyLight);
    const rimLight = new DirectionalLight(PALETTE.offWhite, 0.32);
    rimLight.position.set(120, 40, 180);
    this.scene.add(rimLight);

    this.terrainModel = new ProceduralTerrain(seed);
    this.terrain = new TerrainManager(this.scene, this.terrainModel);
    this.flocks = new FlockSystem(this.scene, this.terrainModel, seed);
    this.flight = new FlightController(this.terrainModel);
    this.rocks = new RockLibrary(seed);
    this.meteors = new MeteorSystem(this.terrainModel, this.rocks, seed);
    this.impacts = new ImpactSystem(this.rocks, seed);
    this.missiles = new MissileSystem(this.meteors, seed);
    this.combatView = new CombatView(this.meteors, this.missiles, this.impacts);
    this.bullets = new BulletSystem(this.meteors, seed);
    this.bulletView = new BulletView(this.bullets);
    this.meteors.onDestroyed = (rock, point, direction) => {
      this.impacts.spawn(rock, point, direction);
      const settings = this.impacts.settings;
      explosionImpulse(this.explosionImpulse, this.flight.position, point, direction,
        rock.diameter, settings.explosionPush, settings.explosionShakeRadius);
      this.flight.applyExternalImpulse(this.explosionImpulse, settings.explosionPushLife);
    };
    this.refractionContributors = [this.combatView, this.bulletView];
    this.flight.obstacles = this.meteors;
    this.flight.onRecovery = () => this.resetCombat();
    this.route = new RouteGuide(this.terrainModel);
    this.cameraRig = new CameraRig(window.innerWidth / window.innerHeight, this.renderer.domElement);
    this.post = new PostProcessor(this.renderer);

    this.scene.add(this.cameraRig.camera);
    this.scene.add(
      this.combatView.group, this.bulletView.group,
      this.aircraft.group,
      this.flightEffects.group,
      this.flightEffects.debugGroup,
      this.collisionDebug.group,
      this.trail.group,
      this.route.line,
      this.wind.group,
    );
    this.terrain.update(this.flight.position, this.renderOrigin);
    this.route.update(this.flight.position, this.renderOrigin);
    this.trail.add(this.flight.position, this.flight.orientation, this.renderOrigin, true);

    this.flight.onCrash = () => {
      this.resetCombat();
      this.audio.crash();
      this.flightEffects.reset();
      this.input.boost.reset();
    };
    this.flight.onModeChange = () => {
      this.audio.beep(this.flight.mode === 'autopilot' ? 690 : 510, 0.045);
    };
    this.cameraRig.onChange = () => this.audio.beep(760, 0.035);

    this.input = new InputManager(root, {
      onRoll: direction => { if (!this.paused) this.flight.startRoll(direction); },
      onManualInput: () => { if (!this.paused) this.flight.takeManualControl(); },
      onToggleAutopilot: () => this.toggleAutopilot(),
      onCycleCamera: () => this.setCamera(this.cameraRig.cycle()),
      onSelectCamera: (index) => this.setCamera(this.cameraRig.select(index)),
      onToggleAudio: () => void this.toggleAudio(),
      onReset: () => this.resetFlight(),
      onPause: () => this.togglePause(),
      onNewSeed: () => this.newSeed(),
      onToggleExperienceMode: () => this.toggleExperienceMode(),
      onToggleFullscreen: () => void this.toggleFullscreen(),
      onTriggerProbe: () => this.triggerProbe(),
    }, {
      fireButton: this.hud.fireButton,
      joystick: this.hud.touchJoystick,
      joystickThumb: this.hud.touchJoystickThumb,
      throttleButton: this.hud.throttleButton,
      rollLeftButton: this.hud.rollLeftButton,
      rollRightButton: this.hud.rollRightButton,
    });

    bindButtonAction(this.hud.cameraButton, () => this.setCamera(this.cameraRig.cycle()));
    bindButtonAction(this.hud.audioButton, () => void this.toggleAudio());
    bindButtonAction(this.hud.seedButton, () => this.newSeed());
    bindButtonAction(this.hud.modeButton, () => this.toggleAutopilot());
    bindButtonAction(this.hud.pauseButton, () => this.togglePause());
    bindButtonAction(this.hud.viewButton, () => this.toggleExperienceMode());
    bindButtonAction(this.hud.fullscreenButton, () => void this.toggleFullscreen());
    bindButtonAction(this.hud.collisionButton, () => this.toggleCollisionDebug());
    bindButtonAction(this.hud.probeButton, () => this.triggerProbe());
    this.settings.onChange = (settings) => {
      if (!settings.meteorEnabled && this.meteors.settings.meteorEnabled) {
        this.missiles.reset(); this.impacts.reset(); this.flight.clearExternalImpulse();
      }
      if (!settings.bulletEnabled) this.input.clearFire();
      if (settings.explosionPush === 0) this.flight.clearExternalImpulse();
      this.bullets.configure(settings);
      this.meteors.configure(settings);
      this.missiles.configure(settings);
      this.impacts.configure(settings);
      this.combatView.configure(settings);
      this.crtCurvature = settings.crtEnabled ? settings.crtCurvature : 0;
      this.setResolutionMode(settings.renderResolutionMode);
      this.terrain.applyVisualSettings(settings);
      const background = new Color(settings.backgroundColor);
      this.scene.background = background;
      this.renderer.setClearColor(background, 1);
      if (this.scene.fog instanceof FogExp2) {
        this.scene.fog.color.copy(background);
        this.scene.fog.density = settings.terrainFogDensity;
      }
      this.aircraft.setColor(settings.planeColor);
      this.aircraft.setOcclusionSettings(settings.shipGhostEnabled, settings.shipGhostOpacity, settings.shipGhostColor);
      this.boostShake.strength = settings.boostShakeStrength;
      this.boostShake.frequency = settings.boostShakeFrequency;
      this.flightEffects.configure(settings);
      this.post.setScanSettings(settings.scanGlassEnabled, settings.scanGlassStrength, settings.scanGlassDispersion, settings.scanGlassPersistence,
        settings.scanGlassFlutter, settings.scanGlassFlutterRate);
      this.route.setColor(settings.autopilotGuideColor);
      this.wind.applyVisualSettings(settings);
      this.flocks.applyVisualSettings(settings);
      this.wind.setAtmosphere(settings.backgroundColor, settings.terrainFogDensity);
      this.post.setCrtSettings(
        settings.crtEnabled,
        settings.crtCurvature,
        settings.crtRgbMask,
        settings.crtScanlines,
        settings.crtGrain,
        settings.crtVignette,
        settings.crtChromatic,
        settings.crtDither,
      );
      this.post.setMotionBlurSettings(settings.motionBlurEnabled, settings.motionBlurStrength,
        settings.motionBlurStartSpeed, settings.motionBlurMaxPixels);
      this.post.setGlowSettings(settings.glowEnabled, settings.glowStrength, settings.glowRadius);
      document.documentElement.dataset.font = settings.fontChoice;
    };
    this.settings.onReset = () => {
      this.collisionDebugEnabled = false;
      this.collisionDebug.group.visible = false;
      this.hud.setCollisionVisible(false);
    };
    this.settings.apply();

    window.addEventListener('resize', this.resize);
    window.addEventListener('pagehide', event => {
      this.input.clearFire();
      if (event.persisted) return; // A back/forward-cache restore reuses this app.
      this.running = false;
      this.resetCombat();
      this.combatView.dispose(); this.bulletView.dispose(); this.bullets.dispose(); this.input.dispose();
      this.rocks.dispose();
      this.combatHud.dispose();
      this.settings.disposeCombatControls();
      this.missiles.dispose();
      this.meteors.dispose();
      this.impacts.dispose();
      this.post.dispose();
      this.flightEffects.dispose();
    });
    document.addEventListener('visibilitychange', () => {
      this.lastTime = performance.now();
      this.accumulator = 0;
    });
    document.addEventListener('fullscreenchange', () => this.hud.setFullscreen(Boolean(document.fullscreenElement)));
    this.resize();
    this.syncViews();
    this.updateHud(60);
    this.root.focus({ preventScroll: true });
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    if (document.hidden) return;
    const rawDelta = Math.min((now - this.lastTime) / 1000, 0.08);
    this.lastTime = now;
    this.renderElapsed += rawDelta;
    if (!this.paused) {
      this.elapsed += rawDelta;
      this.accumulator += rawDelta;
      this.flight.setCockpitCollision(this.cameraRig.mode === 'cockpit');
      const frameInput = this.input.read(this.flight.mode === 'crashed' ? 0 : rawDelta);
      let substeps = 0;
      while (this.accumulator >= FLIGHT.fixedStep && substeps < FLIGHT.maxSubsteps) {
        const dt = FLIGHT.fixedStep;
        if (this.flight.mode !== 'crashed') {
          this.meteors.advance(dt, this.flight.position, this.flight.orientation);
          if (this.probeScheduler.update(dt)) this.triggerProbe();
          this.scan.previousRadius = this.terrain.currentProbeRadius;
          this.scan.expanding = this.terrain.isProbeExpanding;
          this.terrain.updateProbe(dt, this.renderOrigin);
          this.scan.radius = this.terrain.currentProbeRadius;
          this.scan.center.copy(this.terrain.currentProbeWorldCenter);
        }
        this.flight.update(dt, frameInput);
        if (this.flight.mode !== 'crashed') {
          this.meteors.scan(this.scan);
          const resolver = this.bullets.resolver;
          resolver.begin();
          this.missiles.update(dt, this.flight.position, this.flight.orientation, resolver);
          this.bullets.update(dt, this.input.consumeFire(), this.flight.position, this.flight.orientation, resolver);
          resolver.resolve();
          this.impacts.update(dt, this.flight.position);
        }
        this.accumulator -= FLIGHT.fixedStep;
        substeps += 1;
      }
      if (substeps === FLIGHT.maxSubsteps) this.accumulator = 0;

      this.maybeRebase();
      this.terrain.update(this.flight.position, this.renderOrigin);

      this.hud.setProbeActive(this.terrain.isProbeActive);
      this.trail.add(this.flight.position, this.flight.orientation, this.renderOrigin);
      const throttleActive = frameInput.throttle > 0
        && this.flight.mode !== 'paused'
        && this.flight.mode !== 'crashed';
      this.throttleActive = throttleActive;
      this.flightEffects.update(rawDelta, throttleActive, this.flight.speed, this.flight.mode === 'crashed');
      this.trail.update(rawDelta, throttleActive);
      if (this.elapsed - this.lastRouteUpdate > 0.25) {
        this.route.update(this.flight.position, this.renderOrigin);
        this.lastRouteUpdate = this.elapsed;
      }
      this.syncViews();
      this.terrain.updateAircraftPosition(this.renderPlanePosition);
      this.route.updateAircraftPosition(this.renderPlanePosition);
      this.route.setAutopilotActive(this.flight.mode === 'autopilot');
      this.route.animate(rawDelta);
      this.wind.update(
        rawDelta,
        this.renderPlanePosition,
        this.flight.orientation,
        this.flight.speed,
        throttleActive,
        this.flight.mode === 'paused' || this.flight.mode === 'crashed',
      );
      this.flocks.update(
        rawDelta,
        this.flight.position,
        this.flight.orientation,
        this.flight.speed,
        this.renderOrigin,
        this.flight.mode === 'paused' || this.flight.mode === 'crashed',
        this.terrain.currentProbeWorldCenter,
        this.terrain.currentProbeRadius,
        this.terrain.isProbeActive,
        this.terrain.isProbeExpanding,
      );
    } else {
      this.input.clearFire();
      // Rebuild only presentation data, so color/thickness controls stay live.
      this.flocks.update(0, this.flight.position, this.flight.orientation,
        this.flight.speed, this.renderOrigin, true);
      this.syncViews();
    }
    this.hud.setBoostState(this.input.boost.active, this.input.boost.locked);
    this.cameraRig.update(rawDelta, this.renderPlanePosition, this.flight.cameraOrientation,
      this.flight.crashIntensity, this.throttleActive, this.paused);
    this.terrain.updateBoostLight(this.flightEffects.lightPosition,
      this.flightEffects.lightColor, this.flightEffects.lightIntensity);
    this.audio.update(this.flight.speed, this.flight.throttle, this.paused);

    const instantFps = rawDelta > 0 ? 1 / rawDelta : 60;
    this.frameAverage += (instantFps - this.frameAverage) * 0.035;
    if (!this.paused) this.updateQuality(rawDelta);
    if (this.renderElapsed - this.lastHudUpdate > 0.1) {
      this.updateHud(this.frameAverage);
      this.lastHudUpdate = this.renderElapsed;
    }
    this.blurVelocity.set(0, 0, this.flight.mode === 'crashed' ? 0 : this.flight.speed)
      .applyQuaternion(this.flight.orientation);
    this.post.setScanWave(this.terrain.currentProbeWorldCenter, this.renderOrigin,
      this.terrain.currentProbeRadius, this.terrain.isProbeExpanding);
    this.boostShake.update(this.paused ? 0 : rawDelta, this.flightEffects.burst.shakeIntensity);
    this.cockpitRoll.apply(this.cameraRig.camera, this.flight.cameraOrientation,
      this.cameraRig.mode === 'cockpit' ? this.flight.maneuverRollAngle : 0);
    this.bullets.setCamera(this.cameraRig.camera, this.renderOrigin, this.flight.position);
    this.bullets.sync(this.flight.position, this.flight.orientation);
    this.boostShake.apply(this.cameraRig.camera, this.flight.speed, this.impacts.shakeTranslation, this.impacts.shakeRotation);
    try {
      this.missiles.syncMuzzles(this.flight.position, this.flight.orientation);
      this.combatHud.update(this.cameraRig.camera, this.renderOrigin, this.meteors, this.missiles,
        this.missiles.settings, this.cameraRig.mode === 'cockpit', this.experienceMode === 'analysis', this.crtCurvature, this.flight.orientation, this.bullets.settings.bulletEnabled ? this.bullets.aim.point : undefined);
      this.bulletView.sync(this.renderOrigin, this.cameraRig.camera, this.flight.orientation);
      this.combatView.sync(this.renderOrigin, this.cameraRig.camera,
        this.experienceMode === 'analysis', this.collisionDebugEnabled && this.experienceMode === 'analysis');
      this.post.render(
        this.scene,
        this.cameraRig.camera,
        this.elapsed,
        this.flight.crashIntensity,
        this.blurVelocity,
        this.renderPlanePosition,
        this.flightEffects,
        this.refractionContributors,
      );
    } finally {
      this.boostShake.restore(this.cameraRig.camera);
      this.cockpitRoll.restore(this.cameraRig.camera);
    }
  };

  private syncViews(): void {
    this.renderPlanePosition.copy(this.flight.position).sub(this.renderOrigin);
    this.aircraft.group.position.copy(this.renderPlanePosition);
    this.aircraft.group.quaternion.copy(this.flight.orientation);
    this.collisionDebug.group.position.copy(this.renderPlanePosition);
    const cockpit = this.cameraRig.mode === 'cockpit';
    this.flight.setCockpitCollision(cockpit);
    this.collisionDebug.setCockpitMode(cockpit);
    this.collisionDebug.group.quaternion.copy(this.flight.orientation);
    this.collisionDebug.setColliding(this.flight.hasTerrainContact);
    this.collisionDebug.group.visible = this.collisionDebugEnabled && this.experienceMode === 'analysis';
    this.aircraft.setCockpitMode(cockpit);
    this.flightEffects.sync(this.renderPlanePosition, this.flight.orientation, cockpit);
    this.flightEffects.syncWake(this.trail, this.renderOrigin);
    this.route.setPresentationVisible(true);
  }

  private maybeRebase(): void {
    const dx = this.flight.position.x - this.renderOrigin.x;
    const dz = this.flight.position.z - this.renderOrigin.z;
    if (Math.hypot(dx, dz) < TERRAIN.rebaseDistance) return;
    const nextOriginX = Math.floor(this.flight.position.x / TERRAIN.chunkSize) * TERRAIN.chunkSize;
    const nextOriginZ = Math.floor(this.flight.position.z / TERRAIN.chunkSize) * TERRAIN.chunkSize;
    this.originShift.set(
      nextOriginX - this.renderOrigin.x,
      0,
      nextOriginZ - this.renderOrigin.z,
    );
    this.renderOrigin.x = nextOriginX;
    this.renderOrigin.z = nextOriginZ;
    this.cameraRig.applyOriginShift(this.originShift);
    this.wind.applyOriginShift(this.originShift);
    this.terrain.updateRenderOrigin(this.renderOrigin);
    this.trail.rebuild(this.renderOrigin);
    this.route.update(this.flight.position, this.renderOrigin);
  }

  private setCamera(mode: CameraMode): void {
    this.aircraft.setCockpitMode(mode === 'cockpit');
    this.route.setPresentationVisible(true);
  }

  private triggerProbe(): void {
    if (this.paused) return;
    this.scan.id++;
    this.terrain.triggerProbe(this.flight.position);
    this.probeScheduler.reset();
    this.audio.beep(920, 0.035);
  }

  private toggleAutopilot(): void {
    if (!this.paused) this.flight.toggleAutopilot();
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.input.clearFire();
    // Never accumulate paused wall time or run a catch-up step on resume.
    this.lastTime = performance.now();
    this.terrain.setPaused(this.paused);
    if (this.paused) this.cameraRig.setPaused();
    this.root.classList.toggle('is-paused', this.paused);
    this.hud.setPaused(this.paused);
    this.updateHud(this.frameAverage);
  }

  private toggleCollisionDebug(): void {
    this.collisionDebugEnabled = !this.collisionDebugEnabled;
    this.collisionDebug.group.visible = this.collisionDebugEnabled && this.experienceMode === 'analysis';
    this.hud.setCollisionVisible(this.collisionDebugEnabled);
  }

  private async toggleAudio(): Promise<void> {
    await this.audio.toggle();
    this.updateHud(this.frameAverage);
  }

  private resetCombat(): void {
    this.bullets.reset(); this.input?.clearFire(); this.flight.clearExternalImpulse();
    this.missiles.reset();
    this.impacts.reset();
    this.meteors.reset();
    this.scan.expanding = false;
    this.scan.id++;
    this.probeScheduler.reset();
  }

  private resetFlight(): void {
    if (this.paused) return;
    this.input.boost.reset();
    this.flight.reset();
    this.flightEffects.reset();
    this.trail.clear();
    this.trail.add(this.flight.position, this.flight.orientation, this.renderOrigin, true);
    this.renderPlanePosition.copy(this.flight.position).sub(this.renderOrigin);
    this.wind.reset(this.renderPlanePosition, this.flight.orientation);
  }

  private newSeed(): void {
    const bytes = new Uint32Array(2);
    crypto.getRandomValues(bytes);
    const nextSeed = `${bytes[0].toString(36)}-${bytes[1].toString(36)}`;
    const url = new URL(window.location.href);
    url.searchParams.set('seed', nextSeed);
    window.location.assign(url);
  }

  private toggleExperienceMode(): void {
    this.experienceMode = this.experienceMode === 'analysis' ? 'ambient' : 'analysis';
    this.root.classList.toggle('is-ambient', this.experienceMode === 'ambient');
    this.hud.setExperienceMode(this.experienceMode);
    this.route.setPresentationVisible(true);
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.root.requestFullscreen();
    } catch {
      this.hud.setFullscreen(false);
    }
  }

  private updateHud(fps: number): void {
    const snapshot: FlightSnapshot = {
      mode: this.paused ? 'paused' : this.flight.mode,
      camera: this.cameraRig.mode,
      position: this.flight.position,
      orientation: this.flight.orientation,
      speed: this.flight.actualSpeed,
      throttle: this.flight.throttle,
      altitude: this.flight.position.y,
      seed: this.seed,
      audioEnabled: this.audio.enabled,
    };
    const localDistance = Math.hypot(
      this.flight.position.x - this.renderOrigin.x,
      this.flight.position.z - this.renderOrigin.z,
    );
    this.hud.update(snapshot, fps, {
      localDistance,
    });
  }

  private updateQuality(dt: number): void {
    if (this.resolutionMode !== 'adaptive') return;
    this.qualityTimer += dt;
    if (this.qualityTimer < 3) return;
    this.qualityTimer = 0;
    if (this.frameAverage < 45) {
      this.adaptiveRenderScale = this.adaptiveRenderScale > 0.8 ? 0.8 : 0.65;
      this.post.setScale(this.adaptiveRenderScale);
    } else if (this.frameAverage > 58) {
      this.adaptiveRenderScale = this.adaptiveRenderScale < 0.8 ? 0.8 : 1;
      this.post.setScale(this.adaptiveRenderScale);
    }
  }

  private setResolutionMode(mode: 'full' | 'balanced' | 'adaptive'): void {
    if (this.resolutionMode === mode) return;
    this.resolutionMode = mode;
    this.qualityTimer = 0;
    this.adaptiveRenderScale = mode === 'balanced' ? 0.8 : 1;
    this.post.setScale(this.adaptiveRenderScale);
  }

  private resize = (): void => {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.updateInputLayout();
    this.renderer.setSize(width, height, false);
    this.cameraRig.resize(width, height);
    this.post.resize(width, height);
  };

  private updateInputLayout(): void {
    const touchLayout = navigator.maxTouchPoints > 0
      || window.matchMedia('(pointer: coarse)').matches
      || window.innerWidth <= 820;
    this.root.classList.toggle('is-touch-device', touchLayout);
  }
}
