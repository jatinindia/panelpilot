interface SamplePanel {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly from: string;
  readonly to: string;
  readonly accent: string;
  readonly name: string;
}

// Two rows on a white background: three tiles on top, a wide banner and a tile below.
const PANELS: readonly SamplePanel[] = [
  { x: 40, y: 40, w: 460, h: 450, from: '#cfe8dc', to: '#9fd3bb', accent: '#2f8a63', name: 'SERUM' },
  { x: 520, y: 40, w: 460, h: 450, from: '#f4d9bd', to: '#e8b98c', accent: '#b56a2a', name: 'BALM' },
  { x: 1000, y: 40, w: 460, h: 450, from: '#d5daf3', to: '#a9b2e6', accent: '#4a56b8', name: 'MIST' },
  { x: 40, y: 510, w: 940, h: 450, from: '#efd2dc', to: '#d99bb1', accent: '#a23d63', name: 'THE FULL RITUAL' },
  { x: 1000, y: 510, w: 460, h: 450, from: '#e3e6c4', to: '#c3c98a', accent: '#6b7322', name: 'OIL' },
];

export async function sampleCollage(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 1500;
  canvas.height = 1000;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a canvas for the sample collage');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  PANELS.forEach((p, i) => drawPanel(ctx, p, i));
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the sample collage');
  return new File([blob], 'sample-collage.png', { type: 'image/png' });
}

function drawPanel(ctx: CanvasRenderingContext2D, p: SamplePanel, index: number): void {
  // Keep decorations and shadows inside the panel so the gutters stay clean.
  ctx.save();
  ctx.beginPath();
  ctx.rect(p.x, p.y, p.w, p.h);
  ctx.clip();
  const gradient = ctx.createLinearGradient(p.x, p.y, p.x + p.w, p.y + p.h);
  gradient.addColorStop(0, p.from);
  gradient.addColorStop(1, p.to);
  ctx.fillStyle = gradient;
  ctx.fillRect(p.x, p.y, p.w, p.h);

  ctx.globalAlpha = 0.18;
  ctx.fillStyle = p.accent;
  ctx.beginPath();
  ctx.arc(p.x + p.w * 0.78, p.y + p.h * 0.2, Math.min(p.w, p.h) * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const bottles = p.w > 600 ? 3 : 1;
  for (let b = 0; b < bottles; b++) {
    const cx = p.x + (p.w * (b + 1)) / (bottles + 1);
    drawBottle(ctx, cx, p.y + p.h * 0.56, p.accent);
  }

  ctx.fillStyle = '#26332d';
  ctx.font = '700 22px system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('FIELD / FORM', p.x + 28, p.y + 46);
  ctx.fillStyle = p.accent;
  ctx.font = '800 18px system-ui, sans-serif';
  ctx.fillText(p.name, p.x + 28, p.y + p.h - 52);
  ctx.fillStyle = '#26332d';
  ctx.font = '600 14px ui-monospace, monospace';
  ctx.fillText(`No. 0${index + 1}`, p.x + 28, p.y + p.h - 28);
  ctx.restore();
}

function drawBottle(ctx: CanvasRenderingContext2D, cx: number, cy: number, accent: string): void {
  ctx.save();
  ctx.shadowColor = 'rgba(30, 40, 35, 0.25)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 16;
  ctx.fillStyle = '#fbfbf8';
  roundRect(ctx, cx - 70, cy - 120, 140, 230, 26);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = accent;
  roundRect(ctx, cx - 30, cy - 160, 60, 48, 10);
  ctx.fill();
  roundRect(ctx, cx - 50, cy - 40, 100, 80, 12);
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
