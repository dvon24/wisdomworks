'use client';

import { useEffect, useState } from 'react';

/**
 * Cinematic photo background with slow crossfade.
 * Used on the landing page and command deck.
 */

export const BG_IMAGES = [
  'https://images.unsplash.com/photo-1505144808419-1957a94ca61e?auto=format&fit=crop&w=2400&q=80',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2400&q=80',
  'https://images.unsplash.com/photo-1418489098061-ce87b5dc3aee?auto=format&fit=crop&w=2400&q=80',
  'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?auto=format&fit=crop&w=2400&q=80',
];

interface BackgroundProps {
  light?: boolean;
  /** Override the rotating image with a fixed index */
  fixedIndex?: number;
  /** Cycle interval in ms (default 11s) */
  intervalMs?: number;
  /** Custom image URLs (defaults to BG_IMAGES) */
  images?: string[];
}

export function Background({
  light = true,
  fixedIndex,
  intervalMs = 11000,
  images = BG_IMAGES,
}: BackgroundProps) {
  const [idx, setIdx] = useState(fixedIndex ?? 0);

  useEffect(() => {
    if (fixedIndex !== undefined) {
      setIdx(fixedIndex);
      return;
    }
    const t = setInterval(() => setIdx((i) => (i + 1) % images.length), intervalMs);
    return () => clearInterval(t);
  }, [fixedIndex, intervalMs, images.length]);

  return (
    <div className="bg-root" aria-hidden>
      {images.map((src, i) => (
        <div
          key={src}
          className={'bg-img' + (i === idx ? ' active' : '')}
          style={{ backgroundImage: `url(${src})` }}
        />
      ))}
      <div className={'bg-veil ' + (light ? 'light' : 'dark')} />
    </div>
  );
}
