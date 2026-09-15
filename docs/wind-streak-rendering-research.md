# Wind-Streak Rendering for a Three.js Flight Experience

## Executive finding

The wind streaks should **not live in camera space** in the sense that their positions and motion rotate with the camera. That is the main reason the current effect feels wrong.

The cleanest design for this project is a **camera/aircraft-following, world-simulated streak volume**:

- Keep a fixed-size particle volume centered near and moving with the aircraft so the density remains stable during an endless flight.
- Once a streak is spawned, keep its position in render/world space for its short lifetime. Camera orbit must reveal parallax instead of dragging the streak with the viewport.
- Move and stretch streaks along the **relative airflow vector**: ambient wind minus aircraft velocity.
- Use the camera only to form the thin ribbon's width and project it—not to determine the streak's location or long axis.
- Depth-test streaks against terrain, apply the same distance fog, and fade them near the volume boundaries.
- Reserve a very faint screen-space radial accent for unusually strong throttle, if desired. Treat that as a graphic boost cue, not as the wind itself.

This is a hybrid space, but not a compromise: simulation and rendering genuinely need different coordinate frames. Unity explicitly separates local, world, and custom particle simulation spaces; Unreal similarly separates sprite facing from velocity alignment; Three.js particle implementations such as three.quarks keep particle position separate from a camera-aware, velocity-aligned billboard calculation.[^1][^2][^3]

## Scope and method

I reviewed:

- Official particle/VFX documentation from Unity, Unreal Engine, and Microsoft Flight Simulator.
- Open-source speed-line and Three.js particle shaders.
- Developer write-ups for high-speed flight/movement effects.
- NVIDIA material on racing-game motion blur and fast-moving flight VFX.
- The current `WindView.ts` implementation in this repository.

The sources do not identify one universal “wind streak” algorithm. They reveal several distinct effects that are often given the same name. Choosing the right one depends on whether the visual is meant to represent airborne matter, camera motion, or a deliberately graphic acceleration cue.

## First distinction: four meanings of “camera space”

It helps to separate four concepts that are easy to conflate:

1. **Camera-local simulation** — particle coordinates are children of the camera. Turning or orbiting the camera rotates and translates the entire field. This is what the current implementation effectively does.
2. **Camera-centered spawning** — the emitter volume follows the viewer so particles are always available nearby, but live particles retain world-space positions during their lifetime. This is useful and recommended.
3. **Camera-facing geometry** — a sprite or ribbon rotates its thin width toward the camera so it remains visible. Its center and velocity still live in world space. This is also useful and recommended.
4. **Screen-space postprocessing** — the effect is generated from viewport UVs after the scene is rendered. This is appropriate for anime-style radial lines or motion blur, but it cannot by itself provide true parallax or terrain occlusion.

Saying “the streaks are camera-space” hides these differences. The current effect uses the first approach; the proposed effect uses the second and third.

## What established implementations do

### 1. World/custom simulation plus camera-aware rendering

This is the most general particle-system pattern.

Unity exposes `Local`, `World`, and `Custom` simulation spaces. Its documentation specifically allows an independent transform as the custom reference space.[^1] Unity trails separately support dropping trail points in world space so previously emitted points do not move with the emitter transform.[^4] This separation prevents a moving or rotating parent from carrying old particles along unnaturally.

Unreal's Niagara renderer independently controls sprite **facing** and **alignment**. A sprite may face the camera while its long axis is velocity-aligned; velocity itself remains a particle attribute that can be manipulated in an explicit coordinate space.[^2][^5] In other words, a camera-facing ribbon is not the same as a camera-local particle.

Microsoft Flight Simulator's VFX documentation makes the same local/world distinction for aircraft effects. It warns that local space incorporates the attached object's transform, while world space changes how position, velocity, wind direction, and ground-related nodes behave.[^6] Flight VFX therefore need deliberate space choices; blindly inheriting aircraft or camera rotation is not neutral.

For Three.js, three.quarks is a useful direct reference. It exposes both camera-facing billboards and velocity-aligned stretched billboards.[^3] Its stretched-billboard vertex shader transforms a particle's velocity into view space, uses that velocity for the long axis, and derives a camera-visible side axis for width.[^7] This is the exact conceptual split appropriate here: world/custom-space position and motion, view-aware geometry construction.

