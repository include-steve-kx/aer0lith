# Drift and boost

Aer0lith measures drift as the angle between the aircraft's nose and its controllable velocity. Explosion force and scripted dodge displacement are deliberately excluded, so only deliberate flight can earn energy.

Hold `J` or the large touch drift control to reduce lateral grip. Turning rotates the aircraft while momentum continues along its prior path. Drift energy charges from slip angle, controllable speed, and fixed simulation time. Releasing drift banks the energy briefly before passive decay begins.

Hold `K` or the large touch boost control to use the bank. The current energy automatically selects tier I, II, or III; the player never selects a tier manually. Energy drains more quickly while powered, and the boost live-downgrades as thresholds are crossed. The first boost hold for a newly earned bank adds one nose-biased ignition kick. Releasing and reholding cannot repeat that kick. When the bank reaches zero, a continuing hold becomes the weaker normal boost.

Pressing drift during boost cancels it. An active drift-boost loses its remaining bank and immediately begins a fresh drift. If boost is still held, it remains suppressed until released and pressed again.

The chase cameras favor travel direction during drift and return elastically toward the nose afterward. Cockpit view remains rigid. The central slip cue and three-segment meter expose the same authoritative state used by physics, camera, wind, wake, and motion blur.

All handling, energy, tier, camera, display, and touch parameters are live under System Settings. Settings persist under `aer0lith.settings.v3`; existing `aer0lith.visual-settings.v2` values migrate automatically.
