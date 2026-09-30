# Flight effects and roll dodge

## Double-tap roll

Double-tap **A** or **D** within 320 ms to dodge left/right. On the joystick, push roughly two-thirds of the way in one direction, return near center or release, then push in that same direction again within 320 ms. Holding a key or stick does not retrigger; opposite-direction strokes break the pair. Pausing or losing focus clears pending taps.

The aircraft makes a 720-degree roll and moves 44 meters sideways over 1.2 seconds. The maneuver takes manual control and keeps forward flight and throttle active. Additional rolls cannot interrupt it; there is a 0.25-second recovery before another. Pitch/heading stay fixed during the dodge. The chase camera follows the translation without spinning with the aircraft. In cockpit view, the eye position and view roll with the ship through exactly two full turns. The roll is applied after camera-follow smoothing and removed after rendering so quaternion interpolation cannot shorten or skip turns.

The normal collision samples run on every fixed simulation step during the maneuver. Collision cancels the roll and enters normal crash recovery. There is no invulnerability or teleport. Pause freezes the maneuver.

## Boost and side wakes

A throttle press (Shift or the touch boost button) ignites twin colored plumes. Boost and brake preserve autopilot; W/S/A/D or a joystick direction takes manual control. They rise in about 65 ms, settle to a steady 42% flame while boost is held, then fade after release. Release fade defaults to 2.8 seconds and is adjustable from 0.3 to 8 seconds. Plumes default to a 54-meter maximum length and cast matching colored light onto nearby objects. A brief tap also leaves a fading flame. Disabling exhaust or setting brightness to zero explicitly hides it.

The flame has a straight centerline, broad tapered body, a bright core, and irregular fluttering tongues. Surface turbulence and tip animation use the same speed-integrated clock as the side wakes; no flame animation uses an independent fixed-speed clock.

The separate rear diamond wake has been removed. Instead, a thin refractive envelope follows each flame using the exact same geometry and flutter deformation, with independent booster refraction and dispersion controls. The compact envelope defaults to 65% of the flame length and 0.55× base width; the flame itself is 0.45× base width. Its length and width are independent controls. The opaque amber debug view shares the exact glass geometry, shader deformation, and uniforms; it replaces the flame during inspection. When idle it previews full boost size, and during boost it shows the current geometry. Debug mode resets to glass on reload. No extra geometry is allocated for toggling it.

Four independent line trails attach just behind the four X-wing tips. Live endpoints stay attached between the bounded 1.5-meter history samples. Two side wakes remain separate meshes, spanning each upper/lower wing pair at their mouths and following previous turns and bank. Defaults are 120 meters long, 14 meters tall, and 0.3 meters thick.

Both side-wake and flame flutter amplitude/frequency increase with aircraft speed. Their flow clock is integrated from speed and simulation time, avoiding a phase jump when speed changes. Appearance and camera settings remain live while paused; motion, flutter, illumination and release fade freeze.

## Boost lock

Hold Shift or the boost button for five simulation seconds, then keep holding through a two-second bottom-up fill. The label counts down those final two seconds. At seven seconds the button is white with black contents, a small expanding ripple marks completion, and boost stays on after release. A fresh press of either boost control unlocks and turns it off; that unlocking press cannot start charging again until released. This works in autopilot and manual flight.

Releasing before completion cancels the charge. Keyboard repeats and overlapping keyboard/touch holds do not restart the timer. Pausing freezes the timer and CSS animation; focus loss cancels an incomplete hold but preserves an intentional lock. Crash/checkpoint reset clears the lock. Ctrl temporarily overrides boost to brake. Reduced-motion preferences suppress the ripple.

## Controls

Flight effects live under **Settings > Boost + Wakes**. Scan optics have their own **Scan Glass** section. Values persist locally; opaque wake debug resets to glass on reload.

| Group | Controls / defaults |
| --- | --- |
| Boost | Enable; brightness 1; maximum length 54 m; release fade 2.8 s; mint color `#8cffe0` |
| Booster glass | Enable; refraction 1 (0–3); dispersion 0.18 (0–0.6); width 0.55× (0.1–2×); length 65% of flame (20–150%) |
| Flame width | 0.45× (0.15–1.5×), independent of booster glass width |
| Booster geometry button | Toggle glass / opaque amber geometry; preview full boost size when idle |
| Booster flutter | Amplitude 0.45 m (0–2); flow rate 1× (0–3), both responding to speed |
| Boost camera | Shake strength 0.65 (0–2, zero disables); frequency 14 Hz (4–30) |
| Side wakes | Enable; length 120 m (20–240); height 14 m (2–32); thickness 0.3 m (0.02–2); flutter 0.6 m (0–2) |
| Side wake glass | Refraction 1 (0–3); sheen 0.045 (0–0.2); dispersion 0.12 (0–0.4) |
| Wake geometry button | Toggle glass / opaque cyan sheets using the exact same geometry and flutter |
| Scan glass | Enable; refraction strength; dispersion; shell fade-out duration 0.8 s (0.15–2); flutter 4% of radius (0–12%); flutter speed 1× (0–4×) |
| Flight visuals | Show occluded ship; ghost opacity 0.13 (0–0.35), with a brighter outline |

A longer release fade means slower fading. Bright exhaust cores remain white while the selected color tints the plumes and illumination. Glass needs background detail to bend; orbit the paused camera across terrain edges or dots to inspect it. Existing saved appearance choices are retained; removed rear-wake settings are ignored.

## Expanding scan glass shell

