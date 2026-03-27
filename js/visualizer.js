/**
 * visualizer.js - Real-Time Neural Activity Visualization
 *
 * Renders two canvases:
 *   1. Brain canvas: neurons, synapses, firing activity
 *   2. Game canvas: 10x10 grid game
 *
 * Also renders:
 *   - Dopamine bar
 *   - Score history chart
 *   - Hovered neuron inspector
 */

export class Visualizer {
  constructor(brainCanvas, gameCanvas, chartCanvas) {
    this.brainCtx = brainCanvas.getContext('2d');
    this.gameCtx = gameCanvas.getContext('2d');
    this.chartCtx = chartCanvas.getContext('2d');

    this.brainW = brainCanvas.width;
    this.brainH = brainCanvas.height;
    this.gameW = gameCanvas.width;
    this.gameH = gameCanvas.height;

    this.hoveredNeuron = null;
    this.inspectorCallback = null;

    // Color palette
    this.colors = {
      bg: '#0a0a1a',
      sensory: '#00d4ff',
      inter: '#a855f7',
      motor: '#22c55e',
      reward: '#fbbf24',
      firing: '#ffffff',
      synapseEx: 'rgba(0, 212, 255, 0.3)',
      synapseInh: 'rgba(239, 68, 68, 0.25)',
      food: '#4ade80',
      hazard: '#f87171',
      agent: '#60a5fa',
      wall: '#1e1e2e',
      empty: '#111127'
    };

    // Bind hover for neuron click/hover
    brainCanvas.addEventListener('mousemove', (e) => {
      const rect = brainCanvas.getBoundingClientRect();
      const scaleX = brainCanvas.width / rect.width;
      const scaleY = brainCanvas.height / rect.height;
      this._handleHover(
        (e.clientX - rect.left) * scaleX,
        (e.clientY - rect.top) * scaleY
      );
    });
    brainCanvas.addEventListener('mouseleave', () => {
      this.hoveredNeuron = null;
    });
  }

  _handleHover(mx, my) {
    if (!this.brain) return;
    let closest = null;
    let minD = 20;
    for (const n of this.brain.neurons) {
      const d = Math.hypot(n.x - mx, n.y - my);
      if (d < minD) { minD = d; closest = n; }
    }
    this.hoveredNeuron = closest;
    if (this.inspectorCallback) this.inspectorCallback(closest);
  }

  // ─── Brain Visualization ────────────────────────────────────────────────

  drawBrain(brain) {
    this.brain = brain;
    const ctx = this.brainCtx;
    ctx.clearRect(0, 0, this.brainW, this.brainH);

    // Background
    ctx.fillStyle = this.colors.bg;
    ctx.fillRect(0, 0, this.brainW, this.brainH);

    // Draw synapses
    for (const syn of brain.synapses) {
      this._drawSynapse(ctx, syn);
    }

    // Draw neurons
    for (const neuron of brain.neurons) {
      this._drawNeuron(ctx, neuron);
    }

    // Dopamine bar
    this._drawDopamineBar(ctx, brain.dopamineLevel);
  }

  _drawSynapse(ctx, syn) {
    const { pre, post, weight, type } = syn;
    const alpha = 0.05 + weight * 0.45;
    const lineW = 0.3 + weight * 2.5;

    ctx.beginPath();
    ctx.moveTo(pre.x, pre.y);

    // Curve for recurrent connections
    if (pre.type === 'inter' && post.type === 'inter') {
      const cx = (pre.x + post.x) / 2 + (Math.random() > 0.5 ? 20 : -20);
      const cy = (pre.y + post.y) / 2;
      ctx.quadraticCurveTo(cx, cy, post.x, post.y);
    } else {
      ctx.lineTo(post.x, post.y);
    }

    ctx.strokeStyle = type === 'excitatory'
      ? `rgba(0, 212, 255, ${alpha})`
      : `rgba(239, 68, 68, ${alpha})`;
    ctx.lineWidth = lineW;
    ctx.stroke();

    // Active signal particles in queue
    if (syn.signalQueue.length > 0) {
      const t = 1 - (syn.signalQueue[0].delay / syn.delay);
      const px = pre.x + (post.x - pre.x) * t;
      const py = pre.y + (post.y - pre.y) * t;
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = type === 'excitatory' ? '#00d4ff' : '#ef4444';
      ctx.fill();
    }
  }

