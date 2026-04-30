'use client';

import * as React from 'react';

/**
 * Ambient canvas background for the landing hero.
 *
 * Renders a slowly-drifting network of "agent" nodes connected by faint
 * lines, with bright signal pulses streaming from node to node along
 * those connections. Visually conveys "execution layer for autonomous
 * agents" without ever competing with the foreground copy.
 *
 * Implementation notes:
 * - Pure 2D canvas + `requestAnimationFrame`. No deps.
 * - `prefers-reduced-motion` halts pulse spawning and node drift; nodes
 *   stay rendered so the page never feels broken for users who opt out.
 * - The canvas resizes with the window via a `ResizeObserver` on the
 *   wrapper element so node density stays roughly constant across
 *   breakpoints.
 * - Brand colour is read off `--color-brand` so palette swaps in
 *   `globals.css` flow through automatically.
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
      pulse: number; // 0..1 ambient breathing
      pulseSpeed: number;
    };

    type Edge = { a: number; b: number };

    type Pulse = {
      edge: Edge;
      progress: number;
      speed: number;
      hue: 'brand' | 'soft';
    };

    let width = 0;
    let height = 0;
    let dpr = 1;

    let nodes: Node[] = [];
    let edges: Edge[] = [];
    const pulses: Pulse[] = [];

    function rebuild() {
      const rect = wrapper!.getBoundingClientRect();
      width = Math.max(rect.width, 320);
      height = Math.max(rect.height, 320);
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const targetCount = Math.min(72, Math.max(28, Math.round((width * height) / 22_000)));
      nodes = Array.from({ length: targetCount }, () => spawnNode(width, height));
      edges = computeEdges(nodes, edgeDistance(width));
      // reset existing pulses against the new edge list
      pulses.length = 0;
    }

    function tick(time: number) {
      ctx!.clearRect(0, 0, width, height);

      // ── update nodes ───────────────────────────────────────────────
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

      // ── draw edges ─────────────────────────────────────────────────
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
        ctx!.strokeStyle = rgba(brand, 0.06 + fade * 0.08);
        ctx!.beginPath();
        ctx!.moveTo(a.x, a.y);
        ctx!.lineTo(b.x, b.y);
        ctx!.stroke();
      }

      // ── spawn pulses ──────────────────────────────────────────────
      if (!reduceMotion && pulses.length < 18 && Math.random() < 0.06) {
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

      // ── advance + draw pulses ─────────────────────────────────────
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
        // bright head dot
        ctx!.fillStyle = rgba(brand, p.hue === 'brand' ? 0.8 : 0.4);
        ctx!.beginPath();
        ctx!.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx!.fill();
      }

      // ── draw nodes ────────────────────────────────────────────────
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
        // Subtle radial mask so the mesh fades into the bg towards the
        // viewport edges, leaving the centre clean for the hero copy.
        '[mask-image:radial-gradient(ellipse_at_center,black_55%,transparent_92%)]',
        className,
      ].join(' ')}
    >
      <canvas ref={canvasRef} className="block w-full h-full opacity-60" />
    </div>
  );
}

function spawnNode(width: number, height: number) {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.18,
    vy: (Math.random() - 0.5) * 0.18,
    radius: 1.2 + Math.random() * 1.6,
    pulse: Math.random(),
    pulseSpeed: 0.0015 + Math.random() * 0.0025,
  };
}

function edgeDistance(width: number): number {
  // Thinner viewports get tighter graphs so edges don't span the page.
  if (width < 640) return 110;
  if (width < 1024) return 140;
  return 170;
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

/**
 * Read the brand colour out of CSS custom properties so swaps in
 * `globals.css` flow through. Falls back to the documented `#5e78f5`
 * accent when called outside a browser context.
 */
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

/**
 * Convert a computed CSS colour string (`rgb(...)`, `oklch(...)`, hex)
 * into an `[r, g, b]` triple. We let the browser do the heavy lifting
 * for `oklch` etc. by drawing the value into a 1px canvas — that way
 * we don't ship an `oklch → rgb` math kernel.
 */
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
