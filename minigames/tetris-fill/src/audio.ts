export type AudioValue = string | { url: string; weight: number; volume?: number }[];
type Sound = { url: string; volume: number };
type Volume = { muted?: boolean; musicVolume?: number; sfxVolume?: number };

const gain = (value: unknown): number =>
  Math.max(0, Math.min(100, typeof value === 'number' && Number.isFinite(value) ? value : 100)) / 100;

export function pickSound(value: unknown): Sound | undefined {
  if (typeof value === 'string') return value.trim() ? { url: value, volume: 100 } : undefined;
  if (!Array.isArray(value)) return undefined;
  const sounds = value.filter(v => v && typeof v.url === 'string' && v.url.trim() && Number.isFinite(v.weight) && v.weight > 0);
  if (!sounds.length) return undefined;
  let remaining = Math.random() * sounds.reduce((sum, v) => sum + v.weight, 0);
  const selected = sounds.find(v => (remaining -= v.weight) < 0) ?? sounds[sounds.length - 1];
  return { url: selected.url, volume: gain(selected.volume) * 100 };
}

/** Own every playing element, including one-shots, so exits cannot leak audio. */
export function createAudio(musicValue: unknown, initial: Volume) {
  let muted = initial.muted === true;
  let musicGain = gain(initial.musicVolume);
  let sfxGain = gain(initial.sfxVolume);
  let destroyed = false;
  let musicFinished = false;
  const musicSound = pickSound(musicValue);
  const music = musicSound ? new Audio(musicSound.url) : null;
  if (music) music.loop = true;
  let loop: HTMLAudioElement | null = null;
  let loopSound: Sound | undefined;
  const oneShots = new Map<HTMLAudioElement, number>();

  function dispose(node: HTMLAudioElement): void {
    node.pause();
    if (node.hasAttribute('src')) {
      node.removeAttribute('src');
      node.load();
    }
  }

  function syncMusic(): void {
    if (!music || !musicSound || destroyed || musicFinished) return;
    music.volume = gain(musicSound.volume) * musicGain;
    if (muted || music.volume === 0) music.pause();
    else if (music.paused) void music.play().catch(() => {});
  }

  function syncLoop(): void {
    if (!loop || !loopSound || destroyed) return;
    loop.volume = gain(loopSound.volume) * sfxGain;
    if (muted || loop.volume === 0) loop.pause();
    else if (loop.paused) void loop.play().catch(() => {});
  }

  function stopLoop(): void {
    if (loop) dispose(loop);
    loop = null;
    loopSound = undefined;
  }

  function stopOneShots(): void {
    for (const node of oneShots.keys()) dispose(node);
    oneShots.clear();
  }

  function sync(): void {
    syncMusic();
    syncLoop();
    if (muted || sfxGain === 0) stopOneShots();
    else for (const [node, volume] of oneShots) node.volume = gain(volume) * sfxGain;
  }

  return {
    retryMusic: syncMusic,
    startLoop(value: unknown, fallback?: unknown): void {
      stopLoop();
      if (destroyed) return;
      loopSound = pickSound(value) ?? pickSound(fallback);
      if (!loopSound) return;
      loop = new Audio(loopSound.url);
      loop.loop = true;
      syncLoop();
    },
    stopLoop,
    play(value: unknown): void {
      if (destroyed || muted || sfxGain === 0) return;
      const sound = pickSound(value);
      if (!sound || sound.volume === 0) return;
      const node = new Audio(sound.url);
      node.volume = gain(sound.volume) * sfxGain;
      oneShots.set(node, sound.volume);
      const release = () => { oneShots.delete(node); dispose(node); };
      node.addEventListener('ended', release, { once: true });
      void node.play().catch(release);
    },
    setMuted(value: boolean): void { muted = value; sync(); },
    setVolume(value: Volume): void {
      muted = value.muted === true;
      musicGain = gain(value.musicVolume);
      sfxGain = gain(value.sfxVolume);
      sync();
    },
    finishMusic(): void {
      musicFinished = true;
      if (music) dispose(music);
    },
    destroy(): void {
      destroyed = true;
      if (music) dispose(music);
      stopLoop();
      stopOneShots();
    },
  };
}
