# Aer0lith

An endless retro-futurist flight experiment built with Three.js, vanilla TypeScript, and Vite. A deterministic 3D density field forms an infinite alien world of caves, apertures, arches, roofs, constrictions, and open chambers around a procedural aircraft. All geometry, visual effects, and audio are generated at runtime; there are no downloaded scene assets or backend services.

The world is divided into pooled cubic chunks. Each chunk samples the same world-space density function and polygonizes its zero surface with marching tetrahedra, a compact Marching Cubes-family method. The density function combines a varying three-dimensional flight vein, domain-warped volumetric noise, porous wall cuts, and sparse gyroid formations. Positive values are solid and negative values are air. A narrow central air passage is always carved last, keeping the world indefinitely navigable without reducing every area to a regular valley.

The wind-streak field uses a fixed pool of world-persistent instanced ribbons inside an aircraft-following volume. Streak positions do not inherit camera rotation, so orbit and camera transitions reveal parallax; their long axes follow relative airflow, while only their narrow widths billboard toward the camera. Terrain depth testing and the scene's distance fog keep the effect embedded in the world rather than drawn as a screen overlay. Spawns cover the full elliptical area, including the center. Count and length scale with aircraft speed; independent response sliders adjust each behavior, with the count capped at 240.

Occasional abstract flocks are simulated as pooled boids and drawn as elongated square pyramids in one instanced mesh. Local separation, alignment, and cohesion create the group motion; predictive aircraft avoidance and volumetric terrain-gradient avoidance take priority near hazards. Probe waves reveal pooled world-space corner targets around scanned flock members. See [Terrain sampling and dot rendering](docs/terrain-sampling-and-dot-rendering.md) for a visual explanation of the density lattice, extracted mesh, and projected SDF dots, and [Development history](docs/development-history.md) for the project’s design evolution.

Proximity meteors sample an individual 50–65 meter surface trigger and 0–0.5 second fuse delay when spawned. Dormant rocks are dark gray; approach produces a ship-facing white hotspot, which freezes at the exact surface direction where the fuse arms without recoloring the rest of the rock. Fresh fragments begin white and cool to dark ash as they age. An armed fuse continues after the aircraft leaves its trigger radius; pause freezes it.

## Run the web version

See the [laptop and iPhone setup guide](SETUP.md) for first-time setup, troubleshooting, and a complete copy-paste block that builds, installs, and launches the app on Steve's iPhone.

The [spaceship design study](docs/spaceship-design-research.md) and [flight-interface research](docs/ui-interaction-design-research.md) include annotated image references and downloadable PDF reports under `output/pdf/`. The spaceship study records an earlier concept; the current ship is described below.

Requires Node.js 22.12 or newer.

