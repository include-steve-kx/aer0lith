import { Camera, Vector3, type Quaternion } from 'three';
import { COMBAT_LIMITS } from '../combat/settings.ts';
import type { CombatSettings } from '../combat/settings.ts';
import type { MeteorSystem } from '../combat/MeteorSystem.ts';
import type { MissileSystem } from '../combat/MissileSystem.ts';
/** Inverse of the CRT shader's radial sampling map, in normalized device coordinates. */
export function inverseCrtPoint(
  x: number,
  y: number,
  curvature: number,
): [number, number] {
  const r = Math.hypot(x, y);
  if (r < 1e-9 || curvature <= 0) return [x, y];
  let s = r;
  for (let i = 0; i < 6; i++)
    s -= (s + curvature * s * s * s - r) / (1 + 3 * curvature * s * s);
  return [(x * s) / r, (y * s) / r];
}
export class CombatHud {
  readonly element = document.createElement('div');
  private readonly aimIndicator = document.createElement('span');
  private readonly counts: HTMLSpanElement[] = [];
  private readonly fills: HTMLSpanElement[] = [];
  private readonly labels: HTMLDivElement[] = [];
  private readonly connectors: HTMLSpanElement[] = [];
  private readonly crosses: HTMLSpanElement[] = [];
  private readonly p = new Vector3();
  private readonly ammoAnchor = new Vector3();
  private readonly cockpitLead = new Vector3();
  private readonly worldCamera = new Vector3();
  private readonly cameraDirection = new Vector3();
  private readonly countsShown = new Int8Array(4).fill(-1);
  private readonly xs = new Float64Array(4);
  private readonly ys = new Float64Array(4);
  constructor() {
    this.element.className = 'combat-hud';
    this.aimIndicator.className = 'bullet-aim'; this.aimIndicator.hidden = true; this.element.append(this.aimIndicator);
    this.element.setAttribute('aria-hidden', 'true');
    document.querySelector('#app')!.append(this.element);
    for (let i = 0; i < 4; i++) {
      const label = document.createElement('div');
      label.className = 'wing-ammo';
      const count = document.createElement('span'),
        bar = document.createElement('span'),
        fill = document.createElement('span'),
        connector = document.createElement('span');
      bar.className = 'ammo-track';
      fill.className = 'ammo-fill';
      connector.className = 'ammo-connector';
      bar.append(fill);
      label.append(count, bar);
      this.element.append(connector, label);
      this.labels.push(label);
      this.counts.push(count);
      this.fills.push(fill);
      this.connectors.push(connector);
    }
    for (let i = 0; i < COMBAT_LIMITS.meteors; i++) {
      const cross = document.createElement('span');
      cross.className = 'meteor-cross';
      this.crosses.push(cross);
      this.element.append(cross);
    }
  }
  update(
    camera: Camera,
    origin: Vector3,
    meteors: MeteorSystem,
    missiles: MissileSystem,
    settings: CombatSettings,
    cockpit: boolean,
    visible: boolean,
    curvature: number,
    aircraftOrientation: Quaternion,
    aimPoint?: Vector3,
  ): void {
    this.element.hidden = !visible;
    if (!visible) return;
    const width = window.innerWidth,
      height = window.innerHeight;
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.worldCamera);
    this.worldCamera.add(origin);
    camera.getWorldDirection(this.cameraDirection);
    const hud = document.querySelector('.coordinates')!;
    const style = getComputedStyle(hud);
    this.element.style.fontSize = style.fontSize;
    this.element.style.letterSpacing = style.letterSpacing;
    const safe = document.querySelector('#hud')!.getBoundingClientRect();
    const occupied = [
      ...document.querySelectorAll(
        '.system-controls, .flight-actions, #mode-button, #touch-joystick, #legend, #settings-panel',
      ),
    ]
      .filter((element) => (element as HTMLElement).offsetWidth > 0)
      .map((element) => element.getBoundingClientRect());
    const minX = Math.max(12, safe.left),
      maxX = Math.min(width - 12, safe.right);
    const minY = Math.max(12, safe.top),
      maxY = Math.min(height - 12, safe.bottom);
    const project = (world: Vector3): boolean => {
      this.p.copy(world).sub(this.worldCamera);
      if (this.p.dot(this.cameraDirection) <= 0) return false;
      this.p.copy(world).sub(origin).project(camera);
      if (this.p.z < -1 || this.p.z > 1) return false;
      const xy = inverseCrtPoint(this.p.x, this.p.y, curvature);
      this.p.set(
        (xy[0] + 1) * width * 0.5,
        (1 - xy[1]) * height * 0.5,
        this.p.z,
      );
      return (
        this.p.x >= minX &&
        this.p.x <= maxX &&
        this.p.y >= minY &&
        this.p.y <= maxY
      );
    };
    this.aimIndicator.hidden = !aimPoint || !project(aimPoint) || Math.hypot(this.p.x - width / 2, this.p.y - height / 2) < 8;
    if (!this.aimIndicator.hidden) this.aimIndicator.style.transform = `translate(${this.p.x}px,${this.p.y}px)`;

