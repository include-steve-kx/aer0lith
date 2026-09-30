# Tuned defaults and proximity meteors

The shipped preset now matches the settings captured from the existing Chrome
simulator on September 30, 2026. Notable choices include mesh terrain, sky
`#3f89a2`, mesh `#5e6768`, blue exhaust `#8ab7ff`, 3.5 m high / 0.08 m thick
side wakes, 36 bullets per second, and 180 m / 6 s missile trails.

Existing saved choices are preserved. Fresh installations use the new preset.
The red **RESET ALL SETTINGS TO DEFAULT** button at the bottom of Settings
restores every setting in the panel, clears debug modes, applies changes live,
and persists the preset. It does not restart the world or change audio/camera
controls outside the panel. Reset also works while paused.

Ranges now give the tuned values room for adjustment: exhaust strength 0–4,
booster/scan dispersion 0–1.2, scan refraction 0–4, missile trails up to 360 m /
12 s, bullet bolts up to 8 m and trails up to 2 s. Thin wake controls have finer
steps. Blast influence is now 20–1,000 m, default **400 m**, replacing the
captured 200 m default. Push strength defaults to **30 m/s** (range 0–180 m/s),
with **2 s** settling (range 0.2–4 s). Accumulated external velocity is capped
at 180 m/s to contain overlapping explosions while allowing meteor size scaling.
This is separate from the engine speed and the proximity detonation distance.

The revised meteor preset uses **6–36 m** rocks, **12** per encounter, **5 m/s**
drift, **20°/s** spin, **30 m** spread, **0.5** irregularity, and **4** bullet hits
at 12 m diameter. Diameter sliders now reach 72 m, encounter count 24, drift
10 m/s, and spin 40°/s. The 48-active-rock cap and bounded safe placement remain
in force; encounters can spawn fewer rocks when space is insufficient.
Irregularity stays within the five supported prebuilt shape levels (0–0.5).

Cruise speed is **90 m/s**, with the **120 m/s** maximum unchanged. Autopilot
still slows for turns and obstacle avoidance. The full 360° dodge takes
**0.6 s**, followed by **0.125 s** recovery; lateral displacement stays **44 m**.

Meteors have an independent white danger color (`#ffffff`) and a proximity
explosion toggle. The default trigger clearance is **50 m** from the bounding
surface of the rock (adjustable 5–150 m). The tint smoothly increases from zero
at three times that clearance to full intensity at the trigger boundary.
Changing the distance updates both the fuse and the warning band. Tint and fuse
use aircraft distance, independent of camera orbit, scanning, and weapons.

Relative-motion sweeps catch fast passes and moving rocks without terrain
visibility queries. Proximity destruction uses the same meteor-owned path as
weapons, invalidating missiles/markers and creating fragments, refraction,
shake, and a physical push once. Ship collisions take priority within a fixed
step. Pause freezes fuses and physics; appearance edits remain live. There is
no splash damage or chain reaction.

Validation: `npm run verify` passes 134 tests and the production build. Browser
checks compared every reset control against the captured preset, including the
400 m radius and 30 m/s push overrides, then verified changed values/debug flags reset and survive
reload. New tests cover warning/fuse boundaries, fast relative sweeps, pause,
disabled fuses, stale handles, slider bounds, 90/120 m/s cruise/boost, and the
shortened roll/recovery with unchanged displacement.

Scanned push arrows use the same `MeteorSystem.predictExplosionImpulse` calculation
as physical destruction, from the meteor center. Impulse is strength × smooth
radius falloff × clamp(diameter / 12, 0.5, 1.5), directed away from the meteor.
At coincident centers, opposite ship-forward is the shared fallback. The arrow
represents one explosion, before combining residual velocity/other explosions
and applying the accumulated cap. Its tip is center + impulse × display scale.
Arrows fade with detection, remain readable through rocks/terrain, and disappear
with UI-off, markers-off, zero push, zero display scale, or expired detections.
Two fixed instanced batches cover all 48 meteors; no terrain queries are added.
The display scale is live while paused and does not modify physical forces.

`tests/fixtures/push-vectors.html` provides a paused three-size arrow scene,
keyboard triple-tap/unlock checks, and a boosted sideways-blast speedometer check.
