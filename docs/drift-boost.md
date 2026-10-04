# Automatic slip energy and drift boost

Aer0lith detects drift automatically. There is no Drift button or `J` shortcut. The fixed-step simulation compares the aircraft's nose direction with its combined controllable and explosion velocity, removes the forward component, and measures the remaining sideways slip speed. Sharp manual turns reduce grip smoothly, preserving momentum without adding another input.

Slip begins responding at 12 m/s and reaches full response at 90 m/s. The default S-curve softens small input noise, responds strongly through the middle, and eases into its maximum. Linear, early-plateau, and monotonic custom Bézier curves are available in Settings. One precomputed lookup table supplies the same response to energy, the HUD cue, chase camera, wind, wake, and center-tail ash.

At full response the `0–100` bank charges at 20 energy/s, including during normal boost, drift boost, and autopilot. Explosion velocity is eligible. Scripted dodge displacement and collision-generated controllable slip are excluded; contact suppresses controllable charging briefly while explosion slip remains eligible. When meaningful slip ends, the bank waits 0.35 seconds and then decays at 16 energy/s.

Hold `K` or the large Boost button. With no energy it is normal boost. With energy, one press starts tier I, II, or III drift boost from the current bank. If energy is earned while normal boost is already held, release and re-press within 0.15 seconds to upgrade without a visible thrust interruption. Drift boost continues to earn from the same curve, then subtracts its tier drain, which is always larger than maximum charge. It live-downgrades through the tiers and falls back to normal boost at zero.

A newly earned bank arms one nose-biased ignition kick. The first drift boost consumes it. Releasing and reholding cannot repeat it; another kick is armed only after the bank reaches zero and new energy is earned.

Each tier has an independent visual color. The shipped cyan-blue, amber-orange, and magenta-pink progression tints its energy-meter segment, the active Boost button, exhaust plume, boost light, and terrain illumination. Tier numerals, segmented geometry, and status labels remain the authoritative non-color cues.

The chase cameras favor actual travel direction continuously as slip grows and return elastically afterward. Cockpit view remains rigid. The central cue and three-segment annular meter expose the same authoritative state. Automatic slip emits thick irregular ash from one center-tail anchor through a fixed-capacity, single-draw particle pool.

Terrain and meteor contact uses surface-relative restitution and friction, emits bounded world-space sparks, and flashes the closest aircraft triangle vertices red. It does not create drift energy, enter an error state, or restore a checkpoint. The screen-fixed CSS 3D route arrow and delayed wrong-way warning remain independent of drift.

Settings persist under `aer0lith.settings.v5`; section expansion persists separately. Existing v4, v3, and older visual settings migrate automatically. Legacy angle thresholds become slip-speed thresholds, legacy charge rate is converted to the new scale, and the unsafe manual-drift grip default becomes the new hard-turn grip default.
