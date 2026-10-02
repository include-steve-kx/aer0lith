# Flight effects and roll dodge

## Dedicated dodge roll

Press **Q** / **E**, or the left/right roll buttons above the joystick, to dodge. A/D and the joystick only steer through coordinated roll and yaw; repeated steering never triggers a maneuver. Holding Q/E does not retrigger. The roll buttons also support keyboard activation and are disabled while paused.

The aircraft makes a 360-degree roll and moves 44 meters sideways over 1.2 seconds. The maneuver takes manual control and keeps forward flight and throttle active. Additional rolls cannot interrupt it; there is a 0.25-second recovery before another. Pitch/heading stay fixed during the dodge. The chase camera follows the translation without spinning with the aircraft. In cockpit view, the eye position and view roll with the ship through exactly one full turn. The roll is applied after camera-follow smoothing and removed after rendering so quaternion interpolation cannot shorten or skip turns.

The normal collision samples run on every fixed simulation step during the maneuver. Collision cancels the roll and enters normal crash recovery. There is no invulnerability or teleport. Pause freezes the maneuver.

## Boost and side wakes

A throttle press (Shift or the touch boost button) ignites twin colored plumes. Boost preserves autopilot; W/S/A/D or a joystick direction takes manual control. They rise in about 65 ms, settle to a steady 42% flame while boost is held, then fade after release. Release fade defaults to 3.6 seconds and is adjustable from 0.3 to 8 seconds. Plumes default to a 54-meter maximum length and cast matching colored light onto nearby objects. A brief tap also leaves a fading flame. Disabling exhaust or setting brightness to zero explicitly hides it.

The flame has a straight centerline, broad tapered body, a bright core, and irregular fluttering tongues. Surface detail travels backward from the nozzles while the tongues flutter independently. Both motions integrate aircraft speed; neither uses a fixed-speed wall clock.

The separate rear diamond wake has been removed. Instead, a thin refractive envelope follows each flame using the exact same geometry and flutter deformation, with independent booster refraction and dispersion controls. The compact envelope defaults to 65% of the flame length and 0.55× base width; the flame itself is 0.45× base width. Its length and width are independent controls. The opaque amber debug view shares the exact glass geometry, shader deformation, and uniforms; it replaces the flame during inspection. When idle it previews full boost size, and during boost it shows the current geometry. Debug mode resets to glass on reload. No extra geometry is allocated for toggling it.

Four independent line trails attach just behind the four X-wing tips. Live endpoints stay attached between the bounded 1.5-meter history samples. Two side wakes remain separate meshes, spanning each upper/lower wing pair at their mouths and following previous turns and bank. Defaults are 120 meters long, 14 meters tall, and 0.3 meters thick.

Four independent controls set **Side Backward Speed**, **Side Flutter Speed**, **Flame Backward Speed**, and **Flame Flutter Speed** (each 0–3×, default 1×). Backward flow advances surface ripples/turbulence in aircraft-relative meters at aircraft speed times the selected multiplier. Flutter advances at aircraft speed / 55 m/s times its multiplier. Thus doubling aircraft speed doubles all four animation rates. Zero freezes only the selected component. The sheet mouths and flame roots stay attached to the ship, and wake geometry still follows the recorded flight path. Flutter amplitude also scales with speed. Integrating each phase avoids jumps when speed or a rate setting changes. Appearance and camera settings remain live while paused; motion, flutter, illumination and release fade freeze.

## Boost lock

Hold Shift or the boost button for momentary boost. Three presses with at most 0.4 simulation seconds between presses lock boost immediately. The icon button switches to its filled locked state, without a countdown. A fresh press unlocks and turns boost off until released. Autopilot remains engaged.

Keyboard repeats and overlapping keyboard/touch holds count as one press. Long holds never lock. Focus loss clears an incomplete tap sequence but preserves an intentional lock; crash/checkpoint reset clears it.

## Controls

Flight effects live under **Settings > Boost + Wakes**. Scan terrain and optics have their own **Scan Effects** section. Values persist locally; opaque wake debug resets to glass on reload.

| Group | Controls / defaults |
| --- | --- |
| Boost | Enable; brightness 2; maximum length 54 m; release fade 3.6 s; blue color `#8ab7ff` |
| Booster glass | Enable; refraction 0.7 (0–3); dispersion 0.6 (0–1.2); width 0.55× (0.1–2×); length 100% of flame (20–150%) |
| Flame width | 0.45× (0.15–1.5×), independent of booster glass width |
| Booster geometry button | Toggle glass / opaque amber geometry; preview full boost size when idle |
| Booster motion | Flutter amplitude 0.9 m (0–2); backward speed 1× and flutter speed 1× (each 0–3×), independently responding to aircraft speed |
| Boost camera | Shake strength 1.3 (0–2, zero disables); frequency 20 Hz (4–30) |
| Side wakes | Enable; length 120 m (20–240); height 3.5 m (2–32); thickness 0.08 m (0.02–2); flutter 0.65 m (0–2) |
| Side wake motion | Backward speed 0.5× and flutter speed 1× (each 0–3×), independently responding to aircraft speed |
| Side wake glass | Refraction 1.75 (0–3); sheen 0.045 (0–0.2); dispersion 0.12 (0–0.4) |
| Wake geometry button | Toggle glass / opaque cyan sheets using the exact same geometry and flutter |
| Terrain scan | Propagation speed; plus or dot markers; marker spacing, size, color, brightness, and fade duration; front stripe width, color, and brightness; afterglow color, length, and falloff |
| Scan glass | Enable; refraction 2; dispersion 0.6; shell fade-out duration 1 s (0.15–2); flutter 2% of radius (0–12%); flutter speed 1.55× (0–4×) |
| Flight visuals | Show occluded ship; ghost color `#ffee66`; ghost opacity 49% (0–100%); white outline always 100% |