`ScanGlass` renders a separate spherical glass membrane. It starts at the aircraft's world position when the scan is triggered, keeps that launch center fixed, and expands with the terrain probe's radius at 160 m/s up to 720 m. The terrain's colored ring and afterglow stay as they were; they no longer carry the glass distortion.

The membrane bends and disperses scenery behind its own surface, including distant objects that the terrain scan has not reached. Scene depth rejects objects in front of it. Both faces render so it also works when the camera is inside the expanding sphere. Animated radial flutter deforms the membrane and its silhouette, with analytic surface normals keeping glass distortion aligned to that shape. A subtle rim and smaller surface ripples reinforce the motion. **Shell Flutter** sets displacement as a percentage of scan radius (default 4%, maximum 12%); zero restores a smooth sphere. **Flutter Speed** scales the animation from 0–4×; zero holds its current shape while the scan continues expanding. The scan radius and ripple clock use simulation time, so pause freezes the shell while camera and appearance controls stay live.

**Scan Glass** controls enable, refraction, dispersion, **Shell Flutter**, **Flutter Speed**, and **Shell Fade Duration**. Flutter phase integrates simulation time, so editing speed while paused does not jump its phase. New scans reset that phase, and origin rebasing preserves it. The old duration setting is retained in storage but now controls the shell's fade-out as it approaches maximum radius, rather than a radial band on terrain. It fades in over its first 20 m and is hidden as soon as expansion finishes.

One sphere geometry, material, and mesh are allocated per app. Starting a new scan moves/resets that same mesh; completing a scan hides it for reuse. Nothing is allocated per trigger or frame. `dispose()` detaches the mesh and releases its geometry/material once; `PostProcessor.dispose()` also releases its render targets and full-screen resources when the app unloads. Back/forward-cache navigation keeps resources for restoration.

The shell shares the depth-aware refraction target with the wing wakes and booster glass. Their separate scenes draw into the same target without clearing between them, so the nearest glass surface wins. The previous terrain-depth/radial-band branch has been removed from the full-screen shader.

## Hidden ship and camera shake

A filled faint-yellow ship surface with faceted shading and a brighter edge shader draw only behind occluding geometry. The main scene's depth/stencil buffer distinguishes external occlusion from self-occlusion: visible ship fragments mark the stencil, and the ghost/outline reject those pixels. The ordinary ship remains unchanged when unobstructed. Cockpit mode hides both representations.

Boost shake applies a stronger, deterministic translation and rotation only for rendering, then restores the camera's base position/orientation. It never accumulates in camera following or OrbitControls. Boost input ramps the amplitude smoothly, speed scales it, and its clock/envelope freeze during pause. UI overlays stay stable.

## Airframe, collision, and rendering

`core/aircraftGeometry.ts` is the shared source for hull vertices, four blades, wing tips, trail anchors, and collision samples. Front and rear wing roots lie inside the fuselage. The visible model remains a monochrome 22-triangle ship.

Collision samples cover each convex part's vertices, midpoints, and centroid. They do not form a broad hull across the spaces between blades. In chase modes the collision debug wireframe uses the same visible geometry. In cockpit mode, collision switches to a compact faceted ellipsoid around the eye (3 m wide, 2.2 m tall, 5.6 m long), helping compensate for the unseen wings. It rotates with the cockpit eye and ship during rolls. The same shared points generate its debug wireframe and collision probes; the front rings and markers are visible from inside the cockpit. Returning to chase restores the full hull/wing probes immediately. These are distinct playability profiles, not a guarantee of identical perceived difficulty. This remains a sampled density-field collision check, not a continuous triangle intersection solver.

`TrailView` records the four wing-tip paths and aircraft up/right vectors. `WakeSheetGeometry` builds two extruded ribbons in pooled buffers. Geometry changes only with the trail, origin rebase, or a shape control; flutter runs in the vertex shader.

The world renders once into the main color/depth-stencil target. A small additional pass renders enabled wing sheets, booster envelopes, and the scan membrane into a shared vector/depth target. RG encodes signed displacement, B dispersion, and A sheen plus validity. Each material controls its own optics, so booster settings are independent of side-wake settings without an additional world render or texture target. Depth tests reject foreground objects and displaced samples that would pull them into the glass. At overlapping glass surfaces the nearest surface supplies the effect.

A persistent point light illuminates standard ship/flock materials. The custom terrain shader receives the same source position, color, and intensity, with bounded 46-meter falloff. No shadow maps or per-frame particle/light allocation are added.

Screen-space glass only bends scenery already visible in the current frame; it cannot trace off-screen or hidden surfaces. The refraction target follows the selected render resolution. Cockpit/disabled/inactive effects skip their geometry passes.

## Verification

`npm run verify` covers same-direction tap timing, joystick hysteresis, measured 720-degree ship and cockpit rotations in both directions, lateral distance, collision during a roll, pause, boost latch timing/release/unlock, autopilot boost/steering takeover, cockpit collision switching and debug/probe agreement, sustained boost/release timing, speed-dependent flutter, booster/side independence, shared flame deformation, camera restoration, trail anchors, shape budgets, origin rebasing, scan-shell pose/restarts/fade/disposal, and existing simulation behavior.

Browser fixtures exercise the game's keyboard handlers and completed-roll state. GPU comparisons independently verify booster refraction/dispersion, stronger scan refraction/dispersion, identical paused frames, and an unchanged unoccluded ship versus a visible silhouette/outline through an opaque object. Full-game checks cover controls, wake depth occlusion, and terrain illumination. Scan-shell GPU checks cover a distant backdrop beyond the scan radius, unchanged foreground/outside-shell pixels, identical paused frames, clean completion, and stable geometry/texture/program counts over 25 restarts.
