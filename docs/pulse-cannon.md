# Pulse Cannon

## Player behavior

The Pulse Cannon is a dedicated piercing weapon, separate from bullets and missiles. Press `X` or the lightning button between Fire and Probe to fire one instantaneous shot. The default shot is 800 m long, has a 40 m physical radius, and cools down for one simulation second.

The convergence reticle selects direction only. The shot always extends to the configured Pulse range. Its complete world-space geometry is captured when the shot is accepted, so aircraft or camera motion cannot bend an active beam.

The gameplay capsule starts one radius in front of the nose and ends one radius before the visual endpoint. Its rounded caps therefore cover exactly the visual interval without carving behind the muzzle. Every intersected meteor is destroyed through the normal meteor-destruction callback, retaining explosions, shrinking opaque meteor fragments, shake, and capped ship impulse. Ordinary bullets, missiles, and proximity explosions never carve terrain.

Pause freezes cooldown and beam age. Crash, recovery, combat reset, or disabling the feature clears pending input and transient beam state and makes the cannon ready. These transitions do not heal tunnels. Tunnels last until page reload or seed change.

## Controls and settings

The Pulse Cannon settings section contains:

| Setting | Default | Range |
|---|---:|---:|
| Enabled | true | Boolean |
| Range | 800 m | 160–800 m |
| Physical beam radius | 40 m | 4–80 m |
| Inner plasma radius | 8 m | 4–80 m |
| Cooldown | 1 s | 0.25–15 s |
| Visual duration | 0.6 s | 0.2–1.5 s |
| Plasma color | `#9ffcff` | Color |
| Plasma brightness | 1.35 | 0–3 |
| Fade curve | 1.4 | 0.25–4 |
| Plasma flutter | 0.35 | 0–1.5 |
| Flutter rate | 1.0× | 0–4× |
| Camera shake | 1.3 | 0–2 |
| Shake frequency | 20 Hz | 4–30 Hz |
| Shake duration | 3.6 s | 0.3–8 s |
| Outer glass width | 2.0× | 0.5–2× |
| Outer glass length | 1.0× | 0.5–1.2× |
| Electric strength | 2.0 | 0–4 |
| Electric spread | 1.3× | 0–2× |
| Electric travel time | 0.7 s | 0.1–1.5 s |
| Electric trail length | 0.19× | 0.05–1× |
| Beam light color | `#9ffcff` | Color |
| Beam light intensity | 175 | 0–2,000 |
| Beam light range | 100 m | 20–800 m |
| Electric light color | `#6fe9ff` | Color |
| Electric light intensity | 875 | 0–2,000 |
| Electric light range | 210 m | 10–400 m |
| Refraction | 1.65 | 0–3 |
| Dispersion | 0.80 | 0–2 |
| Terrain remnant | 0.55 | 0–1 |
| Remnant falloff | 18 m | 2–60 m |
| Solid plasma / glass / electricity | false | Boolean debug previews |

The icon button exposes disabled, cooldown, terrain-busy, and pause state to assistive technology. Its CSS fill shows remaining cooldown. A ninth shot is rejected without consuming cooldown while all eight immediate terrain-mask slots are occupied.

## Terrain representation

Each accepted, non-contained shot stores one sparse capsule:

```text
min(baseDensity, distanceToSegment(sample, start, end) - radius)
```

Positive density remains rock and negative density remains air. Subtraction cannot introduce a collision obstruction or close the guaranteed flight route.

Capsules are indexed only into chunks admitted by an AABB broad phase and an exact segment-to-AABB distance test. Exact boundary neighbors are included so shared lattice samples remain equal. Duplicate and fully contained capsules are discarded; a new capsule removes older capsules that it wholly contains. Other capsules are retained for the life of the world.

Collision reads immutable cached base-lattice corners, applies current capsules, and uses the same tetrahedral interpolation as visible polygonization. Collision therefore changes immediately without invalidating the base cache.

The terrain shader retains the eight newest Pulse paths as damage remnants.
Each remnant tints only the carved wall and its configurable outer falloff with
the shot's snapshotted plasma color. Influence rises along the capsule, from a
faint muzzle trace to full strength around the rounded far cap. A ninth unique
shot replaces the oldest tint record. Remnants are also discarded once none of
their affected chunks remain in the desired streaming envelope, so distant old
shots add no fragment-shader work. The underlying tunnel remains persistent.

## Bounded remeshing

Workers receive packed seven-value capsule snapshots and monotonic per-chunk revisions. Requests are coalesced to one queued and one in-flight operation per chunk. Carve work precedes ordinary streaming, stale responses are rejected, only one completed geometry is installed per rendered frame, and old geometry remains installed until its replacement is valid.

The worker has three effective density paths:

- no capsules: polygonize the immutable base lattice directly;
- one capsule: a stride-free loop with precomputed axis and endpoint bounds;
- multiple capsules: the generic packed-snapshot union.

Base lattices and one damaged-lattice buffer are reused. Chunks whose immutable lattice maximum is negative advance revisions without polygonization or upload because subtraction can never introduce rock. If both workers fail, synchronous fallback generates at most one queued chunk per update.

## Immediate visibility

