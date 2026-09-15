/**
 * Activate touch/pen controls on pointer-down so a second finger remains
 * usable while another pointer is captured by the joystick or OrbitControls.
 * Mouse and keyboard activation retain normal click semantics.
 */
export function bindButtonAction(
  button: HTMLButtonElement,
  action: () => void,
): void {
  let suppressSyntheticClickUntil = 0;

  button.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    suppressSyntheticClickUntil = performance.now() + 800;
    action();
  });

  button.addEventListener('click', (event) => {
    const keyboardActivation = event.detail === 0;
    if (!keyboardActivation && performance.now() < suppressSyntheticClickUntil) {
      event.preventDefault();
      return;
    }
    action();
  });
}