A longer release fade means slower fading. Bright exhaust cores remain white while the selected color tints the plumes and illumination. Glass needs background detail to bend; orbit the paused camera across terrain edges or dots to inspect it. Opaque inspection keeps the underlying glass pass active and masks only the inspected surfaces, so switching back restores the glass immediately even while paused. Both debug buttons use the same appearance. Existing saved appearance choices are retained; removed rear-wake settings are ignored.

## Expanding scan glass shell

`ScanGlass` renders a separate spherical glass membrane. It starts at the aircraft's world position when the scan is triggered, keeps that launch center fixed, and expands with the terrain probe's configurable speed (300 m/s by default) up to 720 m. The terrain shader separately draws a configurable colored stripe at the advancing front, a bounded tint behind it with independent color, length, and falloff, and a sparse plus-or-dot pattern over recently scanned ground. The tint retires from the stopped front at the selected scan speed, so it never becomes an unbounded blue wash over the full scanned volume.

The membrane bends and disperses scenery behind its own surface, including distant objects that the terrain scan has not reached. Scene depth rejects objects in front of it. Both faces render so it also works when the camera is inside the expanding sphere. Animated radial flutter deforms the membrane and its silhouette, with analytic surface normals keeping glass distortion aligned to that shape. A subtle rim and smaller surface ripples reinforce the motion. **Shell Flutter** sets displacement as a percentage of scan radius (default 2%, maximum 12%); zero restores a smooth sphere. **Flutter Speed** scales the animation from 0–4×; zero holds its current shape while the scan continues expanding. The scan radius and ripple clock use simulation time, so pause freezes the shell while camera and appearance controls stay live.

**Scan Glass** controls enable, refraction, dispersion, **Shell Flutter**, **Flutter Speed**, and **Shell Fade Duration**. Flutter phase integrates simulation time, so editing speed while paused does not jump its phase. New scans reset that phase, and origin rebasing preserves it. The old duration setting is retained in storage but now controls the shell's fade-out as it approaches maximum radius, rather than a radial band on terrain. It fades in over its first 20 m and is hidden as soon as expansion finishes.

One sphere geometry, material, and mesh are allocated per app. Starting a new scan moves/resets that same mesh; completing a scan hides it for reuse. Nothing is allocated per trigger or frame. `dispose()` detaches the mesh and releases its geometry/material once; `PostProcessor.dispose()` also releases its render targets and full-screen resources when the app unloads. Back/forward-cache navigation keeps resources for restoration.

The shell shares the original depth-aware refraction target with the wing wakes, booster glass, bullet muzzle glass, Pulse glass, and explosion glass. Their separate scenes draw into that single-output target without clearing between them, so the nearest existing glass surface wins. Crystal terrain uses an isolated two-output target. The final post-process depth-sorts these two retained systems, resolves the rear result, and then applies the front result, so scan or wake glass no longer erases crystal behind it. Keeping the targets separate prevents legacy one-output glass shaders from leaving the crystal color attachment undefined. The previous terrain-depth/radial-band branch has been removed from the full-screen shader.

## Hidden ship and camera shake

A yellow ship surface (default `#ffee66`, matching the default autopilot guide) at 49% opacity and a fully opaque white edge shader draw only behind occluding geometry. The main scene's depth/stencil buffer distinguishes external occlusion from self-occlusion: visible ship fragments mark the stencil, and the ghost/outline reject those pixels. The opaque ship explicitly renders after terrain and flock bodies, so only genuinely visible pixels receive this mark. Previously, terrain and the ship shared a render priority: material sorting could mark the ship before terrain covered it, incorrectly suppressing the yellow interior. Body color and opacity are independently configurable; zero body opacity leaves the outline visible. Existing default opacity migrates from 13% to 49%, while custom values are preserved. The ordinary ship remains unchanged when unobstructed. Cockpit mode hides both representations.

Boost shake applies a stronger, deterministic translation and rotation only for rendering, then restores the camera's base position/orientation. It never accumulates in camera following or OrbitControls. Shake follows only the initial acceleration flare. After the 65 ms attack, both amplitude and frequency taper to exactly zero over the configured **Release Fade Time** (default 3.6 seconds), even when boost remains held or locked. The flame still settles to its sustained 42% intensity. Shake has a separate timer starting at ignition; releasing early does not restart or extend it, and releasing an already settled boost cannot restart shake. A fresh boost press starts a new transient. The frequency setting is the peak rate, integrated over simulation time to avoid phase jumps as it fades or is edited. Aircraft speed also scales amplitude; pause freezes both phase and envelope. UI overlays stay stable. Shift + left-drag orbits normally without activating pan; right-drag still pans, including while boosting.

