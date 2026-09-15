# Development history

This document reconstructs Aer0lith’s design evolution from the development conversation and the resulting source tree. The project began under the working names Flow and VECTOR before adopting Aer0lith. The Git repository was created after the interactive prototype had already been built, so these milestones are a narrative record—not a claim that exact historical source snapshots existed for every stage.

## 1. Endless flight foundation

The project began as a minimal Vite, TypeScript, and Three.js visual toy: a procedural low-poly aircraft flying indefinitely through deterministic terrain. The first architecture established a fixed-step flight simulation, autopilot/manual transitions, bounded terrain chunks, safe checkpoints, collision recovery, floating-origin rebasing, three cameras, a semantic DOM HUD, generated audio, and a CRT-inspired postprocess.

The visual direction came from monochrome technical displays, sparse aircraft tracking interfaces, point-cloud terrain, bitmap telemetry, thin leader lines, cyan sensor accents, warm route markers, and restrained CRT artifacts. Social-media chrome from the reference screenshots was intentionally excluded.

## 2. Flight, camera, and interface refinement

Manual steering was corrected and simplified: pitch directions were fixed, yaw-only Q/E controls were removed, and A/D became coordinated roll plus weaker yaw. Throttle became a temporary boost with a 120 M/S ceiling rather than leaving manual flight stuck at maximum speed.

The camera order settled on cockpit, chase, and far chase, with chase as the default. Orbit interaction was added to the exterior cameras, including a delayed, smooth return to their follow poses. A floating-origin camera jump was traced to incomplete camera rebasing and fixed by shifting the camera’s complete internal state atomically.

The UI evolved into Analysis and Ambient modes, consolidated around monochrome technical typography. Fullscreen, touch-safe buttons, mobile telemetry, a pitch/roll joystick, gesture suppression, multi-touch routing, and persistent settings made the same experience practical on desktop and mobile.

## 3. Terrain rendering and scan language

The original heightfield and regular valley gave way to a volumetric density field. Domain-warped noise, porous cuts, gyroid-like formations, and a guaranteed three-dimensional air vein now form caves, holes, arches, roofs, narrow constrictions, and broad chambers. Cubic chunks sample the shared field and extract its zero surface with marching tetrahedra in background workers.

Terrain presentation went through point-cloud, mesh, and hybrid experiments. The current shader supports a transparent dot mode and a faceted mesh mode. Projected world-space SDF dots visualize the extracted surface; probe waves temporarily reveal the opposite representation. Distance fog, proximity danger color, adjustable dot density, and double-sided rendering preserve the sparse sensor-display aesthetic.

The probe became a shader-driven spherical wave with a persistent blue afterglow and visual-only displacement. Its color blends with the underlying terrain instead of replacing it. Scanned flock members receive white, open-corner world-space target boxes whose color and thickness are configurable.

## 4. Motion and environmental life

Dual wing-root trails replaced a single rear trail. Both the trails and golden autopilot guide use bounded histories and shader fades, preventing unbounded memory growth. The route is stable in world space and fades before reaching or passing the aircraft.

Wind streaks were researched and rebuilt as a fixed, world-persistent pool of camera-facing ribbons aligned with relative airflow. Their count, threshold, length, opacity, and color are adjustable, while throttle increases trail intensity and camera FOV without overwhelming the scene.

Abstract flock encounters use deterministic, pooled boids with separation, alignment, cohesion, terrain avoidance, and predictive aircraft avoidance. Each member is an elongated square pyramid. Flock count, interval, spread, speed, color, target color, and target thickness are persisted settings. No flock or target objects are allocated during normal runtime updates.

## 5. Output quality and native packaging

CRT processing was split into adjustable curvature, RGB phosphor mask, scanlines, grain, vignette, chromatic separation, and ordered dithering. Final glow remains the last image pass. Rendering now defaults to full resolution with linear filtering and a 1.5 device-pixel-ratio cap; balanced 80% and opt-in adaptive modes provide performance fallbacks.

Capacitor packages the same production bundle as a local iOS app. The repository includes the native Xcode project, themed vector-derived app icon, and repeatable web and device build instructions.

## Engineering principles retained throughout

- Deterministic seeded worlds through the public `?seed=` URL parameter.
- Fixed-capacity pools for terrain, trails, wind, flocks, and scan targets.
- Shared world functions for rendering, autopilot, and collision.
- World coordinates measured as meters with floating-origin precision maintenance.
- Pure simulation code covered by Node’s built-in test runner.
- No external scene assets, backend, physics engine, UI framework, or audio files.