**Implication for this app:** streak centers and their airflow vector should be stable in the scene. Only their sub-pixel-to-one-pixel width needs camera awareness.

### 2. Camera tunnel / radial speed lines

An open-source Godot example creates a cylindrical “tunnel” of quad strips, with a configurable tunnel radius and length and velocity controlled through particle lifetime.[^8] This produces a readable forward rush at low cost. It is a valid stylized effect when the camera is expected to look mainly forward.

The weakness is structural: the tunnel has a preferred axis. If it is attached to the camera, orbiting makes the tunnel rotate with the viewer. If it is attached to the aircraft, hard banks rotate the distribution with the vehicle. Either behavior can expose the effect as a prop rather than air moving through space.

The existing Flow wind shader is close to a camera tunnel, but more rigid. Each streak has fixed normalized viewport-like X/Y anchors. Its Z depth cycles between near and far limits, and perspective projection turns the two depths into a radial segment. Because the object is attached to the camera and `depthTest` is disabled:

- the field cannot exhibit world parallax;
- every camera orientation shows essentially the same starburst;
- terrain cannot occlude streaks;
- camera orbit feels like rotating behind a fixed glass overlay;
- the lines always radiate from the projection center, even when lateral camera motion or aircraft sideslip should produce a different flow.

This is why making the lines longer or more opaque can improve visibility without making them feel correct.

### 3. Pure screen-space speed lines

The open-source Anime Speed Lines shader is explicitly a postprocessing effect. It converts centered screen UVs into polar coordinates, generates noise-driven radial marks, and masks them around the screen edge.[^9] This is an efficient way to communicate an impact, dash, or anime “speed state.” It is supposed to follow the screen.

Developer descriptions of high-speed movement effects often use this family as one layer among several. Project:Haste maps camera FOV and line intensity to speed and emphasizes effects around the viewport periphery.[^10] A recent browser-based Three.js flight experience, Grasslands, similarly combines a speed-responsive FOV with physical-looking debris/wake behavior and an optional peripheral radial warp at high speed.[^11]

**Implication for this app:** screen-space lines are not inherently incorrect. They are incorrect if they are asked to represent the whole air volume. A sparse edge-only accent during strong throttle can coexist with world streaks without confusing their roles.

### 4. Motion blur / velocity-buffer effects

NVIDIA's GPU Gems chapter on postprocess motion blur calls motion blur particularly important for racing-game speed perception. Its technique reconstructs scene positions from depth, compares current and previous view-projection transforms, and samples along the resulting per-pixel velocity.[^12]

Motion blur is geometrically more truthful than fake radial lines for camera movement, but it solves a different problem:

- It blurs existing terrain and objects; it does not make invisible air visible.
- It requires previous-frame matrices and depth-aware sampling.
- It can smear this project's fine terrain dots, CRT pixel mask, UI-like world graphics, and clean retro linework.
- On a mobile WebGL target, the extra samples and render-target bandwidth are undesirable.

**Implication for this app:** do not replace wind streaks with full-scene motion blur. At most, use a very restrained edge blur before the CRT/glow passes in a future experiment.

## Why physically plausible streaks need world persistence

Air itself is invisible. Visible “wind streaks” stand in for small matter—dust, mist, pollen, snow, moisture, or stylized sensor traces—passing the viewer. That visual fiction only works when the marks obey basic scene cues:

- **Parallax:** nearby streaks cross the frame faster than distant ones.
- **Occlusion:** a ridge in front of a streak hides it.
- **Viewpoint continuity:** orbiting the camera reveals a different view of the same short-lived field.
- **Relative flow:** the direction comes from aircraft motion through the air, not from the center of the display.
- **Temporal continuity:** a live streak continues its path instead of being reprojected onto a new camera-fixed ray every frame.

Dark Void's flight-VFX production notes describe the practical difficulty of retaining a convincing particle simulation amid rapid changes in player velocity; grid extent, direction, and force magnitude had to be balanced to preserve the effect.[^13] That is a density-management problem, not an argument for screen-locking. A bounded moving volume solves it while preserving local world continuity.

## Comparison of viable approaches

