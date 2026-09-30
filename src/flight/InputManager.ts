import { BoostLatch } from './BoostLatch.ts';
import { RollGesture } from './RollGesture.ts';
import type { FlightInput } from '../core/types.ts';

export interface InputActions {
  onManualInput(): void;
  onRoll(direction: -1 | 1): void;
  onToggleAutopilot(): void;
  onCycleCamera(): void;
  onSelectCamera(index: number): void;
  onToggleAudio(): void;
  onReset(): void;
  onPause(): void;
  onNewSeed(): void;
  onToggleExperienceMode(): void;
  onToggleFullscreen(): void;
  onTriggerProbe(): void;
}

export interface PointerFlightControls {
  joystick: HTMLElement;
  joystickThumb: HTMLElement;
  throttleButton: HTMLButtonElement;
}

export interface JoystickInput {
  pitch: number;
  roll: number;
  yaw: number;
  offsetX: number;
  offsetY: number;
}

const CAPTURED = new Set([
  'KeyW', 'KeyS', 'KeyA', 'KeyD', 'ShiftLeft', 'ShiftRight',
  'ControlLeft', 'ControlRight', 'Space', 'KeyC', 'Digit1', 'Digit2', 'Digit3',
  'KeyM', 'KeyR', 'KeyP', 'Escape', 'KeyN', 'KeyB',
  'KeyV',
]);

const DIRECTION_KEYS = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD']);

export function flightInputFromKeys(pressed: ReadonlySet<string>): FlightInput {
  const has = (...codes: string[]): boolean => codes.some((code) => pressed.has(code));
  return {
    pitch: (has('KeyW') ? -1 : 0) + (has('KeyS') ? 1 : 0),
    roll: (has('KeyD') ? 1 : 0) + (has('KeyA') ? -1 : 0),
    yaw: (has('KeyA') ? 1 : 0) + (has('KeyD') ? -1 : 0),
    throttle: (has('ShiftLeft', 'ShiftRight') ? 1 : 0) + (has('ControlLeft', 'ControlRight') ? -1 : 0),
  };
}

function applyDeadZone(value: number, deadZone = 0.08): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadZone) return 0;
  return Math.sign(value) * Math.min(1, (magnitude - deadZone) / (1 - deadZone));
}

export function joystickInputFromOffset(deltaX: number, deltaY: number, radius: number): JoystickInput {
  const safeRadius = Math.max(1, radius);
  const distance = Math.hypot(deltaX, deltaY);
  const scale = distance > safeRadius ? safeRadius / distance : 1;
  const offsetX = deltaX * scale;
  const offsetY = deltaY * scale;
  return {
    pitch: applyDeadZone(offsetY / safeRadius),
    roll: applyDeadZone(offsetX / safeRadius),
    yaw: -applyDeadZone(offsetX / safeRadius),
    offsetX,
    offsetY,
  };
}

export class InputManager {
  readonly boost = new BoostLatch();
  private readonly rollGesture = new RollGesture();
  private readonly pressed = new Set<string>();
  private readonly root: HTMLElement;
  private readonly actions: InputActions;
  private readonly pointerControls: PointerFlightControls | undefined;
  private joystickPointerId: number | undefined;
  private throttlePointerId: number | undefined;
  private pointerPitch = 0;
  private pointerRoll = 0;
  private pointerYaw = 0;

