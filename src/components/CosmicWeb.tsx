import { useEffect, useRef } from "react";

/** Decorative canvas stays behind content and never intercepts navigation. */
export function CosmicWeb() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d", { alpha: true });
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(pointer: fine)");
    let frame = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let cursor = { x: -1000, y: -1000 };
    let focus = { x: -1000, y: -1000 };
    let points: { x: number; y: number }[] = [];

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const spacing = w < 700 ? 135 : 170;
      points = [];
      for (let y = -spacing; y < h + spacing; y += spacing) {
        for (let x = -spacing; x < w + spacing; x += spacing) {
          const seed = Math.sin(x * 0.017 + y * 0.031);
          points.push({ x: x + seed * 28 + (Math.floor(y / spacing) % 2) * spacing / 2, y: y + Math.cos(x * 0.023 + y * 0.012) * 28 });
        }
      }
      paint();
    };
    const paint = () => {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (!p) continue;
        for (let j = i + 1; j < points.length; j++) {
          const q = points[j];
          if (!q) continue;
          const dist = Math.hypot(p.x - q.x, p.y - q.y);
          if (dist > 185) continue;
          const proximity = Math.max(0, 1 - Math.min(Math.hypot((p.x + q.x) / 2 - focus.x, (p.y + q.y) / 2 - focus.y) / 300, 1));
          ctx.strokeStyle = `rgba(195, 212, 223, ${0.045 + proximity * 0.25})`;
          ctx.lineWidth = proximity > 0.2 ? 0.8 : 0.5;
          ctx.beginPath();
          ctx.moveTo(p.x + (focus.x - p.x) * proximity * 0.045, p.y + (focus.y - p.y) * proximity * 0.045);
          ctx.lineTo(q.x + (focus.x - q.x) * proximity * 0.045, q.y + (focus.y - q.y) * proximity * 0.045);
          ctx.stroke();
        }
      }
      if (fine.matches && focus.x >= 0 && focus.y >= 0) {
        const nearby = points.filter((p) => Math.hypot(p.x - focus.x, p.y - focus.y) < 190).sort((a, b) => Math.atan2(a.y - focus.y, a.x - focus.x) - Math.atan2(b.y - focus.y, b.x - focus.x));
        nearby.forEach((p, i) => {
          const next = nearby[(i + 1) % nearby.length];
          ctx.strokeStyle = "rgba(230, 241, 246, 0.24)";
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(focus.x, focus.y);
          ctx.lineTo(p.x, p.y);
          if (next) ctx.lineTo(next.x, next.y);
          ctx.stroke();
        });
      }
    };
    const tick = () => {
      focus.x += (cursor.x - focus.x) * 0.13;
      focus.y += (cursor.y - focus.y) * 0.13;
      paint();
      frame = requestAnimationFrame(tick);
    };
    const move = (e: PointerEvent) => { cursor = { x: e.clientX, y: e.clientY }; };
    const leave = () => { cursor = { x: -1000, y: -1000 }; };
    const motion = () => {
      cancelAnimationFrame(frame);
      if (!reduced.matches && fine.matches) frame = requestAnimationFrame(tick);
      else { focus = { x: -1000, y: -1000 }; paint(); }
    };
    resize();
    motion();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    reduced.addEventListener("change", motion);
    fine.addEventListener("change", motion);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      reduced.removeEventListener("change", motion);
      fine.removeEventListener("change", motion);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 opacity-80" />;
}