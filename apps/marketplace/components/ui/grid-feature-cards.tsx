import * as React from 'react';

import { cn } from '@/lib/cn';

type FeatureType = {
  title: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  description: string;
};

type FeatureCardProps = React.ComponentProps<'div'> & {
  feature: FeatureType;
};

export function FeatureCard({ feature, className, ...props }: FeatureCardProps) {
  const pattern = React.useMemo(() => genPattern(feature.title), [feature.title]);

  return (
    <div
      className={cn(
        'group relative min-h-[196px] overflow-hidden p-6 transition-colors duration-150 hover:bg-bg-elev/50',
        className,
      )}
      {...props}
    >
      <div className="pointer-events-none absolute left-1/2 top-0 -ml-20 -mt-2 h-full w-full mask-[linear-gradient(white,transparent)]">
        <div className="absolute inset-0 bg-linear-to-r from-foreground/5 to-foreground/1 opacity-100 mask-[radial-gradient(farthest-side_at_top,white,transparent)]">
          <GridPattern
            width={20}
            height={20}
            x="-12"
            y="4"
            squares={pattern}
            className="absolute inset-0 h-full w-full fill-foreground/5 stroke-foreground/25 mix-blend-overlay"
          />
        </div>
      </div>
      <feature.icon
        className="relative z-10 size-6 text-brand-strong transition-transform duration-150 group-hover:-translate-y-0.5"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <h3 className="relative z-10 mt-10 text-sm font-medium text-fg md:text-base">
        {feature.title}
      </h3>
      <p className="relative z-10 mt-2 text-xs leading-relaxed text-fg-muted">
        {feature.description}
      </p>
    </div>
  );
}

function GridPattern({
  width,
  height,
  x,
  y,
  squares,
  ...props
}: React.ComponentProps<'svg'> & {
  width: number;
  height: number;
  x: string;
  y: string;
  squares?: number[][];
}) {
  const patternId = React.useId();

  return (
    <svg aria-hidden="true" {...props}>
      <defs>
        <pattern
          id={patternId}
          width={width}
          height={height}
          patternUnits="userSpaceOnUse"
          x={x}
          y={y}
        >
          <path d={`M.5 ${height}V.5H${width}`} fill="none" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${patternId})`} />
      {squares ? (
        <svg x={x} y={y} className="overflow-visible">
          {squares.map(([squareX, squareY], index) => (
            <rect
              key={index}
              width={width + 1}
              height={height + 1}
              x={squareX * width}
              y={squareY * height}
              strokeWidth="0"
            />
          ))}
        </svg>
      ) : null}
    </svg>
  );
}

function genPattern(seed: string, length = 5): number[][] {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }

  return Array.from({ length }, (_, index) => {
    const value = Math.abs(hash + index * 97);
    return [(value % 4) + 7, (Math.floor(value / 4) % 6) + 1];
  });
}
