import '@fontsource/share-tech-mono/400.css';
import './styles.css';
import { App } from './App.ts';

function createSeed(): string {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return `${values[0].toString(36)}-${values[1].toString(36)}`;
}

function getSeed(): string {
  const url = new URL(window.location.href);
  const existing = url.searchParams.get('seed')?.trim();
  if (existing) return existing.slice(0, 64);
  const seed = createSeed();
  url.searchParams.set('seed', seed);
  history.replaceState(null, '', url);
  return seed;
}

const root = document.getElementById('app');
if (!root) throw new Error('Missing application root');

const probe = document.createElement('canvas');
const webgl2 = probe.getContext('webgl2');
if (!webgl2) {
  const fallback = document.getElementById('fallback');
  if (fallback) fallback.hidden = false;
} else {
  try {
    const app = new App(root, getSeed());
    app.start();
  } catch (error) {
    console.error(error);
    const fallback = document.getElementById('fallback');
    if (fallback) fallback.hidden = false;
  }
}