## Wind streak distribution and speed

Streaks are world-persistent instanced ribbons in an aircraft-following elliptical volume (150 m horizontal radius, 92 m vertical radius, extending 305 m behind and 225 m ahead). A deterministic pseudo-random sequence chooses positions. Angle is uniform and radius is `sqrt(U)`, giving uniform cross-sectional area, including the center. Initial depth is uniform; particles leaving the bounds recycle ahead and fade in. The pool is fixed at 240; changing the visible count does not allocate or reposition particles.

The previous distribution excluded a 14 m central radius and faded streaks around screen center. Both biases have been removed. Equal world-space density still does not imply equal screen-space density: streaks directly ahead foreshorten, terrain hides them, and distance/near-aircraft fading still applies.

**Wind Streaks** now sets count and length at a reference speed of 55 m/s. Independent **Count Speed Response** and **Length Speed Response** sliders range from 0 to 2: 0 holds that quantity constant, 1 scales linearly with speed (default), and 2 gives a stronger quadratic response. The formula is `base × (speed / 55)^response`, with the speed ratio capped at 3 and rendered count capped at 240. The final fractional streak fades smoothly as count changes. Defaults yield about 65.5 streaks / 12 m at 30 m/s, 120 / 22 m at 55 m/s, and 240 / 44 m at 110 m/s. Individual streak lengths also vary slightly to avoid repetition. The existing opacity threshold remains independent.

## Airframe, collision, and rendering

`core/aircraftGeometry.ts` is the shared source for hull vertices, four blades, wing tips, trail anchors, and collision samples. Front and rear wing roots lie inside the fuselage. The visible model remains a monochrome 22-triangle ship.

Collision samples cover each convex part's vertices, midpoints, and centroid. They do not form a broad hull across the spaces between blades. In chase modes the collision debug wireframe uses the same visible geometry. In cockpit mode, collision switches to a compact faceted ellipsoid around the eye (3 m wide, 2.2 m tall, 5.6 m long), helping compensate for the unseen wings. It rotates with the cockpit eye and ship during rolls. The same shared points generate its debug wireframe and collision probes; the front rings and markers are visible from inside the cockpit. Returning to chase restores the full hull/wing probes immediately. These are distinct playability profiles, not a guarantee of identical perceived difficulty. This remains a sampled density-field collision check, not a continuous triangle intersection solver.

`TrailView` records the four wing-tip paths and aircraft up/right vectors. `WakeSheetGeometry` builds two extruded ribbons in pooled buffers. Geometry changes only with the trail, origin rebase, or a shape control; flutter runs in the vertex shader.

The world renders once into the main color/depth-stencil target. A small additional pass renders enabled wing sheets, booster envelopes, the scan membrane, bullet muzzle glass, Pulse glass, and explosion glass into their shared vector/depth target. RG encodes signed displacement, B dispersion, and A sheen plus validity. Each material controls its own optics, so booster settings are independent of side-wake settings without another world render. Crystal terrain renders into a separate target only while active. Depth tests reject foreground objects and displaced samples that would pull them into the glass. At overlapping existing-glass surfaces the shared depth buffer chooses the nearest. The final post-process then composes that retained surface and crystal back-to-front without adding another draw pass.

A persistent point light illuminates standard ship/flock materials. The custom terrain shader receives the same source position, color, and intensity, with bounded 46-meter falloff. No shadow maps or per-frame particle/light allocation are added.

Screen-space glass only bends scenery already visible in the current frame; it cannot trace off-screen or hidden surfaces. The refraction target follows the selected render resolution. Cockpit/disabled/inactive effects skip their geometry passes.

## Verification

`npm run verify` covers measured 360-degree ship and cockpit rotations in both directions, lateral distance, collision during a roll, pause, boost latch timing/release/unlock, autopilot boost/steering takeover, cockpit collision switching and debug/probe agreement, sustained boost/release timing, all four independent speed-integrated animation phases, speed-responsive wind count/length and uniform spawn coverage, booster/side independence, shared flame deformation, camera restoration, trail anchors, shape budgets, origin rebasing, scan-shell pose/restarts/fade/disposal, and existing simulation behavior.

Browser fixtures exercise the game's keyboard handlers and completed-roll state. GPU comparisons independently verify booster refraction/dispersion, stronger scan refraction/dispersion, identical paused frames, and an unchanged unoccluded ship versus a visible silhouette/outline through an opaque object using terrain’s actual render priority. Separate GPU checks animate each of the four flow/flutter controls, verify zero freezes that component, and verify editing rates does not jump the paused image. Full-game checks cover controls, wake depth occlusion, and terrain illumination. Scan-shell GPU checks cover a distant backdrop beyond the scan radius, unchanged foreground/outside-shell pixels, identical paused frames, clean completion, and stable geometry/texture/program counts over 25 restarts.
