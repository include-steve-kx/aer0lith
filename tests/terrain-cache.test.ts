import assert from 'node:assert/strict';
import test from 'node:test';
import { ProceduralTerrain } from '../src/world/TerrainModel.ts';
import { DensityLatticeCache } from '../src/world/DensityLatticeCache.ts';
import { interpolateDensityCell } from '../src/world/VolumeMesher.ts';
import { TERRAIN } from '../src/core/config.ts';

function uncached(t:ProceduralTerrain,x:number,y:number,z:number):number {
  const size=TERRAIN.chunkSize/TERRAIN.segments,ix=Math.floor(x/size),iy=Math.floor(y/size),iz=Math.floor(z/size);
  const corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(([dx,dy,dz])=>t.densityAt((ix+dx)*size,(iy+dy)*size,(iz+dz)*size));
  return interpolateDensityCell(corners,(x-ix*size)/size,(y-iy*size)/size,(z-iz*size)/size);
}
test('cached terrain queries match the exact uncached tetrahedral field across seeds, boundaries and rebases',()=>{
  for(const seed of ['combat-validation','cache-b']){const terrain=new ProceduralTerrain(seed);for(let i=0;i<250;i++){const z=i%7===0?i*2048:-1100+i*17.371,path=terrain.sample(z),x=path.x+Math.sin(i)*90,y=path.y+Math.cos(i)*60;assert.equal(terrain.collisionDensityAt(x,y,z),uncached(terrain,x,y,z));}}
});
test('nearby ray samples reuse immutable corner values instead of regenerating noise',()=>{
  const t=new ProceduralTerrain('combat-validation'),density=t.densityAt.bind(t);let samples=0;t.densityAt=(...args)=>{samples++;return density(...args);};
  for(let i=0;i<100;i++)t.collisionDensityAt(1+i*.01,2,3);assert.equal(samples,8);
  t.collisionDensityAt(1,2,3);assert.equal(samples,8);
});
test('bounded density cache detects hash collisions without returning another vertex value',()=>{
  const cache=new DensityLatticeCache();const sample=(x:number,y:number,z:number)=>x*.25+y*.5+z;
  for(let i=0;i<100000;i++)assert.equal(cache.get(i,-i,i%77,sample),sample(i,-i,i%77));
  for(let i=0;i<100000;i+=17)assert.equal(cache.get(i,-i,i%77,sample),sample(i,-i,i%77));
  assert.equal(DensityLatticeCache.capacity,32768);
});
