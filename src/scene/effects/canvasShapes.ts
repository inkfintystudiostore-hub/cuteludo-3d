/** Canvas 2D path helpers shared by the particle sprites and the dice faces. */

export const INK = '#2b213a';

/** Traces a five-pointed star centred on (cx, cy). */
export function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, outer: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Traces a heart roughly `size` wide either side of cx, centred vertically on cy. */
export function heartPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const bottom = cy + size * 0.62;
  const notch = cy - size * 0.32;
  ctx.beginPath();
  ctx.moveTo(cx, bottom);
  ctx.bezierCurveTo(cx - size * 1.15, cy - size * 0.1, cx - size * 0.58, cy - size * 0.98, cx, notch);
  ctx.bezierCurveTo(cx + size * 0.58, cy - size * 0.98, cx + size * 1.15, cy - size * 0.1, cx, bottom);
  ctx.closePath();
}

/** Sticker look: thick ink outline with rounded joins, then the fill on top. */
export function inkFill(ctx: CanvasRenderingContext2D, fill: string | CanvasGradient, lineWidth: number): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}
