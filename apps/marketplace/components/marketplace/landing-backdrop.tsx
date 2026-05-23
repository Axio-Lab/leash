'use client';

import * as React from 'react';

type BackdropStyle = React.CSSProperties & {
  '--pointer-x'?: string;
  '--pointer-y'?: string;
};

const STARS = [
  { top: '9%', left: '-18%', delay: '0s', duration: '8s', travelX: '142vw', travelY: '44vh' },
  { top: '18%', left: '28%', delay: '2.4s', duration: '10s', travelX: '86vw', travelY: '30vh' },
  { top: '42%', left: '-24%', delay: '4.8s', duration: '9s', travelX: '130vw', travelY: '36vh' },
  { top: '66%', left: '12%', delay: '7.2s', duration: '11s', travelX: '100vw', travelY: '22vh' },
  { top: '78%', left: '-20%', delay: '9.5s', duration: '12s', travelX: '122vw', travelY: '18vh' },
] as const;

export function LandingBackdrop() {
  const [style, setStyle] = React.useState<BackdropStyle>({
    '--pointer-x': '50%',
    '--pointer-y': '12%',
  });

  React.useEffect(() => {
    const updatePointer = (event: PointerEvent) => {
      setStyle({
        '--pointer-x': `${(event.clientX / window.innerWidth) * 100}%`,
        '--pointer-y': `${(event.clientY / window.innerHeight) * 100}%`,
      });
    };

    window.addEventListener('pointermove', updatePointer, { passive: true });
    return () => window.removeEventListener('pointermove', updatePointer);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-1/2 top-0 -z-10 h-full w-screen -translate-x-1/2 overflow-hidden"
      style={style}
    >
      <div className="absolute inset-0 bg-[linear-gradient(to_right,oklch(1_0_0/0.035)_1px,transparent_1px),linear-gradient(to_bottom,oklch(1_0_0/0.035)_1px,transparent_1px)] bg-[size:48px_48px] opacity-60" />
      <div className="landing-pointer-light absolute inset-0" />
      <div className="absolute inset-0 bg-[radial-gradient(100%_60%_at_50%_0%,oklch(0.66_0.19_268/0.18),transparent_55%)]" />
      <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-brand/50 to-transparent" />
      {STARS.map((star, index) => (
        <span
          key={index}
          className="landing-shooting-star"
          style={
            {
              top: star.top,
              left: star.left,
              '--star-delay': star.delay,
              '--star-duration': star.duration,
              '--star-travel-x': star.travelX,
              '--star-travel-y': star.travelY,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