Install dependencies once, then start the development server:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, normally [http://127.0.0.1:5173](http://127.0.0.1:5173). Changes to the source reload automatically.

To build and preview the production web version:

```bash
npm run build
npm run preview
```

Open the preview URL printed by Vite. Run `npm run verify` to type-check, run the deterministic simulation tests, and create a production build.

## Controls

| Input | Action |
| --- | --- |
| `W` / `S` | Pitch nose up / down |
| `A` / `D` | Coordinated roll and yaw left / right |
| `Q` / `E` | One 360° dodge roll left / right; also available above the joystick |
| `J` | Hold to drift. The angle between the aircraft nose and controllable velocity charges drift energy. |
| `K` | Hold to spend drift energy on an automatic three-tier drift boost; without energy this is normal boost. |
| `T` | Toggle autopilot |
| Hold `Space` / fire icon | Shoot bullets from randomized wing tips; release to stop |
| `F` | Trigger a terrain probe wave |
| `G` | Fire the Pulse Cannon |
| `C` or `1`–`3` | Cycle or select camera |
| Mouse in camera `2` / `3` | Left-drag orbit, right-drag pan, wheel zoom; Shift does not change drag actions. Camera returns after release. |
| `U` | Toggle Analysis / Ambient presentation mode |
| `M` | Toggle audio |
| `I` | Recover at the latest safe checkpoint |
| Pause button / `P` / `Escape` | Pause / resume simulation |
| `Shift` + `N` | Generate a new seeded world |
| `Alt` / `Option` + `Enter` | Toggle fullscreen |

Any flight input takes control from autopilot. Autopilot is the default endless-flight mode and continuously maintains terrain clearance. Ambient mode removes the interface and scanned flock target boxes while retaining the active autopilot guide, aircraft, and terrain; press `U` or the faint Analysis button to restore the interface. Audio starts muted and is synthesized through the Web Audio API after it is explicitly enabled.

Camera `1` is the cockpit view, camera `2` is the default chase view, and camera `3` is a higher, farther chase view. The chase views remain tightly behind the aircraft in normal flight and expose a restrained rear-side angle while drifting.

Pause holds the current frame's aircraft, flocks, scan boxes, wind, trails, probe wave, route fade, and CRT animation. Rendering continues so camera selection, orbit/pan/zoom, and appearance settings remain usable. Paused orbit stays where you leave it. Resume continues from the same simulation state without catching up elapsed wall time. The pause button remains visible in Ambient mode.

Scan boxes retain their selected color while fading through per-instance alpha.

The spacecraft uses just 10 triangles: a six-triangle pointed diamond-section hull and four single-triangle wings arranged in an X. One mesh and one adjustable color cover the entire ship; there are no separate canopy, engine, or trim colors.

Settings > Motion Blur controls subtle speed-dependent scenery blur: enable, strength, start speed, and maximum streak length. The default strength is 0.45, starting at 20 m/s with a 12-pixel cap at 1080p. The ship and HUD stay sharp, and the paused scene retains a stable exposure. See [motion-blur behavior and implementation](docs/motion-blur.md).

Press Q/E or use the two buttons above the joystick for a 360° lateral dodge; collision remains active. Boost flames retain an adjustable visual-only idle level (20% by default), intensify while boosting, flutter faster at higher speed, and return to that baseline over the release fade. Camera shake still settles to zero independently and the idle visual adds no physical thrust. Physical boost gradually sweeps all four wings backward and tucks each upper/lower pair toward the center; adjustable angles and response speed deliberately let the wings lag the engine. Side wakes and flames each have separate backward-flow and flutter-speed controls; all four scale with aircraft speed. Thin wing-tip trails now communicate boost, while drifting alone emits configurable thick, irregular ash clouds from a fixed particle pool. **Boost + Wakes** contains wing-fold, effect, and opaque wake inspection controls; **Drift Trail** controls ash rate, size, life, opacity, turbulence, and color. **Scan Effects** adjusts terrain scanning and the separate expanding spherical glass shell. The same mesh is recycled for every scan. **Flight Visuals** controls the body color and opacity visible through obstacles (yellow at 49% by default), with a fully opaque white outline. Pause freezes motion/effects while camera and appearance controls remain live. See [flight effects](docs/flight-effects.md) for behavior and rendering details.

The world convention is one Three.js unit per meter. `ALT` is absolute world altitude relative to the procedural world's zero-meter datum, speed is shown in meters per second, and distances in the sensor settings are meters. In Analysis mode, a fixed-world thin gold line previews the autopilot route; it fades away when manual control begins. Terrain points close to the aircraft warm toward the configurable danger color as a proximity cue.

The top-right settings panel adjusts flight, drift, impact response, cameras, touch controls, terrain, effects, combat, and rendering in real time. Hover any setting title for a short explanation. Every adjustment is stored locally in the browser and restored on the next visit. Terrain defaults to RGB `200, 200, 200`, the aircraft to RGB `230, 230, 230`, and the route guide to a warm yellow. The default 96-meter danger field enlarges nearby terrain dots toward 3× and pure red using the same three-dimensional rule for floor and wall samples. Scan targets default to white with `0.16 M` corner thickness. Final glow defaults to strength 3 and radius 3. Full-resolution rendering is the default; balanced 80% and adaptive modes remain available for slower devices.

The autopilot guide is fixed in world space and fades away before reaching the aircraft. Its route bends vertically and horizontally through spaces that vary from tight covered passages to broad open chambers. All four wing trails are distance-bounded: they fade toward their oldest section and discard history beyond 360 meters. The collision overlay button reveals the aircraft collision hull and probes as yellow wireframes, switching to red during contact. Collision evaluates the same volumetric density field used to build the visible mesh. Contact no longer opens a recovery error or restores a checkpoint: the struck aircraft part flashes red and receives a bounded outward push calculated from impact speed and surface angle, while flight and combat continue.

Every 10–30 seconds of autopilot flight, the aircraft emits a light-blue terrain probe outward from its position. The automatic countdown pauses during manual control; pressing `F` still emits a probe immediately in either flight mode and restarts the interval. Propagation speed is configurable and defaults to 300 m/s. The terrain shader draws a 14.2 m advancing stripe, a separately colored 160 m afterglow behind it, and a configurable sparse plus-or-dot pattern over recently scanned ground. The default plus pattern uses 0.5 m marks on an 8 m grid and fades over five seconds. Afterglow length and falloff are adjustable, so the full scanned volume never becomes a permanent blue wash. The wave front also temporarily lifts the surface before returning it to its generated height.

## Bullets and meteor impacts

Hold **Space** or the fire crosshair button to shoot. Each shot chooses a wing and has independent timing and aim variation. The four guns aim around a point 400 m ahead of the cross by default, within a 20° forward cone. When orbiting beyond that cone, a small hollow indicator shows the actual aim center when it is on screen. Bullets travel straight after launch; they do not track targets. Default spread is 0.35° (about a 2.4 m radius at 400 m), adjustable down to exact convergence.

Bullets damage meteors without scanning. At default durability, 6 / 12 / 18 m meteors take approximately 2 / 4 / 6 hits. Missiles remain instantly lethal. Destroyed meteors produce the same fragments, glass pulse, and shake regardless of the weapon. Nearby explosions also push the aircraft away, with a short settling period; autopilot and boost remain engaged, and collision stays active.

**BULLETS** settings control frequency, timing variation, spread, convergence, speed, size, trails, colors, and muzzle flame/glass. Shared impact controls are in **METEORS / DESTRUCTION**; the influence radius controls both shake and physical push. **Velocity-Axis Push** scales only the blast component parallel to the aircraft's current travel direction (default 0.5×), leaving the perpendicular push unchanged. Set push strength to zero to disable the physical effect. Pausing freezes projectiles, flashes, trails, and forces while camera and appearance settings remain live. Releasing input, changing tabs, pausing, or recovering cancels firing; press again to resume.

See [bullet architecture and validation](docs/bullets.md) for budgets, lifecycle rules, test scenarios, and measured performance.

Terrain can also mix deterministic rock and semi-transparent crystal without
changing collision or carving. See [crystal terrain architecture and validation](docs/crystal-terrain.md).

## Run on an iPhone with Capacitor

The native app supports **landscape left and landscape right only**. This is a build setting in `ios/App/App/Info.plist`, not a runtime visual toggle. The ordinary browser version follows its browser window size. See [orientation configuration](SETUP.md#landscape-only-native-app) and the [complete phone deployment commands](SETUP.md#copy-paste-build-install-and-launch-on-steves-iphone).

Requirements: macOS with Xcode installed, an Apple development team selected in Xcode, and an unlocked iPhone with Developer Mode enabled. Connect the phone by USB and trust the Mac.

The checked-in `ios` project wraps the production Vite bundle in Capacitor. Install dependencies once, then build, sync, and deploy:

```bash
npm install
npm run build
npm run ios:sync
npm run ios:run
```

Choose the connected iPhone when prompted. To list devices or deploy directly to a known device ID:

```bash
npx cap run ios --list
npx cap run ios --target <DEVICE_ID>
```

To manage signing or run from Xcode instead:

```bash
npm run ios:open
```

In Xcode, select the `App` target, choose a development team under Signing & Capabilities, select the connected iPhone, and press Run.

After making web-code changes, use this repeatable deployment command:

```bash
npm run build && npm run ios:sync && npx cap run ios --target <DEVICE_ID>
```

## Deterministic worlds

Worlds can be revisited with the `seed` query parameter:

```text
http://localhost:5173/?seed=aer0lith-alpha
```

The same seed produces the same 3D flight route and density field across cubic chunk boundaries.

In Analysis mode, the compact meter value beside the coordinates reports the aircraft's horizontal distance from the floating render origin. It resets near zero whenever a rebase occurs but no longer flashes. This is a precision-maintenance measurement, not an edge of the infinite terrain; cubic terrain chunks recycle independently every 128 meters. Rebasing translates the camera, orbit target, cached aircraft position, and interpolation target into the new coordinate frame atomically, preserving the view without a jump.

The speedometer displays actual world-space travel speed, including lateral dodges and explosion pushes. Engine speed remains capped at 120 m/s; total movement can temporarily exceed it. Scanned meteors display 3D arrows predicting their individual explosion impulse. **Meteors → Push Vector Length** scales these arrows (default 1×, 0 hides them).