| Approach | Parallax | Terrain occlusion | Stable density | Orbit behavior | Cost | Best use |
|---|---:|---:|---:|---:|---:|---|
| Screen-space radial shader | No | No | Excellent | Always camera-locked | Low | Short boost/dash accent |
| Camera-local 3D tunnel | Weak/illusory | Usually no | Excellent | Rotates with camera | Low | Forward-only arcade sequence |
| Aircraft-local particle volume | Good until aircraft rotates | Yes | Excellent | Banks can drag the field | Medium | Exhaust/wake attached to aircraft |
| World-simulated particles in a moving volume | Yes | Yes | Excellent | Natural | Medium | Airborne motes and flight wind streaks |
| Depth/velocity motion blur | Scene-derived | Depth-derived | N/A | Natural | Medium-high | General high-speed camera motion |

The fourth option is the best base for Flow. The first can be an optional secondary boost cue.

## Recommended design for Flow

### A. Coordinate frame

Create a fixed-capacity **air-volume streak field**. Its spawn region follows the aircraft translation, but it should not inherit raw camera rotation or aircraft roll.

Use a slowly varying orthonormal frame:

- `forward` = smoothed normalized aircraft world velocity;
- `up` = world up, adjusted only enough to avoid degeneracy;
- `right` = normalized cross product of `forward` and `up`;
- recompute corrected `up` from `right × forward`.

This velocity frame follows the flight path without banking the whole air volume with the plane. It also avoids a sudden rotation when the user orbits the chase camera.

The volume may be an elongated capsule, cylinder, or box extending roughly 25–220 meters around/ahead of the plane. A frustum-shaped distribution can reduce particles that will never enter view, but should still leave enough lateral extent for orbit cameras.

### B. Particle lifecycle and recycling

Use a fixed pool—no per-frame allocations and no unbounded trail history.

Each streak stores:

- seeded base position in the moving volume;
- current render/world position;
- age and lifetime;
- width, length variance, opacity variance;
- a small turbulence phase.

On spawn, transform a seeded volume coordinate through the velocity frame into render space. During its lifetime, update it with relative airflow. When it crosses the rear/side boundary or expires, respawn it at the upstream boundary. The pool follows the aircraft only for **recycling bounds**; live positions are not parented to the moving frame.

For the existing floating-origin system, apply the same rebase delta to all live streak positions. This preserves continuity across world rebases.

Distance-based emission can make density independent of frame rate and speed. Microsoft Flight Simulator exposes precisely this distinction—particles per second or particles per meter traveled.[^6] With a fixed pool, the equivalent is to base wrap/respawn advancement on traveled distance rather than frame count.

### C. Motion equation

For a still ambient atmosphere:

```text
relativeAirVelocity = -aircraftWorldVelocity
```

With procedural wind:

```text
relativeAirVelocity = ambientWindWorld - aircraftWorldVelocity
```

Optionally add low-amplitude curl-like or sinusoidal turbulence, but keep it much smaller than forward flow. Do not derive the long axis from a screen-center ray.

The streak's world-space endpoints are:

```text
head = particlePosition
tail = head - normalize(relativeAirVelocity) * physicalLength
```

`physicalLength` can rise smoothly with airspeed and throttle, but its baseline should remain nonzero. Unity's stretched-particle renderer likewise treats particle length and velocity-dependent stretch as separate controls.[^14]

### D. Geometry and shader

Prefer instanced two-triangle ribbons over WebGL line primitives:

- WebGL line width is commonly constrained to one physical pixel.
- A quad permits a soft alpha profile, consistent thickness, tapered ends, and stable appearance through the CRT/downsample pass.
- One instanced draw call can handle the entire fixed pool.

For each instance, pass `head`, `velocity`, `length`, `width`, `age`, and seeded variation. In the vertex shader:

1. Transform `head` and the airflow direction into view space.
2. Use projected/view-space velocity as the long axis.
3. Build the side axis perpendicular to velocity and view direction.
4. Expand the unit quad along the two axes.

That follows the same principle as the three.quarks stretched-billboard shader: velocity supplies alignment; camera/view data supplies visibility.[^7]

