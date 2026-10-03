import { Euler, Quaternion, Vector3 } from 'three';
import type { CameraMode, DriftState, ExperienceMode, FlightMode, FlightSnapshot } from '../core/types.ts';
import { bindButtonAction } from './bindButtonAction.ts';
import type { FlightTuningSettings } from '../flight/FlightTuning.ts';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing UI element #${id}`);
  return result as T;
}

function padNumber(value: number, digits = 3): string {
  return Math.max(0, Math.round(value)).toString().padStart(digits, '0');
}

function altitudeNumber(value: number): string {
  const rounded = Math.round(value);
  const magnitude = Math.abs(rounded).toString().padStart(3, '0');
  return rounded < 0 ? `-${magnitude}` : magnitude;
}

const MODE_LABELS: Record<FlightMode, string> = {
  loading: 'INITIALIZING',
  autopilot: 'AUTOPILOT',
  manual: 'MANUAL',
  crashed: 'RECOVERY',
  paused: 'PAUSED',
};

export function zeroRollIndicatorRadians(
  orientation: Quaternion,
  target = new Euler(0, 0, 0, 'YXZ'),
): number {
  return -target.setFromQuaternion(orientation, 'YXZ').z;
}

export interface RebaseDiagnostic {
  localDistance: number;
}

export class Hud {
  readonly pauseButton = element<HTMLButtonElement>('pause-button');
  readonly cameraButton = element<HTMLButtonElement>('camera-button');
  readonly audioButton = element<HTMLButtonElement>('audio-button');
  readonly seedButton = element<HTMLButtonElement>('seed-button');
  readonly viewButton = element<HTMLButtonElement>('view-button');
  readonly fullscreenButton = element<HTMLButtonElement>('fullscreen-button');
  readonly collisionButton = element<HTMLButtonElement>('collision-button');
  readonly modeButton = element<HTMLButtonElement>('mode-button');
  readonly fireButton = element<HTMLButtonElement>('fire-button');
  readonly pulseButton = element<HTMLButtonElement>('pulse-button');
  readonly probeButton = element<HTMLButtonElement>('probe-button');
  readonly rollLeftButton = element<HTMLButtonElement>('roll-left-button');
  readonly rollRightButton = element<HTMLButtonElement>('roll-right-button');
  readonly throttleButton = element<HTMLButtonElement>('throttle-button');
  readonly driftButton = element<HTMLButtonElement>('drift-button');
  readonly touchJoystick = element<HTMLElement>('touch-joystick');
  readonly touchJoystickThumb = element<HTMLElement>('touch-joystick-thumb');
  private readonly hud = element<HTMLElement>('hud');
  private readonly fault = element<HTMLElement>('fault');
  private readonly legend = element<HTMLElement>('legend');
  private readonly legendToggle = element<HTMLButtonElement>('legend-toggle');
  private readonly modeValue = element<HTMLElement>('mode-value');
  private readonly cameraValue = element<HTMLElement>('camera-value');
  private readonly seedValue = element<HTMLElement>('seed-value');
  private readonly speedValue = element<HTMLElement>('speed-value');
  private readonly altitudeValue = element<HTMLElement>('altitude-value');
  private readonly modeButtonValue = element<HTMLElement>('mode-button-value');
  private readonly coordinateValue = element<HTMLElement>('coordinates-value');
  private readonly rebaseValue = element<HTMLElement>('rebase-value');
  private readonly fpsValue = element<HTMLElement>('fps-value');
  private readonly horizon = element<HTMLElement>('horizon');
  private readonly pulseStatus = element<HTMLElement>('pulse-status');
  private readonly reticle = element<HTMLElement>('reticle');
  private readonly driftCluster = element<HTMLElement>('drift-cluster');
  private readonly driftMeter = element<HTMLElement>('drift-meter');
  private readonly driftStatus = element<HTMLElement>('drift-status');
  private readonly driftSegments = Array.from(this.driftMeter.querySelectorAll<HTMLElement>('.drift-meter-segments i'));
  private readonly attitude = new Euler(0, 0, 0, 'YXZ');
  private readonly inverseOrientation = new Quaternion();
  private readonly localTravel = new Vector3();
  private driftSettings: FlightTuningSettings | undefined;
  private paused = false;

  constructor() {
    bindButtonAction(this.legendToggle, () => {
      const collapsed = this.legend.classList.toggle('is-collapsed');
      this.legendToggle.setAttribute('aria-expanded', String(!collapsed));
      const indicator = this.legendToggle.querySelector('span');
      if (indicator) indicator.textContent = collapsed ? '[+]' : '[-]';
    });
  }

