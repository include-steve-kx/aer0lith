import { Euler, type Quaternion } from 'three';
import type { CameraMode, ExperienceMode, FlightMode, FlightSnapshot } from '../core/types.ts';
import { bindButtonAction } from './bindButtonAction.ts';

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
  readonly probeButton = element<HTMLButtonElement>('probe-button');
  readonly rollLeftButton = element<HTMLButtonElement>('roll-left-button');
  readonly rollRightButton = element<HTMLButtonElement>('roll-right-button');
  readonly throttleButton = element<HTMLButtonElement>('throttle-button');
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
  private readonly attitude = new Euler(0, 0, 0, 'YXZ');

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
    this.pauseButton.textContent = paused ? 'RESUME' : 'PAUSE';
    this.pauseButton.setAttribute('aria-label', paused ? 'Resume game' : 'Pause game');
    this.pauseButton.setAttribute('aria-pressed', String(paused));
    this.modeButton.disabled = paused;
    this.probeButton.disabled = paused;
    this.throttleButton.disabled = paused;
    this.rollLeftButton.disabled = paused;
    this.rollRightButton.disabled = paused;
  }

  setBoostState(active: boolean, locked: boolean, progress: number): void {
    this.throttleButton.style.setProperty('--boost-fill', `${progress * 100}%`);
    this.throttleButton.classList.toggle('is-active', active);
    this.throttleButton.classList.toggle('is-locked', locked);
    this.throttleButton.setAttribute('aria-pressed', String(active));
    this.throttleButton.setAttribute('aria-label', locked ? 'Unlock boost' : 'Hold boost for 7 seconds to lock');
    const label = this.throttleButton.querySelector('.boost-label');
    if (label) label.textContent = locked ? 'LOCKED' : progress > 0 ? `${(2 * (1 - progress)).toFixed(1)}s` : 'BOOST';
  }

  setProbeActive(active: boolean): void {
    this.probeButton.classList.toggle('is-active', active);
    this.probeButton.setAttribute('aria-pressed', String(active));
  }
}