  _drawNeuron(ctx, neuron) {
    const { x, y, type, isFiring, activity, membranePotential, threshold } = neuron;
    const isHovered = this.hoveredNeuron === neuron;

    const baseColor = {
      sensory: '#00d4ff',
      inter:   '#a855f7',
      motor:   '#22c55e',
      reward:  '#fbbf24'
    }[type] || '#888';

    const radius = type === 'inter' ? 9 : (type === 'reward' ? 11 : 12);

    // Glow effect when firing or active
    if (isFiring || activity > 0.3) {
      const glowSize = isFiring ? 22 : 12 + activity * 10;
      const grd = ctx.createRadialGradient(x, y, 0, x, y, glowSize);
      grd.addColorStop(0, baseColor + (isFiring ? 'cc' : '55'));
      grd.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(x, y, glowSize, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();
    }

    // Membrane potential arc (progress around neuron)
    const potential = neuron.getNormalizedPotential();
    ctx.beginPath();
    ctx.arc(x, y, radius + 3, -Math.PI / 2, -Math.PI / 2 + potential * Math.PI * 2);
    ctx.strokeStyle = isFiring ? '#ffffff' : baseColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Neuron body
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    const bodyColor = isFiring ? '#ffffff' : `rgba(${this._hexToRgb(baseColor)}, ${0.3 + activity * 0.7})`;
    ctx.fillStyle = bodyColor;
    ctx.fill();
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Fatigued overlay
    if (neuron.fatigue > 0.5) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,0,0,${neuron.fatigue * 0.4})`;
      ctx.fill();
    }

    // Label for sensory and motor
    if (type === 'sensory' || type === 'motor') {
      ctx.font = '9px monospace';
      ctx.fillStyle = '#ccc';
      ctx.textAlign = type === 'sensory' ? 'right' : 'left';
      const labelX = type === 'sensory' ? x - radius - 4 : x + radius + 4;
      ctx.fillText(neuron.label, labelX, y + 3);
    }

    // Hover tooltip outline
    if (isHovered) {
      ctx.beginPath();
      ctx.arc(x, y, radius + 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  _drawDopamineBar(ctx, level) {
    const barW = 150, barH = 8;
    const bx = this.brainW / 2 - barW / 2;
    const by = this.brainH - 20;

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(bx, by, barW, barH);

    const clampedLevel = Math.max(-1, Math.min(1, level));
    const fillColor = clampedLevel > 0 ? '#fbbf24' : '#ef4444';
    const fillW = Math.abs(clampedLevel) * (barW / 2);
    const fillX = clampedLevel >= 0 ? bx + barW / 2 : bx + barW / 2 - fillW;

    ctx.fillStyle = fillColor;
    ctx.fillRect(fillX, by, fillW, barH);

    ctx.font = '10px monospace';
    ctx.fillStyle = '#888';
    ctx.textAlign = 'center';
    ctx.fillText(`Dopamine: ${level.toFixed(2)}`, this.brainW / 2, by - 4);
  }

  _hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `${r},${g},${b}`;
  }

  // ─── Game Visualization ─────────────────────────────────────────────────

  drawGame(game, phase, teachStep = null) {
    const ctx = this.gameCtx;
    const cs = Math.floor(this.gameW / game.gridSize);

    ctx.clearRect(0, 0, this.gameW, this.gameH);

    // Background
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, this.gameW, this.gameH);

    // Grid cells
    for (let y = 0; y < game.gridSize; y++) {
      for (let x = 0; x < game.gridSize; x++) {
        const type = game.getCellType(x, y);
        const px = x * cs, py = y * cs;

        // Cell base
        ctx.fillStyle = '#111127';
        ctx.fillRect(px + 1, py + 1, cs - 2, cs - 2);

        // Grid line
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, cs, cs);

        if (type === 'food') {
          this._drawFood(ctx, px + cs/2, py + cs/2, cs * 0.3);
        } else if (type === 'hazard') {
          this._drawHazard(ctx, px + cs/2, py + cs/2, cs * 0.3);
        } else if (type === 'agent') {
          this._drawAgent(ctx, px + cs/2, py + cs/2, cs * 0.35, phase);
        }
      }
    }

    // Teaching arrow overlay
    if (phase === 'teaching' && teachStep !== null) {
      const arrows = ['↑','↓','←','→'];
      const { x, y } = game.agent;
      ctx.font = `${cs * 0.5}px serif`;
      ctx.fillStyle = 'rgba(251,191,36,0.9)';
      ctx.textAlign = 'center';
      ctx.fillText(arrows[teachStep] || '?', x * cs + cs/2, y * cs + cs * 0.4);
    }
  }

  _drawFood(ctx, cx, cy, r) {
    // Green glowing circle
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2);
    grd.addColorStop(0, 'rgba(74,222,128,0.4)');
    grd.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#4ade80';
    ctx.fill();

    // Shine
    ctx.beginPath();
    ctx.arc(cx - r * 0.2, cy - r * 0.2, r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
  }

  _drawHazard(ctx, cx, cy, r) {
    // Red spiky hazard
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.5);
    grd.addColorStop(0, 'rgba(239,68,68,0.4)');
    grd.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Draw X shape
    ctx.strokeStyle = '#f87171';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r); ctx.lineTo(cx + r, cy + r);
    ctx.moveTo(cx + r, cy - r); ctx.lineTo(cx - r, cy + r);
    ctx.stroke();
  }

  _drawAgent(ctx, cx, cy, r, phase) {
    const color = phase === 'teaching' ? '#fbbf24' : '#60a5fa';
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.5);
    grd.addColorStop(0, color + '44');
    grd.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Eyes
    ctx.beginPath();
    ctx.arc(cx - r * 0.25, cy - r * 0.2, r * 0.18, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.25, cy - r * 0.2, r * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0a1a';
    ctx.fill();
  }

  // ─── Score Chart ────────────────────────────────────────────────────────

  drawChart(scoreSeries) {
    const ctx = this.chartCtx;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, W, H);

    if (scoreSeries.length < 2) return;

    const data = scoreSeries.slice(-60);
    const min = Math.min(...data, -1);
    const max = Math.max(...data, 1);
    const range = max - min || 1;

    const toY = v => H - 8 - ((v - min) / range) * (H - 16);
    const toX = i => 4 + (i / (data.length - 1)) * (W - 8);

    // Zero line
    ctx.beginPath();
    ctx.moveTo(0, toY(0));
    ctx.lineTo(W, toY(0));
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Line
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(data[0]));
    for (let i = 1; i < data.length; i++) {
      ctx.lineTo(toX(i), toY(data[i]));
    }
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#a855f744');
    grad.addColorStop(1, '#22c55e');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dots at last point
    ctx.beginPath();
    ctx.arc(toX(data.length-1), toY(data[data.length-1]), 3, 0, Math.PI*2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();
  }
}