    // The real wing tips sit behind the cockpit eye. Project a point 18 m
    // ahead of each tip along the ship's forward axis instead. Keep world-space
    // anchors so camera roll, shake, FOV and floating-origin shifts apply once.
    this.cockpitLead.set(0, 0, 18).applyQuaternion(aircraftOrientation);
    for (let i = 0; i < 4; i++) {
      const label = this.labels[i],
        connector = this.connectors[i];
      connector.hidden = true;
      let show =
        settings.missileHud &&
        settings.missileEnabled &&
        settings.meteorEnabled;
      this.ammoAnchor.copy(missiles.muzzle[i]);
      if (cockpit) this.ammoAnchor.add(this.cockpitLead);
      const anchorVisible = project(this.ammoAnchor);
      show = show && anchorVisible;
      label.hidden = !show;
      if (!show) continue;
      const originalX = this.p.x,
        originalY = this.p.y;
      let x = this.p.x + (cockpit ? -12 : i < 2 ? 8 : -32),
        y = this.p.y - (cockpit ? 9 : 25);
      if (!cockpit) {
        for (let j = 0; j < i; j++)
          if (
            !this.labels[j].hidden &&
            Math.abs(x - this.xs[j]) < 30 &&
            Math.abs(y - this.ys[j]) < 22
          )
            y += 22;
      }
      x = Math.max(minX, Math.min(maxX - 24, x));
      y = Math.max(minY, Math.min(maxY - 23, y));
      if (
        !cockpit &&
        occupied.some(
          (rect) =>
            x + 24 > rect.left &&
            x < rect.right &&
            y + 22 > rect.top &&
            y < rect.bottom,
        )
      ) {
        label.hidden = true;
        continue;
      }
      this.xs[i] = x;
      this.ys[i] = y;
      label.style.transform = `translate(${x}px,${y}px)`;
      const text = String(missiles.ammunition[i]);
      if (
        this.countsShown[i] !== missiles.ammunition[i] ||
        this.counts[i].textContent !== text
      ) {
        this.counts[i].textContent = text;
        this.countsShown[i] = missiles.ammunition[i];
      }
      const progress =
        missiles.ammunition[i] >= settings.missileCapacity
          ? 1
          : missiles.reload[i];
      this.fills[i].style.transform = `scaleX(${progress})`;
      if (!cockpit && Math.hypot(x - originalX, y - originalY) > 40) {
        connector.hidden = false;
        connector.style.width = `${Math.hypot(x + 12 - originalX, y + 20 - originalY)}px`;
        connector.style.transform = `translate(${originalX}px,${originalY}px) rotate(${Math.atan2(y + 20 - originalY, x + 12 - originalX)}rad)`;
      }
    }
    // Screen-space scan annotations intentionally remain visible through terrain.
    for (let i = 0; i < this.crosses.length; i++) {
      const m = meteors.rocks[i],
        cross = this.crosses[i];
      const show =
        m.active &&
        m.detected > 0 &&
        settings.meteorMarkers &&
        project(m.position);

      cross.hidden = !show;
      if (show) {
        cross.style.transform = `translate(${this.p.x}px,${this.p.y}px)`;
        cross.style.opacity = String(Math.min(1, m.detected));
        cross.style.color = settings.meteorTargetColor;
      }
    }
  }
  dispose(): void {
    this.element.remove();
  }
}