Use a soft rectangular/capsule SDF in the fragment shader so ends taper rather than terminating as hard line segments. Keep `depthTest: true`, `depthWrite: false`, and render before the CRT and final glow passes. The glow pass may then pick up bright streak cores naturally.

### E. Visibility and art direction

The effect should communicate motion without filling the scene:

- Baseline: approximately 18–32 visible streaks, low opacity, long lifetimes, varied lateral placement.
- Strong throttle: approximately 35–55 effective streaks, slightly longer and brighter—not several times denser.
- Avoid a dense ring around the exact reticle. Use a soft central exclusion cone so the aircraft and guide line remain legible.
- Fade near the camera to prevent giant crossing lines.
- Fade at far and lateral volume boundaries to hide recycling.
- Apply terrain/background distance fog in the streak fragment shader.
- Use mostly gray-white; optionally allow a slight cool tint. The existing settings remain suitable, but should control world length and ribbon opacity rather than a camera-ray illusion.

The developer report for Grasslands is instructive here: airborne debris fades out at low airspeed, while its high-speed presentation also changes camera FOV and uses only an optional peripheral warp.[^11] Multiple restrained cues create speed more convincingly than one exaggerated layer.

### F. Camera-mode behavior

**Cockpit:** show the largest apparent relative motion, but retain the near fade to prevent streaks crossing directly through the reticle. The field remains world-stable as the plane rolls.

**Chase and far chase:** center the spawn volume near the aircraft rather than exactly at the camera. This makes streaks move past both aircraft and viewer and makes the vehicle feel embedded in the airflow.

**Orbit interaction:** do not rotate live particles when the camera orbits. The user should see lateral parallax. If the aircraft keeps flying under autopilot, airflow continues based on aircraft velocity. If simulation is paused, particles should pause rather than continue as a camera overlay.

**Camera transitions:** no reset is needed. Since streaks live in the scene, a blend between camera modes simply views the same field from a changing position.

### G. Optional screen-space boost layer

If the world field alone lacks a sharp throttle “kick,” add a second, explicitly graphic layer:

- edge-only radial mask;
- opacity capped well below the world streaks;
- fade in over roughly 150–250 ms and out more slowly;
- disabled below a high throttle/speed threshold;
- no lines near the center 35–45% of the screen;
- no dependence on particle count settings.

This should be named and tuned as **boost accent**, not wind. The Anime Speed Lines shader and Project:Haste pattern support this usage.[^9][^10]

## Implementation plan in this repository

This design was subsequently implemented in `src/render/WindView.ts`.

1. Replace the camera child `WindView.group` with a scene-level `AirStreakField`.
2. Keep a fixed maximum count and use instanced quads or one expanded `BufferGeometry` draw.
3. Add update inputs for aircraft render position, world velocity, rebase delta, and scene fog.
4. Generate seeded volume coordinates once; recycle individual particles without allocating arrays.
5. Smooth the velocity frame separately from camera orientation.
6. Move particles by relative airflow at the fixed simulation step.
7. Build velocity-aligned, camera-facing ribbon width in the vertex shader.
8. Enable depth testing and add near/far/side/fog fades.
9. Preserve current controls for count, physical length, speed threshold, opacity, and color.
10. Retune the FOV boost after the world streak field is working; the two cues should peak together without overpowering the terrain.
11. Only then decide whether a subtle screen-space edge accent is necessary.

## Acceptance tests

The replacement is successful when:

- Orbiting 90 degrees around the aircraft reveals parallax; streaks do not rotate with the screen.
- A terrain ridge occludes streaks behind it.
- A hard aircraft bank changes flow direction smoothly without rotating the whole population as a rigid cylinder.
- Switching cockpit/chase/far-chase views does not respawn or snap the field.
- Pausing freezes both particle motion and recycling.
- A world rebase produces no visible streak jump.
- At constant speed, density is stable across 30, 60, and 120 FPS.
- Nearby marks move faster across the image than distant marks.
- Throttle increases length/FOV/brightness smoothly but does not flood the image.
- The effect remains legible after internal-resolution scaling, CRT mask, and final glow.
- Mobile maintains a single draw call and a bounded count.

## Final recommendation

The current camera-space starburst should be replaced, not merely retuned. The correct foundation is:

