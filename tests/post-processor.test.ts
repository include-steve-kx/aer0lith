import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Color,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { PostProcessor } from '../src/render/PostProcessor.ts';
import type { RefractionContributor } from '../src/combat/types.ts';

interface PostProcessorInternals {
  wakeTarget: WebGLRenderTarget;
  crystalTarget: WebGLRenderTarget;
  material: { fragmentShader: string };
}

test('legacy glass and crystal render through isolated framebuffer contracts', () => {
  let currentTarget: WebGLRenderTarget | null = null;
  const rendered: Array<{ scene: Scene; target: WebGLRenderTarget | null }> = [];
  const renderer = {
    autoClear: true,
    setRenderTarget(target: WebGLRenderTarget | null): void { currentTarget = target; },
    render(scene: Scene): void { rendered.push({ scene, target: currentTarget }); },
    clear(): void {},
    getClearColor(color: Color): Color { return color.set(0); },
    getClearAlpha(): number { return 1; },
    setClearColor(): void {},
  };
  const post = new PostProcessor(renderer as never);
  const internals = post as unknown as PostProcessorInternals;

  assert.equal(internals.wakeTarget.textures.length, 1,
    'existing glass shaders must keep their original one-output framebuffer');
  assert.equal(internals.crystalTarget.textures.length, 2,
    'only the crystal shader writes the two MRT attachments');
  assert.notEqual(internals.wakeTarget, internals.crystalTarget);

  const glassScene = new Scene();
  const crystalScene = new Scene();
  let glassPrepared = 0;
  let crystalPrepared = 0;
  const glass: RefractionContributor = {
    active: true,
    scene: glassScene,
    prepare(depth: Texture): void { assert.ok(depth); glassPrepared++; },
  };
  const crystal: RefractionContributor = {
    active: true,
    scene: crystalScene,
    prepare(depth: Texture): void { assert.ok(depth); crystalPrepared++; },
  };

  post.render(
    new Scene(),
    new PerspectiveCamera(60, 1, 0.1, 1_000),
    0,
    0,
    new Vector3(),
    new Vector3(),
    undefined,
    [glass],
    crystal,
  );

  assert.equal(glassPrepared, 1);
  assert.equal(crystalPrepared, 1);
  assert.equal(rendered.filter(entry => entry.scene === glassScene).length, 1,
    'layering must not add another legacy-glass geometry pass');
  assert.equal(rendered.filter(entry => entry.scene === crystalScene).length, 1,
    'layering must not add another crystal geometry pass');
  assert.equal(rendered.find(entry => entry.scene === glassScene)?.target, internals.wakeTarget);
  assert.equal(rendered.find(entry => entry.scene === crystalScene)?.target, internals.crystalTarget);
  assert.match(internals.material.fragmentShader, /resolveCrystalBehind\(uv, wakeDepth\)/,
    'front legacy glass must resolve rather than discard crystal behind it');
  assert.match(internals.material.fragmentShader, /resolveWakeBehind\(uv, crystalDepth\)/,
    'front crystal must resolve rather than discard legacy glass behind it');
  assert.match(internals.material.fragmentShader, /wakeDepth <= crystalDepth/,
    'the two retained layers must be ordered by depth before composition');
  assert.match(internals.material.fragmentShader, /texture2D\(tCrystalBody, surfaceUv\)/,
    'front glass must sample the rear crystal body at its refracted coordinate');
  assert.doesNotMatch(internals.material.fragmentShader, /candidateDepth < glassDepth/,
    'the old winner-takes-all branch must not return');
  post.dispose();
});
