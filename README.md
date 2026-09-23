# Aer0lith

An endless retro-futurist flight experiment built with Three.js, vanilla TypeScript, and Vite. A deterministic 3D density field forms an infinite alien world of caves, apertures, arches, roofs, constrictions, and open chambers around a procedural aircraft. All geometry, visual effects, and audio are generated at runtime; there are no downloaded scene assets or backend services.

The world is divided into pooled cubic chunks. Each chunk samples the same world-space density function and polygonizes its zero surface with marching tetrahedra, a compact Marching Cubes-family method. The density function combines a varying three-dimensional flight vein, domain-warped volumetric noise, porous wall cuts, and sparse gyroid formations. Positive values are solid and negative values are air. A narrow central air passage is always carved last, keeping the world indefinitely navigable without reducing every area to a regular valley.

The wind-streak field uses a fixed pool of world-persistent instanced ribbons inside an aircraft-following volume. Streak positions do not inherit camera rotation, so orbit and camera transitions reveal parallax; their long axes follow relative airflow, while only their narrow widths billboard toward the camera. Terrain depth testing and the scene's distance fog keep the effect embedded in the world rather than drawn as a screen overlay.

Occasional abstract flocks are simulated as pooled boids and drawn as elongated square pyramids in one instanced mesh. Local separation, alignment, and cohesion create the group motion; predictive aircraft avoidance and volumetric terrain-gradient avoidance take priority near hazards. Probe waves reveal pooled world-space corner targets around scanned flock members. See [Terrain sampling and dot rendering](docs/terrain-sampling-and-dot-rendering.md) for a visual explanation of the density lattice, extracted mesh, and projected SDF dots, and [Development history](docs/development-history.md) for the project’s design evolution.

## Run the web version

See the [laptop and iPhone setup guide](SETUP.md) for first-time setup, troubleshooting, and a complete copy-paste block that builds, installs, and launches the app on Steve's iPhone.

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
| `Shift` / `Ctrl` | Increase / decrease throttle |
| `Space` | Toggle autopilot |
| `C` or `1`–`3` | Cycle or select camera |
| Mouse in camera `2` / `3` | Orbit, pan, and zoom; camera returns after release |
| `V` | Toggle Analysis / Ambient presentation mode |
| `M` | Toggle audio |
| `R` | Recover at the latest safe checkpoint |
| `B` | Trigger a terrain probe wave |
| Pause button / `P` / `Escape` | Pause / resume simulation |
| `N` | Generate a new seeded world |
| `Ctrl` / `Cmd` + `F` | Toggle fullscreen |

Any flight input takes control from autopilot. Autopilot is the default endless-flight mode and continuously maintains terrain clearance. Ambient mode removes the interface while retaining the active autopilot guide, aircraft, and terrain; press `V` or the faint Analysis button to restore the interface. Audio starts muted and is synthesized through the Web Audio API after it is explicitly enabled.

Camera `1` is the cockpit view, camera `2` is the default chase view, and camera `3` is a higher, farther chase view that follows directly behind the aircraft.

Pause holds the current frame's aircraft, flocks, scan boxes, wind, trails, probe wave, route fade, and CRT animation. Rendering continues so camera selection, orbit/pan/zoom, and appearance settings remain usable. Paused orbit stays where you leave it. Resume continues from the same simulation state without catching up elapsed wall time. The pause button remains visible in Ambient mode.

Scan boxes retain their selected color while fading through per-instance alpha.

The spacecraft uses just 22 triangles: a pointed diamond-section hull and four tetrahedral wings arranged in an X. One mesh and one adjustable color cover the entire ship; there are no separate canopy, engine, or trim colors.

Settings > Motion Blur controls subtle speed-dependent scenery blur: enable, strength, start speed, and maximum streak length. The default strength is 0.45, starting at 20 m/s with a 12-pixel cap at 1080p. The ship and HUD stay sharp, and the paused scene retains a stable exposure. See [motion-blur behavior and implementation](docs/motion-blur.md).

The world convention is one Three.js unit per meter. `ALT` is absolute world altitude relative to the procedural world's zero-meter datum, speed is shown in meters per second, and distances in the sensor settings are meters. In Analysis mode, a fixed-world thin gold line previews the autopilot route; it fades away when manual control begins. Terrain points close to the aircraft warm toward the configurable danger color as a proximity cue.

The top-right settings panel adjusts terrain rendering, fog, dots, plane and route colors, wind, flock behavior and scan targets, CRT processing, final glow, render resolution, and the UI typeface in real time. Every adjustment is stored locally in the browser and restored on the next visit. Terrain defaults to RGB `200, 200, 200`, the aircraft to RGB `230, 230, 230`, and the route guide to a warm yellow. The default 96-meter danger field enlarges nearby terrain dots toward 3× and pure red using the same three-dimensional rule for floor and wall samples. Scan targets default to white with `0.16 M` corner thickness. Final glow defaults to strength 3 and radius 3. Full-resolution rendering is the default; balanced 80% and adaptive modes remain available for slower devices.

The autopilot guide is fixed in world space and fades away before reaching the aircraft. Its route bends vertically and horizontally through spaces that vary from tight covered passages to broad open chambers. Both wing trails are distance-bounded: they fade toward their oldest section and discard history beyond 360 meters. The collision overlay button reveals the aircraft collision hull and probes as yellow wireframes, switching to red during contact. Collision evaluates the same volumetric density field used to build the visible mesh, so ceilings, walls, floating structures, and floors all collide consistently.

Every 10–30 seconds, the aircraft emits a fast light-blue terrain probe from the ground region directly beneath its position. The terrain shader renders its continuous ring, recolors scanned dots with a lingering afterglow, and temporarily lifts the surface before returning it to its generated height. Pressing `B` emits a probe immediately and restarts the automatic interval.

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