> **World-persistent streak positions inside an aircraft-following bounded volume, moving and stretching along relative airflow, with camera-facing width only.**

That creates the depth, parallax, occlusion, and viewpoint continuity that the current version lacks, while still keeping particle density bounded for an endless procedural world. A tiny screen-space boost accent can remain optional, but it should never be the primary wind representation.

## Sources

[^1]: Unity Technologies, [ParticleSystem.MainModule.simulationSpace](https://docs.unity3d.com/ja/current/ScriptReference/ParticleSystem.MainModule-simulationSpace.html), official documentation. Defines local, world, and custom particle simulation spaces.
[^2]: Epic Games, [Niagara Renderers](https://dev.epicgames.com/documentation/en-us/unreal-engine/niagara-renderers?application_version=4.27), official documentation. Separates sprite facing, alignment, velocity binding, and size.
[^3]: Alchemist0823, [three.quarks](https://github.com/Alchemist0823/three.quarks), open-source Three.js VFX library. Documents camera-facing billboards and velocity-aligned stretched billboards.
[^4]: Unity Technologies, [ParticleSystem.TrailModule.worldSpace](https://docs.unity3d.com/ja/2022.1/ScriptReference/ParticleSystem.TrailModule-worldSpace.html), official documentation. Describes world-space trail points that do not move with the transform.
[^5]: Epic Games, [Particle Update Group Reference for Niagara Effects](https://dev.epicgames.com/documentation/unreal-engine/particle-update-group-reference-for-niagara-effects-in-unreal-engine), official documentation. Covers velocity in coordinate spaces, speed-scaled color/size, alignment, ribbons, and camera modules.
[^6]: Microsoft, [Microsoft Flight Simulator VFX Emitter](https://docs.flightsimulator.com/html/Developer_Mode/VFX_Editor/Nodes/Emitter.htm), official documentation. Covers local/world emission and time- versus distance-based rates.
[^7]: Alchemist0823, [stretched billboard vertex shader](https://github.com/Alchemist0823/three.quarks/blob/main/packages/three.quarks/src/shaders/stretched_bb_particle_vert.glsl.ts), source code. Transforms velocity into view space and derives velocity-aligned camera-visible billboard geometry.
[^8]: MikeFrom, [Godot Particles Tunnel Speed Lines](https://github.com/MikeFrom/Godot-Particles-Tunnel-Speed-Lines), open-source Godot particle shader. Uses a configurable 3D tunnel, lifetime-driven velocity, and quad strips.
[^9]: Mirza Beig, [Anime Speed Lines](https://github.com/MirzaBeig/Anime-Speed-Lines), open-source postprocessing effect. Generates radial procedural speed lines in screen-space polar coordinates.
[^10]: Javier Garay, [How Wall-Running and High-Speed Movement Works in Project:Haste](https://www.gamedeveloper.com/programming/how-wall-running-and-high-speed-movement-works-in-project-haste), developer article. Describes speed-mapped FOV, dash lines, and peripheral screen effects.
[^11]: threenames, [Grasslands: 8.8 million blades of grass in a browser tab](https://threenames.dev/posts/grasslands), developer write-up for a Three.js flight experience. Describes airspeed-dependent wake/debris, speed-responsive FOV, and an optional peripheral speed warp.
[^12]: Gilberto Rosado, NVIDIA GPU Gems 3, [Motion Blur as a Post-Processing Effect](https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-27-motion-blur-post-processing-effect). Reconstructs per-pixel velocity from depth and current/previous view-projection transforms.
[^13]: NVIDIA/Airtight Games, [Taking Fluid Simulation Out of the Box: Particle Effects in Dark Void](https://developer.download.nvidia.com/presentations/2010/gdc/Taking_Fluid_Simulation_Out_of_the_Box_Particle_Effects_in_Dark_Void.pdf), GDC 2010 presentation. Discusses maintaining flight VFX under rapid player velocity changes.
[^14]: Unity Technologies, [ParticleSystemRenderer.velocityScale](https://docs.unity3d.com/ja/2023.1/ScriptReference/ParticleSystemRenderer-velocityScale.html), official documentation. Defines velocity-dependent particle stretching alongside independent length and camera-velocity scaling.
