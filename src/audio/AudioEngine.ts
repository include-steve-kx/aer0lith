import { FLIGHT } from '../core/config.ts';

export class AudioEngine {
  enabled = false;
  private context: AudioContext | undefined;
  private master: GainNode | undefined;
  private engine: OscillatorNode | undefined;
  private engineGain: GainNode | undefined;
  private wind: AudioBufferSourceNode | undefined;
  private windGain: GainNode | undefined;
  private pulseBuffer: AudioBuffer | undefined;

  async toggle(): Promise<boolean> {
    if (!this.context) this.initialize();
    if (!this.context || !this.master) return false;
    if (this.context.state === 'suspended') await this.context.resume();
    this.enabled = !this.enabled;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(this.enabled ? 0.16 : 0, this.context.currentTime, 0.04);
    if (this.enabled) this.beep(620, 0.055);
    return this.enabled;
  }

  private initialize(): void {
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.context.destination);

    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    this.engine = this.context.createOscillator();
    this.engine.type = 'sawtooth';
    this.engineGain = this.context.createGain();
    this.engineGain.gain.value = 0.34;
    this.engine.connect(filter).connect(this.engineGain).connect(this.master);
    this.engine.start();

    const seconds = 2;
    const buffer = this.context.createBuffer(1, this.context.sampleRate * seconds, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i += 1) channel[i] = Math.random() * 2 - 1;
    const windFilter = this.context.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 920;
    windFilter.Q.value = 0.65;
    this.wind = this.context.createBufferSource();
    this.wind.buffer = buffer;
    this.wind.loop = true;
    this.windGain = this.context.createGain();
    this.windGain.gain.value = 0.04;
    this.wind.connect(windFilter).connect(this.windGain).connect(this.master);
    this.wind.start();
    this.pulseBuffer = this.createPulseBuffer();
  }

  /** A reusable mixed discharge/hiss/crackle sample; only the cheap source is per shot. */
  private createPulseBuffer(): AudioBuffer | undefined {
    if (!this.context) return;
    const duration = 0.68;
    const buffer = this.context.createBuffer(1, Math.ceil(this.context.sampleRate * duration), this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let phase = 0;
    let state = 0x9e3779b9;
    for (let index = 0; index < samples.length; index += 1) {
      const t = index / this.context.sampleRate;
      const progress = t / duration;
      const frequency = 760 * Math.exp(-t * 4.2) + 58;
      phase += frequency / this.context.sampleRate * Math.PI * 2;
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      const noise = ((state >>> 0) / 0xffffffff) * 2 - 1;
      const discharge = Math.sin(phase) * Math.exp(-t * 5.2) * 0.7;
      const hiss = noise * Math.exp(-t * 3.6) * 0.22;
      const crack = t < 0.075 ? noise * (1 - t / 0.075) * 0.75 : 0;
      samples[index] = Math.tanh((discharge + hiss + crack) * 1.7) * (1 - progress * progress);
    }
    return buffer;
  }

  pulse(): void {
    if (!this.enabled || !this.context || !this.master || !this.pulseBuffer) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = this.pulseBuffer;
    gain.gain.value = 0.22;
    source.connect(gain).connect(this.master);
    source.start();
  }

  update(speed: number, throttle: number, paused = false): void {
    if (!this.context || !this.engine || !this.engineGain || !this.windGain) return;
    const now = this.context.currentTime;
    this.engine.frequency.setTargetAtTime(42 + speed * 1.35 + throttle * 24, now, 0.08);
    this.engineGain.gain.setTargetAtTime(paused ? 0 : 0.19 + throttle * 0.23, now, 0.12);
    const speedRatio = (speed - FLIGHT.minSpeed) / (FLIGHT.maxSpeed - FLIGHT.minSpeed);
    this.windGain.gain.setTargetAtTime(paused ? 0 : 0.025 + speedRatio * 0.1, now, 0.15);
  }

  beep(frequency = 520, duration = 0.045): void {
    if (!this.enabled || !this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.08, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start();
    oscillator.stop(this.context.currentTime + duration);
  }

  crash(): void {
    if (!this.enabled || !this.context || !this.master) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const distortion = this.context.createWaveShaper();
    const curve = new Float32Array(256);
    for (let index = 0; index < curve.length; index += 1) {
      const x = (index * 2) / curve.length - 1;
      curve[index] = Math.tanh(x * 9);
    }
    distortion.curve = curve;
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(180, this.context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(38, this.context.currentTime + 0.28);
    gain.gain.setValueAtTime(0.18, this.context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + 0.3);
    oscillator.connect(distortion).connect(gain).connect(this.master);
    oscillator.start();
    oscillator.stop(this.context.currentTime + 0.31);
  }
}
