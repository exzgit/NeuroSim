/**
 * main.js - Application Controller
 *
 * Coordinates Brain, Game, Visualizer, and Memory.
 * Manages the game loop, speed controls, and UI state.
 *
 * Phases:
 *   1. Load memory (if exists)
 *   2. Teaching phase (1× demonstration)
 *   3. Exploration phase (autonomous learning)
 */

import { Brain } from './brain.js';
import { Game } from './game.js';
import { Memory } from './memory.js';
import { Visualizer } from './visualizer.js';

class NeuroSim {
  constructor() {
    this.brain = new Brain();
    this.game = new Game(15);
    this.memory = new Memory();
    this.viz = null;

    this.phase = 'idle';       // 'idle' | 'teaching' | 'playing' | 'paused'
    this.speed = 1;            // 1 = normal, 4 = fast, 16 = ultra
    this.ticksPerFrame = 1;

    this.rafId = null;
    this.lastFrameTime = 0;
    this.gameStepInterval = 32; // Run a game step every N brain ticks
    this.ticksSinceGameStep = 0;

    this.teachStep = null;
    this.currentTeachSequence = [];
    this.teachIndex = 0;

    this.saveInterval = 100;  
    this.episodeCount = 0;

    this.logMessages = [];

    this._init();
  }

  _init() {
    // Canvases
    const brainCanvas = document.getElementById('brain-canvas');
    const gameCanvas  = document.getElementById('game-canvas');
    const chartCanvas = document.getElementById('chart-canvas');

    this.viz = new Visualizer(brainCanvas, gameCanvas, chartCanvas);
    this.viz.inspectorCallback = (neuron) => this._updateInspector(neuron);

    // Brain callbacks
    this.brain.onNeuronFire = (neuron) => {
      // Particle effect hook (handled by visualizer)
    };
    this.brain.onDecision = (action, confidence) => {
      const labels = ['↑ Up','↓ Down','← Left','→ Right'];
      this._updateUI('decision-label', labels[action]);
      this._updateUI('confidence-label', (confidence * 100).toFixed(1) + '%');
    };

    // Game callbacks
    this.game.onReward = (amount, reason) => {
      this.brain.applyDopamine(amount);
      this._updateUI('last-reward', (amount > 0 ? '+' : '') + amount.toFixed(2));
      this._updateUI('reward-reason', reason);
      this._flashReward(amount > 0);
    };
    this.game.onEpisodeEnd = (stats) => {
      this.episodeCount++;
      this.memory.save(this.brain.serialize(), stats);
      this._updateStatsUI(stats);
      this._log(`Episode ${stats.episode}: Score ${stats.score.toFixed(2)}, Food: ${stats.foodEaten}`);
      this._updateChart();

      // Auto-restart next episode after short delay
      setTimeout(() => {
        if (this.phase === 'playing') this.game.startEpisode();
      }, 600);
    };

    // Load memory
    const { found, data } = this.memory.load();
    if (found) {
      const ok = this.brain.load(data);
      this._log(ok ? '🧠 Memory loaded from previous session!' : 'Memory format mismatch, starting fresh.');
    } else {
      this._log('🌱 No memory found - starting fresh.');
    }

    // Button handlers
    document.getElementById('btn-start').addEventListener('click', () => this._startTeaching());
    document.getElementById('btn-pause').addEventListener('click', () => this._togglePause());
    document.getElementById('btn-reset').addEventListener('click', () => this._resetAll());
    document.getElementById('btn-save').addEventListener('click', () => this.memory.exportJSON());
    // (btn-fast dihapus, tidak ada di HTML)

    // Speed options
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.speed = parseInt(btn.dataset.speed);
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._log(`⏩ Speed set to ${btn.dataset.speed}x`);
      });
    });

    this._updateMemorySummary();
    this._log('🔬 NeuroSim ready. Click "Start" to begin.');

    // Initial render
    this.viz.drawBrain(this.brain);
    this.viz.drawGame(this.game, 'idle');
  }

  // ─── Phase Control ────────────────────────────────────────────────────────

  async _startTeaching() {
    if (this.phase !== 'idle') return;
    document.getElementById('btn-start').disabled = true;

    if (this.brain.taughtOnce) {
      this._log('ℹ️ Already taught. Skipping to exploration...');
      this._startPlaying();
      return;
    }

    this.phase = 'teaching';
    this.game.reset();
    this.game.state = 'teaching';

    this._log('📖 Teaching phase begins (1× demonstration)...');
    this._updatePhaseUI('Teaching');

    // Generate optimal teaching route
    this.currentTeachSequence = this.game.generateTeachingSequence(12);
    this._log(`Teaching sequence: ${this.currentTeachSequence.map(a => ['↑','↓','←','→'][a]).join(' ')}`);

    await this.brain.teach(this.currentTeachSequence, async (action) => {
      this.teachStep = action;
      this.game.step(action);
      this.viz.drawGame(this.game, 'teaching', action);
      this.viz.drawBrain(this.brain);
      await this._delay(20);
    });

    this._log('✅ Teaching complete! Neurons will now explore on their own.');
    this.teachStep = null;

    await this._delay(60);
    this._startPlaying();
  }

  _startPlaying() {
    this.phase = 'playing';
    this._updatePhaseUI('Exploring');
    this.game.startEpisode();
    this._log('🧠 Neural exploration started. Watch them learn!');
    this._loop();
  }

  _togglePause() {
    if (this.phase === 'paused') {
      this.phase = 'playing';
      document.getElementById('btn-pause').textContent = '⏸ Pause';
      this._loop();
    } else if (this.phase === 'playing') {
      this.phase = 'paused';
      document.getElementById('btn-pause').textContent = '▶ Resume';
      if (this.rafId) cancelAnimationFrame(this.rafId);
    }
  }

  _resetAll() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.phase = 'idle';
    this.brain.resetLearning();
    this.game.reset();
    this.episodeCount = 0;
    document.getElementById('btn-start').disabled = false;
    document.getElementById('btn-pause').textContent = '⏸ Pause';
    this._updatePhaseUI('Idle');
    this._log('🔄 Reset complete. Memory and weights cleared.');
    this.viz.drawBrain(this.brain);
    this.viz.drawGame(this.game, 'idle');
  }

  // ─── Game Loop ───────────────────────────────────────────────────────────

  _loop(timestamp = 0) {
    if (this.phase !== 'playing') return;

    const ticks = this.speed === 1 ? 1
                : this.speed === 4 ? 3
                : this.speed === 16 ? 10
                : 1;

    for (let t = 0; t < ticks; t++) {
      this.brain.tick();
      this.ticksSinceGameStep++;

      if (this.ticksSinceGameStep >= this.gameStepInterval) {
        this.ticksSinceGameStep = 0;

        if (this.game.state !== 'dead') {
          // Get sensors and feed to brain
          const sensors = this.game.getSensors();
          this.brain.stimulateSensors(sensors);

          // Read brain's decision
          const action = this.brain.readMotorOutput();

          // Apply action to game
          if (action >= 0) {
            this.game.step(action);
          }
        }
      }
    }

    // Render (every frame regardless of speed)
    this.viz.drawBrain(this.brain);
    this.viz.drawGame(this.game, 'playing');
    this._updateLiveUI();

    this.rafId = requestAnimationFrame((ts) => this._loop(ts));
  }

  // ─── UI Helpers ───────────────────────────────────────────────────────────

  _updateUI(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  _updatePhaseUI(phase) {
    this._updateUI('phase-label', phase);
    const badge = document.getElementById('phase-badge');
    if (badge) {
      badge.className = 'phase-badge phase-' + phase.toLowerCase();
    }
  }

  _updateLiveUI() {
    this._updateUI('timestep-label', this.brain.timestep.toLocaleString());
    this._updateUI('episode-label', this.game.episode);
    this._updateUI('score-label', this.game.score.toFixed(2));
    this._updateUI('food-eaten', this.game.foodEaten);
    this._updateUI('fires-label', this.brain.stats.totalFires.toLocaleString());
    this._updateUI('dopamine-label', this.brain.dopamineLevel.toFixed(3));

    // Synapse count and avg weight
    const avgW = this.brain.synapses.reduce((a, s) => a + s.weight, 0)
               / this.brain.synapses.length;
    this._updateUI('avg-weight', avgW.toFixed(4));
    this._updateUI('synapse-count', this.brain.synapses.length);
  }

  _updateStatsUI(stats) {
    this._updateUI('best-score', this.game.bestScore.toFixed(2));
    this._updateUI('total-episodes', this.game.episode);
  }

  _updateChart() {
    const scores = this.memory.getScoreSeries();
    this.viz.drawChart(scores);
  }

  _updateInspector(neuron) {
    const panel = document.getElementById('inspector-panel');
    if (!panel) return;
    if (!neuron) {
      panel.innerHTML = '<span class="inspector-hint">Hover a neuron to inspect</span>';
      return;
    }
    panel.innerHTML = `
      <div class="inspector-row"><span>ID</span><span>${neuron.id}</span></div>
      <div class="inspector-row"><span>Type</span><span>${neuron.type}</span></div>
      <div class="inspector-row"><span>Membrane</span><span>${neuron.membranePotential.toFixed(2)} mV</span></div>
      <div class="inspector-row"><span>Threshold</span><span>${neuron.threshold} mV</span></div>
      <div class="inspector-row"><span>NT Level</span><span>${(neuron.ntLevel * 100).toFixed(1)}%</span></div>
      <div class="inspector-row"><span>Fatigue</span><span>${(neuron.fatigue * 100).toFixed(1)}%</span></div>
      <div class="inspector-row"><span>Spike Count</span><span>${neuron.spikeCount}</span></div>
      <div class="inspector-row"><span>Refractory</span><span>${neuron.refractoryTime > 0 ? '🔴 Yes' : '🟢 No'}</span></div>
      <div class="inspector-row"><span>Connections</span><span>${neuron.axons.length} out / ${neuron.dendrites.length} in</span></div>
    `;
  }

  _updateMemorySummary() {
    const s = this.memory.getSummary();
    this._updateUI('mem-generations', s.generations);
    this._updateUI('mem-experience', s.totalExperience.toLocaleString());
    this._updateUI('mem-best', s.bestScore.toFixed(2));
    this._updateUI('mem-episodes', s.episodesRecorded);
  }

  _flashReward(positive) {
    const el = document.getElementById('reward-flash');
    if (!el) return;
    el.className = 'reward-flash ' + (positive ? 'reward-pos' : 'reward-neg');
    el.style.opacity = '0.7';
    setTimeout(() => { el.style.opacity = '0'; }, 200);
  }

  _log(msg) {
    this.logMessages.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (this.logMessages.length > 50) this.logMessages.pop();
    const el = document.getElementById('log-panel');
    if (el) el.innerHTML = this.logMessages.map(m => `<div class="log-entry">${m}</div>`).join('');
  }



  _delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}

// Boot
window.addEventListener('DOMContentLoaded', () => {
  window.sim = new NeuroSim();
});