  constructor(root: HTMLElement, actions: InputActions, pointerControls?: PointerFlightControls) {
    this.root = root;
    this.actions = actions;
    this.pointerControls = pointerControls;
    root.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (!(target instanceof Element && target.closest('button'))) root.focus({ preventScroll: true });
    });
    root.addEventListener('pointerup', this.clearTouchButtonFocus, true);
    root.addEventListener('pointercancel', this.clearTouchButtonFocus, true);
    root.addEventListener('contextmenu', this.preventBrowserGesture);
    root.addEventListener('selectstart', this.preventBrowserGesture);
    root.addEventListener('dragstart', this.preventBrowserGesture);
    root.addEventListener('gesturestart', this.preventBrowserGesture, { passive: false });
    root.addEventListener('gesturechange', this.preventBrowserGesture, { passive: false });
    root.addEventListener('gestureend', this.preventBrowserGesture, { passive: false });
    for (const control of root.querySelectorAll('button, input, select')) {
      control.addEventListener('pointerdown', this.isolateUiPointer);
      control.addEventListener('pointermove', this.isolateUiPointer);
      control.addEventListener('pointerup', this.isolateUiPointer);
      control.addEventListener('pointercancel', this.isolateUiPointer);
    }
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
    if (pointerControls) this.bindPointerControls(pointerControls);
  }

  private bindPointerControls(controls: PointerFlightControls): void {
    controls.joystick.addEventListener('pointerdown', this.onJoystickPointerDown);
    controls.joystick.addEventListener('pointermove', this.onJoystickPointerMove);
    controls.joystick.addEventListener('pointerup', this.onJoystickPointerUp);
    controls.joystick.addEventListener('pointercancel', this.onJoystickPointerUp);
    controls.joystick.addEventListener('lostpointercapture', this.onJoystickPointerUp);
    controls.throttleButton.addEventListener('pointerdown', this.onThrottlePointerDown);
    controls.throttleButton.addEventListener('pointerup', this.onThrottlePointerUp);
    controls.throttleButton.addEventListener('pointercancel', this.onThrottlePointerUp);
    controls.throttleButton.addEventListener('lostpointercapture', this.onThrottlePointerUp);
  }

  private onJoystickPointerDown = (event: PointerEvent): void => {
    if (this.joystickPointerId !== undefined || (event.pointerType === 'mouse' && event.button !== 0)) return;
    this.joystickPointerId = event.pointerId;
    this.pointerControls?.joystick.setPointerCapture(event.pointerId);
    this.pointerControls?.joystick.classList.add('is-active');
    this.updateJoystick(event);
    this.consumeFlightPointer(event);
  };

  private onJoystickPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.joystickPointerId) return;
    this.updateJoystick(event);
    this.consumeFlightPointer(event);
  };

  private onJoystickPointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.joystickPointerId) return;
    this.joystickPointerId = undefined;
    if (this.pointerControls?.joystick.hasPointerCapture(event.pointerId)) {
      this.pointerControls.joystick.releasePointerCapture(event.pointerId);
    }
    if (event.type === 'pointercancel') this.rollGesture.reset();
    else this.rollGesture.releaseStick();
    this.pointerPitch = 0;
    this.pointerRoll = 0;
    this.pointerYaw = 0;
    if (this.pointerControls) {
      this.pointerControls.joystick.classList.remove('is-active');
      this.pointerControls.joystickThumb.style.transform = 'translate(-50%, -50%)';
    }
    this.consumeFlightPointer(event);
  };

  private updateJoystick(event: PointerEvent): void {
    if (!this.pointerControls) return;
    const bounds = this.pointerControls.joystick.getBoundingClientRect();
    const radius = Math.min(bounds.width, bounds.height) * 0.34;
    const input = joystickInputFromOffset(
      event.clientX - (bounds.left + bounds.width * 0.5),
      event.clientY - (bounds.top + bounds.height * 0.5),
      radius,
    );
    this.pointerPitch = input.pitch;
    this.pointerRoll = input.roll;
    const roll = this.rollGesture.stick(input.roll, performance.now());
    if (roll) this.actions.onRoll(roll);
    this.pointerYaw = input.yaw;
    this.pointerControls.joystickThumb.style.transform = `translate(calc(-50% + ${input.offsetX}px), calc(-50% + ${input.offsetY}px))`;
    if (input.pitch !== 0 || input.roll !== 0) this.actions.onManualInput();
  }

  private onThrottlePointerDown = (event: PointerEvent): void => {
    if (this.throttlePointerId !== undefined || (event.pointerType === 'mouse' && event.button !== 0)) return;
    this.throttlePointerId = event.pointerId;
    this.pointerControls?.throttleButton.setPointerCapture(event.pointerId);
    this.boost.setHeld('pointer', true);
    this.consumeFlightPointer(event);
  };

  private onThrottlePointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.throttlePointerId) return;
    this.throttlePointerId = undefined;
    if (this.pointerControls?.throttleButton.hasPointerCapture(event.pointerId)) {
      this.pointerControls.throttleButton.releasePointerCapture(event.pointerId);
    }
    this.boost.setHeld('pointer', false);
    this.consumeFlightPointer(event);
  };

  /**
   * OrbitControls listens for pointer movement on the owner document while a
   * canvas gesture is active. A separately captured joystick/throttle pointer
   * would otherwise bubble into that listener and be mistaken for the camera
   * pointer, producing a very large orbit delta during multi-touch use.
   */
  private consumeFlightPointer(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private preventBrowserGesture = (event: Event): void => {
    event.preventDefault();
  };

  private clearTouchButtonFocus = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return;
    const target = event.target;
    const button = target instanceof Element ? target.closest('button') : null;
    if (!(button instanceof HTMLButtonElement)) return;
    requestAnimationFrame(() => button.blur());
  };

  /** Keep independent UI pointers out of OrbitControls' document listeners. */
  private isolateUiPointer = (event: Event): void => {
    event.stopPropagation();
  };

  private hasExperienceFocus(): boolean {
    const active = document.activeElement;
    return active === this.root || (active instanceof Node && this.root.contains(active));
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.hasExperienceFocus()) return;
    if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable=true]')) return;
    if (event.target === this.pointerControls?.throttleButton && ['Space', 'Enter'].includes(event.code)) {
      event.preventDefault(); this.boost.setHeld(event.code, true); return;
    }
    if (event.code === 'Escape' && document.fullscreenElement) return;
    const fullscreenShortcut = event.code === 'KeyF' && (event.ctrlKey || event.metaKey);
    if (CAPTURED.has(event.code) || fullscreenShortcut) event.preventDefault();
    if (fullscreenShortcut && !event.repeat) {
      this.actions.onToggleFullscreen();
      return;
    }
    const alreadyPressed = this.pressed.has(event.code);
    this.pressed.add(event.code);
    if (DIRECTION_KEYS.has(event.code)) this.actions.onManualInput();
    if (event.repeat || alreadyPressed) return;
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.boost.setHeld(event.code, true);
    if (event.code === 'KeyA' || event.code === 'KeyD') {
      const roll = this.rollGesture.tap(event.code === 'KeyA' ? -1 : 1, performance.now());
      if (roll) this.actions.onRoll(roll);
    }
    switch (event.code) {
      case 'Space': this.actions.onToggleAutopilot(); break;
      case 'KeyC': this.actions.onCycleCamera(); break;
      case 'Digit1': this.actions.onSelectCamera(0); break;
      case 'Digit2': this.actions.onSelectCamera(1); break;
      case 'Digit3': this.actions.onSelectCamera(2); break;
      case 'KeyM': this.actions.onToggleAudio(); break;
      case 'KeyR': this.actions.onReset(); break;
      case 'KeyP':
      case 'Escape': this.actions.onPause(); break;
      case 'KeyN': this.actions.onNewSeed(); break;
      case 'KeyV': this.actions.onToggleExperienceMode(); break;
      case 'KeyB': this.actions.onTriggerProbe(); break;
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
    this.boost.setHeld(event.code, false);
  };

  resetGestures(): void { this.rollGesture.reset(); }

  private clear = (): void => {
    this.resetGestures();
    this.pressed.clear();
    this.boost.releaseAll();
    if (this.joystickPointerId !== undefined && this.pointerControls?.joystick.hasPointerCapture(this.joystickPointerId)) {
      this.pointerControls.joystick.releasePointerCapture(this.joystickPointerId);
    }
    if (this.throttlePointerId !== undefined && this.pointerControls?.throttleButton.hasPointerCapture(this.throttlePointerId)) {
      this.pointerControls.throttleButton.releasePointerCapture(this.throttlePointerId);
    }
    this.joystickPointerId = undefined;
    this.throttlePointerId = undefined;
    this.rollGesture.releaseStick();
    this.pointerPitch = 0;
    this.pointerRoll = 0;
    this.pointerYaw = 0;
    this.boost.setHeld('pointer', false);
    if (this.pointerControls) {
      this.pointerControls.joystick.classList.remove('is-active');
      this.pointerControls.joystickThumb.style.transform = 'translate(-50%, -50%)';
    }
  };

  read(dt = 0): FlightInput {
    this.boost.update(dt);
    const keyboard = flightInputFromKeys(this.pressed);
    return {
      pitch: Math.max(-1, Math.min(1, keyboard.pitch + this.pointerPitch)),
      roll: Math.max(-1, Math.min(1, keyboard.roll + this.pointerRoll)),
      yaw: Math.max(-1, Math.min(1, keyboard.yaw + this.pointerYaw)),
      throttle: (this.pressed.has('ControlLeft') || this.pressed.has('ControlRight')) ? -1 : (this.boost.active ? 1 : 0),
    };
  }
}