  update(snapshot: FlightSnapshot, fps: number, rebase: RebaseDiagnostic): void {
    const modeLabel = MODE_LABELS[snapshot.mode];
    this.modeValue.textContent = modeLabel;
    this.cameraValue.textContent = snapshot.camera === 'far-chase' ? 'FAR CHASE' : snapshot.camera.toUpperCase();
    this.seedValue.textContent = snapshot.seed.slice(0, 12).toUpperCase();
    this.speedValue.textContent = padNumber(snapshot.speed);
    this.altitudeValue.textContent = altitudeNumber(snapshot.altitude);
    this.modeButtonValue.textContent = modeLabel;
    this.modeButton.classList.toggle('is-warning', snapshot.mode === 'crashed');
    this.coordinateValue.textContent = `X ${this.signed(snapshot.position.x)} // Z ${this.signed(snapshot.position.z)}`;
    this.rebaseValue.textContent = `${this.unsigned(rebase.localDistance, 4)}M`;
    this.fpsValue.textContent = `FPS ${padNumber(fps)}`;
    this.cameraButton.textContent = `CAM / ${this.cameraIndex(snapshot.camera)}`;
    this.audioButton.textContent = `AUDIO / ${snapshot.audioEnabled ? 'ON' : 'OFF'}`;
    this.audioButton.setAttribute('aria-label', snapshot.audioEnabled ? 'Mute audio' : 'Enable audio');
    this.horizon.classList.toggle('is-active', snapshot.camera === 'cockpit');
    const horizonRoll = zeroRollIndicatorRadians(snapshot.orientation, this.attitude);
    this.horizon.style.setProperty('--horizon-roll', `${horizonRoll}rad`);
    this.fault.classList.toggle('is-active', snapshot.mode === 'crashed');
    this.fault.setAttribute('aria-hidden', String(snapshot.mode !== 'crashed'));
    this.updateDrift(snapshot);
  }

  private signed(value: number): string {
    const rounded = Math.round(value);
    return `${rounded >= 0 ? '+' : '-'}${Math.abs(rounded).toString().padStart(5, '0')}`;
  }

  private unsigned(value: number, digits: number): string {
    return Math.max(0, Math.round(value)).toString().padStart(digits, '0');
  }

  private cameraIndex(mode: CameraMode): number {
    return ['cockpit', 'chase', 'far-chase'].indexOf(mode) + 1;
  }

  setExperienceMode(mode: ExperienceMode): void {
    const ambient = mode === 'ambient';
    this.hud.classList.toggle('is-ambient', ambient);
    this.viewButton.textContent = ambient ? 'UI / OFF' : 'UI / ON';
    this.viewButton.setAttribute('aria-label', ambient ? 'Enter analysis mode' : 'Enter ambient mode');
  }

  setFullscreen(active: boolean): void {
    this.fullscreenButton.classList.toggle('is-active', active);
    this.fullscreenButton.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen');
  }

  setCollisionVisible(active: boolean): void {
    this.collisionButton.textContent = `COLLISION / ${active ? 'ON' : 'OFF'}`;
    this.collisionButton.setAttribute('aria-label', active ? 'Hide collision mesh' : 'Show collision mesh');
    this.collisionButton.setAttribute('aria-pressed', String(active));
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.pauseButton.textContent = paused ? 'RESUME' : 'PAUSE';
    this.pauseButton.setAttribute('aria-label', paused ? 'Resume game' : 'Pause game');
    this.pauseButton.setAttribute('aria-pressed', String(paused));
    this.modeButton.disabled = paused;
    this.fireButton.disabled = paused;
    this.pulseButton.disabled = paused;
    this.probeButton.disabled = paused;
    this.throttleButton.disabled = paused;
    this.driftButton.disabled = paused;
    this.rollLeftButton.disabled = paused;
    this.rollRightButton.disabled = paused;
  }

  setPulseState(
    enabled: boolean,
    ready: boolean,
    cooldownFraction: number,
    cooldownSeconds: number,
    terrainReady: boolean,
    unavailable = false,
  ): void {
    const cooling = enabled && !ready;
    const busy = enabled && ready && !terrainReady;
    const disabled = this.paused || !enabled || cooling || busy || unavailable;
    this.pulseButton.disabled = disabled;
    this.pulseButton.style.setProperty('--pulse-cooldown', `${Math.max(0, Math.min(1, cooldownFraction)) * 100}%`);
    this.pulseButton.classList.toggle('is-cooling', cooling);
    this.pulseButton.classList.toggle('is-terrain-busy', busy);
    let label = 'Fire Pulse Cannon';
    let status = 'Pulse Cannon ready';
    if (!enabled) label = status = 'Pulse Cannon disabled in settings';
    else if (this.paused) label = status = 'Pulse Cannon unavailable while paused';
    else if (unavailable) label = status = 'Pulse Cannon unavailable';
    else if (busy) label = status = 'Pulse Cannon waiting for terrain';
    else if (cooling) label = status = `Pulse Cannon cooling down, ${cooldownSeconds.toFixed(1)} seconds remaining`;
    this.pulseButton.setAttribute('aria-label', label);
    this.pulseButton.dataset.cooldown = cooldownSeconds.toFixed(1);
    this.pulseStatus.textContent = status;
  }