Both terrain materials share a fixed eight-capsule uniform mask. The dot and mesh fragment shaders discard samples inside pending capsules using squared point-to-segment distance. This makes rock disappear in the first rendered frame after firing while workers build the newly exposed tunnel wall. A mask remains until every relevant active chunk reaches its required revision; non-visible chunks do not hold it open. Mask endpoints are converted from authoritative world space whenever the render origin changes.

The visual is one forward-facing copy of the booster flame geometry and shader:
the same 16-sided, 24-ring open plume, envelope, tongues, core, and turbulence.
Its root and far endpoint are both snapshotted from the aircraft nose and firing
direction when the shot launches. The complete effect remains on that immutable
world-space trajectory, so the aircraft can fly past it while it fades.

The physical beam radius controls meteor hits and terrain carving. The separate
inner plasma radius controls the widest point of the visible plasma profile.
Both are absolute meter values from 4–80 m. They default to 40 m physically and
8 m visually, so they can be tuned independently. The booster
envelope is normalized every frame so flutter and the initial power flare cannot
make the plasma exceed its configured inner radius. Plasma and glass share the
reusable geometry, with the outer refractive glass 2× wider than the
inner plasma by default. The beam starts at full power and fades without moving its
fixed far endpoint. Electricity follows fixed, non-rotating paths wrapped
around that same changing-radius glass profile; a configurable trail window
travels from muzzle to endpoint and exits the beam. Electric spread scales that
complete radial profile rather than adding a constant offset.

Two pooled point lights accompany the effect. The beam light stays in the
bright forward plume region. The electric light follows
the moving electric front and switches off when its trail exits. Both light
positions, colors, strengths, and ranges also feed the custom mesh/dot terrain
shader, so terrain illumination matches standard lit scene objects.

Firing also triggers an independent one-shot camera shake. It uses the same
65 ms attack, quadratic decay, waveform, and default strength/frequency as a
fresh boost ignition. Pulse shake has its own strength, frequency, and duration
controls, freezes while paused, stacks with explosion/boost shake for rendering,
and never changes authoritative aircraft or camera-rig state.

The beam itself uses fixed geometry and fixed arc counts:

- one reusable 16-sided, 24-ring booster-plume draw;
- one eight-arc, sixteen-segment electric line batch;
- one optional depth-aware refraction draw.

Radius changes transform fixed geometry only; they do not
increase tessellation, arc count, or normal draw calls. The three solid debug
toggles reuse those same pooled geometries and leave the last fired shot visible
for inspection after its normal fade ends. Debug state is deliberately not
restored on reload. Plasma shaders are prewarmed during loading so the first
shot cannot incur a gameplay-frame compilation hitch. The initial benchmark
exposed a 146.1 ms first-use hitch before this change.

## Validation and performance

The deterministic CPU profile is `node --experimental-strip-types tests/pulse-cannon-profile.ts`. The browser fixture is `tests/fixtures/pulse-cannon-profile.html`. Raw results are stored in:

- `docs/validation/pulse-cannon-cpu-performance.json`
- `docs/validation/pulse-cannon-browser-performance.json`
- `docs/validation/pulse-cannon-ios-validation.json`

Measured on an Apple M1 Max at a 1280×720 CSS viewport with device pixel ratio 2:

| Measurement | Result |
|---|---:|
| 60 m activation CPU p95 | 0.022 ms |
| 48-meteor capsule test p95 | 0.049 ms |
| Beam simulation/upload p95 | 0.012 ms |
| 60 m browser frame p99 / max | 2.3 / 2.4 ms |
| 48-meteor browser frame p99 / max | 3.5 / 6.0 ms |
| 60 m GPU disappearance / final visible remesh | next frame / 119 ms |
| 80 m GPU disappearance / final visible remesh | next frame / 201 ms |
| Maximum pending-mask settle | 126 ms |
| Pulse draw calls | 3 maximum |
| 1,000-shot estimated history | 227 KB, 227 B/shot |

Exact chunk admission materially helps diagonal shots. At 60 m it accepted 22 of 64 AABB candidates; at 16 m it accepted 11 of 27. Straight aligned shots touched 20 chunks at 60 m and 80 m because both radii crossed the same chunk layers in this fixture.

One acceptance target did not pass as written: cached one-capsule chunk generation was 124% slower relative to the extremely small 0.093 ms cached no-carve baseline, rather than below 20%. Its absolute measured mean was 0.209 ms, and it runs in a worker, so desktop frame, queue, and remesh-latency budgets still passed. The uncached equivalent was 14.3 ms, showing that immutable base-lattice caching removes the dominant procedural-density cost.

The generic arm64 iOS Release build and the iPhone 13 mini simulator Release build both passed, and the simulator installed, launched, and rendered the landscape controls. Physical-device benchmarks are intentionally not claimed: every registered iPhone was offline during this validation. GPU timer queries were unavailable in the desktop fixture, so GPU mask cost is also not claimed independently from measured frame time.

## Regression coverage

Automated coverage includes capsule side/cap/tangent/zero-length math, seams and negative chunks, exact admission, containment, persistent history, collision cache behavior, specialized/generic equivalence, stale workers, paused results, malformed responses, complete worker failure, one-install-per-frame, air-chunk rejection, eight-mask back-pressure, rebase and mask retirement, cooldown/reset behavior, non-repeating input, full-range aim, 48 meteor kills, bounded effect pools, fixed render complexity, and explicit disposal.

Run the complete acceptance suite with:

```sh
npm run verify
```
