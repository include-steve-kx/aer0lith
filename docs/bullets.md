# Bullets and shared meteor destruction

Space / FIRE provides unlimited hold-to-fire shooting; T toggles autopilot and I restores the checkpoint. Firing has no effect on flight mode, drift/boost state, or missile magazines. Settings are persisted with the game settings. Muzzle debug is deliberately not persisted.

## Aiming and cadence

`BulletAim` intersects the camera-center ray with a ship-centered convergence sphere, takes the farther positive intersection, and constrains its direction to the ship's forward cone. An invalid intersection falls back to ship-forward. The camera is sampled before shake and after cockpit roll; the small hollow nominal-aim marker is projected with the final shaken camera and CRT curvature. Off-screen aim markers are hidden.

Each shot samples a uniform-area disk perpendicular to the nominal aiming direction. Its radius is distance × tan(spread). Spread uses its own seeded random stream, separate from cadence and launcher choice. Rejection against the aiming cone is limited to 16 attempts, followed by the nominal-point fallback. Spread is disabled when the aiming cone is zero. Shot velocity is immutable after launch; there is no homing or per-frame random jitter. Wing-tip paths are checked against the individual convex ship parts before selecting uniformly among eligible wings.

Frequency is the total number of shots per second across all guns. Intervals vary uniformly around the configured mean; consecutive shots may use the same wing. Fractional birth times are preserved within the 120 Hz simulation. Holding/releasing cannot bypass cooldown. An exhausted pool skips the opportunity rather than queuing a burst or stealing a live slot.

## Damage and collision ownership

`MeteorSystem.applyHit` owns health, death, generation invalidation, marker clearing, and reservation clearing. It supplies a reusable destruction snapshot synchronously to the application; fragment, glass, shake, and physics consumers copy any needed state immediately. MissileSystem has no dependency on ImpactSystem.

Bullets remove one health point. Durability is captured at birth as max(1, round(hitsAt12m × diameter / 12)); missiles are instantly lethal. Nonlethal hits generate a rock flash and pooled spark. Reset, distance retirement, and feature disable never generate explosions.

`ProjectileResolver` arbitrates both weapons by contact time within each simulation step. It sweeps meteor convex volumes with relative motion and projectile radius, samples the cached collision-density field at intervals no greater than 1 m, then refines terrain contact six times. Stale meteor candidates are queried again after earlier impacts. Clear flights use a linear pass; chronological ordering applies only to real contacts. Aircraft collisions retain priority within the step.

Bullets use 256 flight slots, 512 independent analytic trails, four reusable muzzle flashes, and 64 hit sparks. The shared contact queue has 320 entries (256 bullets plus 64 missiles). Bullets expire at the configured range or four seconds, whichever comes first. World-space trail origins, immutable directions, traveled distances and simulation timestamps reconstruct the visible segments without sample-ring allocation.

## Explosion forces and lifecycle

One radial impulse is produced per meteor destruction. Its falloff matches the shake radius: 1 − smoothstep(0, radius, distance), multiplied by clamped meteor-size scaling. Direction is away from the impact center; coincident centers use opposite projectile travel. Strength is independent of shake visibility and cosmetic pool availability.

Pending impulses add as vectors before a 180 m/s clamp (bounded independently of the 20 m/s default push strength). External velocity moves the real aircraft and decays linearly to exactly zero. While displaced, even autopilot sweeps terrain probes and meteor colliders. Checkpoints are excluded until the force settles. A terrain or meteor contact adds its own outward surface-normal response instead of restarting the flight. Explicit checkpoint restoration/reset and disabling push clear residual force.

Pausing freezes simulation, cooldown, fades and force decay; appearance and camera remain live. All new resources are preallocated and disposed idempotently. Bullets and missiles can be disabled independently without deleting the other weapon's impacts. Disabling meteors clears encounters and their effects, while bullets can still hit terrain. Browser blur/backgrounding and pointer cancellation clear held fire. Back/forward cache suspension retains reusable rendering resources.

Five rendering batches cover bolts, analytic ribbons, hit sparks, muzzle flame, and muzzle glass. The glass joins the existing shared depth/refraction pass. No per-shot lights, scene objects, framebuffers, full-scene renders, or GPU readbacks are added. True alpha fading avoids black trails. Muzzle debug replaces the visible flame with the opaque shell and suppresses refraction until toggled off.

## Reproduction and validation

```sh
npm run verify
npm run dev
```

Open `/tests/fixtures/bullets.html`. It provides continuous fire/targets, frozen firing, camera selection, muzzle debug, a spread target-plane display, input checks, and **Start 5-minute soak**. The soak exposes final JSON in its on-screen status. It exercises high fire rate/speed/range/trail settings, scans, destruction, camera changes, rolls, debug toggles, pauses, resets, and origin changes. It records CPU categories, resource snapshots, and errors. CPU categories overlap (terrain and sweeps are nested within weapon work); do not sum them.

For a repeatable CPU-only comparison using the same seed and route:

```sh
node --experimental-strip-types tests/bullet-profile.ts
```

This compares disabled/default/maximum bullet settings over 1,800 frames, discarding 120 warm-up frames. It measures simulation and visual-buffer preparation, not GPU work, browser frame time, or phone performance. Results: [CPU comparison](validation/bullet-simulation-performance.json). The default recorded bullet update/shared resolution P95 was approximately 0.25 ms; visual-buffer preparation P95 was 0.04 ms. These are desktop Node measurements, not an FPS guarantee or proof of the phone target.

The [five-minute browser soak](validation/bullet-browser-performance.json) completed 12,978 shots, 1,711 nonlethal hits and 510 meteor destructions with no browser errors. At an 844 × 390 desktop viewport, median/P95 frame intervals were 8.3 / 9.3 ms; the maximum was 183.3 ms, so isolated stutters remain. Bullet-update P95 was 0.3 ms and bullet-buffer preparation P95 was 0.2 ms. In the final minute, geometry/textures/program counts stayed at 159 / 6 / 23. Not every pool saturated, and these are not physical-phone measurements. The paired full-render phone <20% frame-time acceptance target remains unmeasured. Existing meteor-marker validation remains in `validation/meteor-marker-performance.json`; the marker still performs zero terrain-occlusion checks.