  configureDrift(settings: FlightTuningSettings): void {
    this.driftSettings = settings;
    this.driftMeter.hidden = !settings.driftMeterEnabled;
    this.driftMeter.style.setProperty('--meter-scale', String(settings.driftMeterScale));
    this.reticle.style.setProperty('--drift-cue-opacity', String(settings.driftCueOpacity));
    this.driftCluster.style.setProperty('--primary-control-scale', String(settings.touchPrimaryScale));
    this.driftCluster.classList.toggle('is-tier-pulsing', settings.driftTierPulse);
  }

  setProbeActive(active: boolean): void {
    this.probeButton.classList.toggle('is-active', active);
    this.probeButton.setAttribute('aria-pressed', String(active));
  }

  private updateDrift(snapshot: FlightSnapshot): void {
    const energy = Math.max(0, Math.min(100, snapshot.driftEnergy ?? 0));
    const tier = snapshot.driftTier ?? 0;
    const state = snapshot.driftState ?? 'cruise';
    this.driftCluster.dataset.tier = String(tier);
    this.throttleButton.dataset.tier = String(tier);
    this.driftMeter.setAttribute('aria-valuenow', energy.toFixed(0));
    this.driftMeter.setAttribute('aria-valuetext', `${this.driftLabel(state, tier)}, ${energy.toFixed(0)} percent`);
    this.driftStatus.textContent = this.driftLabel(state, tier);
    const thresholds = [0, this.driftSettings?.driftTierTwo ?? 35, this.driftSettings?.driftTierThree ?? 70, 100];
    for (let index = 0; index < this.driftSegments.length; index += 1) {
      const fill = Math.max(0, Math.min(1, (energy - thresholds[index]) / (thresholds[index + 1] - thresholds[index])));
      this.driftSegments[index].style.setProperty('--segment-fill', String(fill));
    }
    const drifting = state === 'drift';
    const boosting = state === 'drift-boost' || state === 'normal-boost';
    this.driftButton.classList.toggle('is-active', drifting);
    this.driftButton.setAttribute('aria-pressed', String(drifting));
    this.throttleButton.classList.toggle('is-active', boosting);
    this.throttleButton.setAttribute('aria-pressed', String(boosting));
    this.throttleButton.setAttribute('aria-label', state === 'drift-boost'
      ? `Hold for drift boost tier ${tier}`
      : 'Hold to boost');

    const settings = this.driftSettings;
    const velocity = snapshot.controlVelocity;
    const angle = snapshot.driftAngle ?? 0;
    const cueVisible = Boolean(settings?.driftCueEnabled && velocity && velocity.lengthSq() > 1e-8
      && angle >= settings.driftMinAngle);
    this.reticle.classList.toggle('has-drift-slip', cueVisible);
    if (!cueVisible || !settings || !velocity) return;
    this.localTravel.copy(velocity).normalize().applyQuaternion(
      this.inverseOrientation.copy(snapshot.orientation).invert(),
    );
    const projectedLength = Math.hypot(this.localTravel.x, this.localTravel.y);
    const directionX = projectedLength > 1e-6 ? this.localTravel.x / projectedLength : 0;
    const directionY = projectedLength > 1e-6 ? -this.localTravel.y / projectedLength : 0;
    const distance = Math.min(settings.driftCueSize, settings.driftCueSize * angle / settings.cameraMaxLag);
    const x = directionX * distance;
    const y = directionY * distance;
    this.reticle.style.setProperty('--drift-cue-x', `${x}px`);
    this.reticle.style.setProperty('--drift-cue-y', `${y}px`);
    this.reticle.style.setProperty('--drift-cue-distance', `${distance}px`);
    this.reticle.style.setProperty('--drift-cue-angle', `${Math.atan2(y, x)}rad`);
  }

  private driftLabel(state: DriftState, tier: number): string {
    if (state === 'drift-boost') return `BOOST ${['', 'I', 'II', 'III'][tier] ?? ''}`.trim();
    if (state === 'normal-boost') return 'NORMAL BOOST';
    if (state === 'drift') return 'DRIFT';
    if (state === 'banked') return 'BANKED';
    return 'CRUISE';
  }
}
