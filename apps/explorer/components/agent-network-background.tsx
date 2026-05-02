'use client';

import * as React from 'react';

/**
 * Ambient canvas backdrop for the explorer hero card.
 *
 * Mirrors the agent-network animation used on `apps/agents` — a slowly
 * drifting graph of "agent" nodes with bright signal pulses streaming
 * along the edges — but tuned for a smaller, denser-feeling hero
 * panel: tighter edge distance, fewer pulses, and a more aggressive
 * radial mask so the centre of the card stays clean for the headline.
 *
 * Implementation notes:
 *  - Pure 2D canvas + `requestAnimationFrame`. No deps.
 *  - `prefers-reduced-motion` halts pulse spawning and node drift; the
 *    static graph is still rendered so the hero never reads as broken.
 *  - The canvas resizes with its wrapper via `ResizeObserver`, so node
 *    density stays roughly constant across breakpoints.
 *  - Brand colour is read from `--color-brand` so palette swaps in
 *    `globals.css` flow through automatically.
 */
export function AgentNetworkBackground({ className = '' }: { className?: string }) {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    const brand = getBrandColor();

    type Node = {
      x: number;
      y: number;
      vx: number;
      vy: number;
      radius: number;
      pulse: number;
      pulseSpeed: number;
    };
    type Edge = { a: number; b: number };
    type Pulse = { edge: Edge; progress: number; speed: number; hue: 'brand' | 'soft' };

    let width = 0;
    let height = 0;
    let dpr = 1;
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    const pulses: Pulse[] = [];

    function rebuild() {
      const rect = wrapper!.getBoundingClientRect();
      width = Math.max(rect.width, 320);
      height = Math.max(rect.height, 160);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Slightly lower density than the agents landing — the explorer
      // hero is half the height, and a packed mesh competes with the
      // headline. The cap of 48 keeps mobile + ultrawide reasonable.
      const targetCount = Math.min(48, Math.max(20, Math.round((width * height) / 26_000)));
      nodes = Array.from({ length: targetCount }, () => spawnNode(width, height));
      edges = computeEdges(nodes, edgeDistance(width));
      pulses.length = 0;
    }

    function tick(time: number) {
      ctx!.clearRect(0, 0, width, height);

      if (!reduceMotion) {
        for (const n of nodes) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < -10) n.x = width + 10;
          if (n.x > width + 10) n.x = -10;
          if (n.y < -10) n.y = height + 10;
          if (n.y > height + 10) n.y = -10;
          n.pulse = (n.pulse + n.pulseSpeed) % 1;
        }
      }

      const maxDist = edgeDistance(width);
      ctx!.lineWidth = 1;
      for (const e of edges) {
        const a = nodes[e.a];
        const b = nodes[e.b];
        if (!a || !b) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist > maxDist) continue;
        const fade = 1 - dist / maxDist;
        ctx!.strokeStyle = rgba(brand, 0.05 + fade * 0.07);
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
      }

      // Lower pulse cap + spawn rate vs the agents landing — the
      // explorer hero is denser per pixel so this keeps signal-to-
      // noise comfortable.
      if (!reduceMotion && pulses.length < 12 && Math.random() < 0.05) {
        const e = edges[Math.floor(Math.random() * edges.length)];
        if (e) {
          pulses.push({
            edge: e,
            progress: 0,
            speed: 0.004 + Math.random() * 0.008,
            hue: Math.random() < 0.7 ? 'brand' : 'soft',
          });
        }
      }

      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]!;
        p.progress += p.speed;
        if (p.progress >= 1) {
          pulses.splice(i, 1);
          continue;
        }
        const a = nodes[p.edge.a];
        const b = nodes[p.edge.b];
        if (!a || !b) {
          pulses.splice(i, 1);
          continue;
        }
        const x = a.x + (b.x - a.x) * p.progress;
        const y = a.y + (b.y - a.y) * p.progress;
        const trailLen = 0.18;
        const tailProg = Math.max(0, p.progress - trailLen);
        const tx = a.x + (b.x - a.x) * tailProg;
        const ty = a.y + (b.y - a.y) * tailProg;
        const grad = ctx!.createLinearGradient(tx, ty, x, y);
        grad.addColorStop(0, rgba(brand, 0));
        grad.addColorStop(1, rgba(brand, p.hue === 'brand' ? 0.55 : 0.25));
        ctx!.strokeStyle = grad;
        ctx!.lineWidth = 1.5;
        ctx!.beginPath();
        ctx!.moveTo(tx, ty);
        ctx!.lineTo(x, y);
        ctx!.stroke();
        ctx!.fillStyle = rgba(brand, p.hue === 'brand' ? 0.8 : 0.4);
        ctx!.beginPath();
        ctx!.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx!.fill();
      }

      for (const n of nodes) {
        const breathe = 0.55 + Math.sin(n.pulse * Math.PI * 2) * 0.2;
        ctx!.fillStyle = rgba(brand, 0.18 + breathe * 0.18);
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx!.fill();
      }

      raf = requestAnimationFrame(tick);
      void time;
    }

    let raf = 0;
    rebuild();
    raf = requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      rebuild();
      raf = requestAnimationFrame(tick);
    });
    ro.observe(wrapper);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      aria-hidden
      className={[
        'pointer-events-none absolute inset-0 overflow-hidden',
        // Tighter mask than the agents landing — the headline lives
        // closer to the centre, so we want the mesh to drop off faster.
        'mask-[radial-gradient(ellipse_at_center,black_45%,transparent_88%)]',
        className,
      ].join(' ')}
    >
      <canvas ref={canvasRef} className="block h-full w-full opacity-60" />
    </div>
  );
}

function spawnNode(width: number, height: number) {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.18,
    vy: (Math.random() - 0.5) * 0.18,
    radius: 1.1 + Math.random() * 1.4,
    pulse: Math.random(),
    pulseSpeed: 0.0015 + Math.random() * 0.0025,
  };
}

function edgeDistance(width: number): number {
  if (width < 640) return 95;
  if (width < 1024) return 120;
  return 145;
}

function computeEdges(
  nodes: Array<{ x: number; y: number }>,
  maxDist: number,
): Array<{ a: number; b: number }> {
  const edges: Array<{ a: number; b: number }> = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy <= maxDist * maxDist) {
        edges.push({ a: i, b: j });
      }
    }
  }
  return edges;
}

function rgba([r, g, b]: [number, number, number], alpha: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function getBrandColor(): [number, number, number] {
  const fallback: [number, number, number] = [94, 120, 245];
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim();
    if (!raw) return fallback;
    return parseCssColor(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

function parseCssColor(input: string): [number, number, number] | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const cx = c.getContext('2d');
  if (!cx) return null;
  cx.fillStyle = '#000000';
  cx.fillStyle = input;
  cx.fillRect(0, 0, 1, 1);
  try {
    const [r, g, b] = Array.from(cx.getImageData(0, 0, 1, 1).data) as [
      number,
      number,
      number,
      number,
    ];
    return [r, g, b];
  } catch {
    return null;
  }
}
