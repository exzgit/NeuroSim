/**
 * brain.js - Neural Network Assembly & Orchestration
 *
 * Constructs a biologically-structured neural network:
 *   Sensory (5) → Interneurons (20) → Motor (4) + Reward (1)
 *
 * Manages:
 *   - Timestep simulation loop
 *   - Sensory input distribution
 *   - Motor output reading
 *   - Dopamine modulation from game rewards
 *   - Teaching phase (1x demonstration)
 *   - Memory save/load
 */

import { Neuron } from './neuron.js';
import { Synapse } from './synapse.js';

export class Brain {
  constructor() {
    this.timestep = 0;
    this.neurons = [];
    this.synapses = [];
    this.taughtOnce = false;

    // Dopamine state
    this.dopamineLevel = 0;        // Current dopamine (-1 to +1)
    this.dopamineDecay = 0.05;     // How fast dopamine decays per tick
    this.dopamineHistory = [];

    // Event callbacks
    this.onNeuronFire = null;
    this.onDecision = null;

    // Layer references
    this.sensoryNeurons = [];
    this.interNeurons = [];
    this.motorNeurons = [];
    this.rewardNeuron = null;

    // Statistics
    this.stats = {
      totalFires: 0,
      totalRewards: 0,
      totalPunishments: 0,
      avgDopamine: 0,
      decisions: []
    };

    this._build();
  }

  /**
   * Build the neural network topology
   * Sensory → Inter → Motor, with reward modulation
   */
  _build() {
    // === Sensory Neurons (5) ===
    const sensorLabels = [
      'Food Distance', 'Food Angle',
      'Danger Vertical', 'Danger Horizontal', 'Wall Distance'
    ];
    for (let i = 0; i < 5; i++) {
      const n = new Neuron(`sensor_${i}`, 'sensory', sensorLabels[i]);
      this.sensoryNeurons.push(n);
      this.neurons.push(n);
    }

    // === Interneurons (20) ===
    for (let i = 0; i < 100; i++) {
      const n = new Neuron(`inter_${i}`, 'inter', `Hidden ${i}`);
      this.interNeurons.push(n);
      this.neurons.push(n);
    }

    // === Motor Neurons (4) ===
    const motorLabels = ['Up', 'Down', 'Left', 'Right'];
    for (let i = 0; i < 4; i++) {
      const n = new Neuron(`motor_${i}`, 'motor', motorLabels[i]);
      this.motorNeurons.push(n);
      this.neurons.push(n);
    }

    // === Reward Neuron (1) ===
    this.rewardNeuron = new Neuron('reward_0', 'reward', 'Dopamine');
    this.neurons.push(this.rewardNeuron);

    // === Layout Positions for Visualization ===
    this._assignPositions();

    // === Wire Synapses ===
    this._wireConnections();
  }

  _assignPositions() {
    const W = 900, H = 500;
    // Sensory: left column
    this.sensoryNeurons.forEach((n, i) => {
      n.x = 80;
      n.y = 60 + i * ((H - 120) / 4);
    });
    // Interneurons: middle columns (2 columns of 10)
    this.interNeurons.forEach((n, i) => {
      const col = Math.floor(i / 10);
      const row = i % 10;
      n.x = 280 + col * 200;
      n.y = 30 + row * ((H - 60) / 9);
    });
    // Motor: right column
    this.motorNeurons.forEach((n, i) => {
      n.x = W - 80;
      n.y = 140 + i * 60;
    });
    // Reward: bottom center
    this.rewardNeuron.x = W / 2;
    this.rewardNeuron.y = H - 30;
  }

  /**
   * Create all synaptic connections
   */
  _wireConnections() {
    // Sensory → All Interneurons (sparse: 60% connectivity)
    for (const s of this.sensoryNeurons) {
      for (const h of this.interNeurons) {
        if (Math.random() < 0.6) {
          this._connect(s, h);
        }
      }
    }

    // Interneuron → Interneuron (recurrent, sparse: 15%)
    for (const h1 of this.interNeurons) {
      for (const h2 of this.interNeurons) {
        if (h1 !== h2 && Math.random() < 0.15) {
          this._connect(h1, h2);
        }
      }
    }

    // Interneurons → Motor (80% connectivity)
    for (const h of this.interNeurons) {
      for (const m of this.motorNeurons) {
        if (Math.random() < 0.8) {
          this._connect(h, m);
        }
      }
    }

    // Sensory → Motor (direct, sparse: 20%)
    for (const s of this.sensoryNeurons) {
      for (const m of this.motorNeurons) {
        if (Math.random() < 0.2) {
          this._connect(s, m);
        }
      }
    }

    // Reward neuron → Interneurons (modulatory, but not spiking-connected;
    // reward is applied via dopamine broadcast below)
  }

  _connect(pre, post, options = {}) {
    const syn = new Synapse(pre, post, options);
    pre.axons.push(syn);
    post.dendrites.push(syn);
    this.synapses.push(syn);
    return syn;
  }

  // ─── Sensory Input ────────────────────────────────────────────────────────

  /**
   * Inject sensor readings into input neurons.
   * Each value is normalized 0-1 (or -1 to 1) and converted to mV stimulus.
   * @param {object} sensors - {foodDist, foodAngle, dangerV, dangerH, wallDist}
   */
  stimulateSensors(sensors) {
    const values = [
      sensors.foodDist,
      sensors.foodAngle,
      sensors.dangerV,
      sensors.dangerH,
      sensors.wallDist
    ];
    values.forEach((val, i) => {
      // Convert 0-1 normalized value to mV stimulus pulse
      // Scale so that strong stimuli reliably raise potential toward threshold
      const stimulus = val * 18; // 18mV per unit
      this.sensoryNeurons[i].injectCurrent(stimulus);
    });
  }

  // ─── Motor Output ─────────────────────────────────────────────────────────

  /**
   * Read motor neuron activity and decide on an action.
   * Returns: 0=Up, 1=Down, 2=Left, 3=Right, or -1=no action
   * Probabilistic selection weighted by membrane potential
   */
  readMotorOutput() {
    // Winner-take-all with softmax-like probability
    const potentials = this.motorNeurons.map(n =>
      Math.max(0, n.membranePotential - n.restingPotential)
    );
    const total = potentials.reduce((a, b) => a + b, 0);

    if (total < 0.5) return -1; // Network is quiet, no decision

    // Softmax probabilities
    const probs = potentials.map(p => p / (total + 1e-9));
    const r = Math.random();
    let cumulative = 0;
    for (let i = 0; i < probs.length; i++) {
      cumulative += probs[i];
      if (r < cumulative) {
        if (this.onDecision) this.onDecision(i, probs[i]);
        this.stats.decisions.push(i);
        return i;
      }
    }
    return -1;
  }

  // ─── Dopamine System ──────────────────────────────────────────────────────

  /**
   * Apply a dopamine signal (reward/punishment)
   * This broadcasts reward modulation to all synapses via eligibility traces
   * @param {number} amount - Positive = reward, Negative = punishment
   */
  applyDopamine(amount) {
    this.dopamineLevel = Math.max(-1, Math.min(1, this.dopamineLevel + amount));

    if (amount > 0) {
      this.stats.totalRewards++;
      // Fire reward neuron for visualization
      this.rewardNeuron.injectCurrent(amount * 20);
    } else {
      this.stats.totalPunishments++;
    }

    // Broadcast reward modulation to all synapses
    for (const syn of this.synapses) {
      syn.applyRewardModulation(this.dopamineLevel);
    }
  }

  // ─── Teaching Phase ───────────────────────────────────────────────────────

  /**
   * One-time teaching demonstration.
   * Forces a sequence of actions by strongly stimulating specific motor neurons.
   * @param {number[]} actionSequence - Array of action indices [0-3]
   * @param {function} stepCallback - Called after each step to advance game
   */
  async teach(actionSequence, stepCallback) {
    if (this.taughtOnce) return;
    this.taughtOnce = true;

    for (const action of actionSequence) {
      // Strongly stimulate the correct motor neuron
      this.motorNeurons[action].injectCurrent(50);

      // Run several ticks so the signal propagates and STDP can record it
      for (let t = 0; t < 10; t++) {
        this.tick();
      }

      // Apply positive dopamine for this correct action
      this.applyDopamine(0.5);

      if (stepCallback) await stepCallback(action);
    }
  }

  // ─── Main Simulation Tick ─────────────────────────────────────────────────

  /**
   * Advance simulation by one timestep
   * Returns list of neurons that fired this tick
   */
  tick() {
    this.timestep++;

    // Update all synapses (transmit queued signals)
    for (const syn of this.synapses) {
      syn.tick(this.timestep);
    }

    // Update all neurons
    const fired = [];
    for (const neuron of this.neurons) {
      const didFire = neuron.update(this.timestep);
      if (didFire) {
        fired.push(neuron);
        this.stats.totalFires++;
        if (this.onNeuronFire) this.onNeuronFire(neuron);
      }
    }

    // Decay dopamine level
    this.dopamineLevel *= (1 - this.dopamineDecay);
    this.dopamineHistory.push(+this.dopamineLevel.toFixed(3));
    if (this.dopamineHistory.length > 300) this.dopamineHistory.shift();

    // Update avg dopamine stat
    this.stats.avgDopamine = this.dopamineHistory.reduce((a, b) => a + b, 0)
                            / this.dopamineHistory.length;

    return fired;
  }

  /**
   * Run N ticks without returning (for fast-forward)
   */
  tickN(n) {
    for (let i = 0; i < n; i++) this.tick();
  }

  // ─── Memory ───────────────────────────────────────────────────────────────

  /**
   * Serialize current brain state for memory.json
   */
  serialize() {
    return {
      version: 2,
      timestep: this.timestep,
      taughtOnce: this.taughtOnce,
      stats: this.stats,
      dopamineHistory: this.dopamineHistory.slice(-50),
      synapses: this.synapses.map(s => s.serialize()),
      neurons: this.neurons.map(n => ({
        id: n.id,
        spikeCount: n.spikeCount,
        fatigue: +n.fatigue.toFixed(4)
      }))
    };
  }

  /**
   * Load brain state from memory.json data
   */
  load(data) {
    if (!data || data.version < 2) return false;

    this.timestep = data.timestep || 0;
    this.taughtOnce = data.taughtOnce || false;
    if (data.stats) Object.assign(this.stats, data.stats);
    if (data.dopamineHistory) this.dopamineHistory = data.dopamineHistory;

    // Load synapse weights
    const synapseMap = {};
    for (const syn of this.synapses) synapseMap[syn.id] = syn;
    for (const saved of (data.synapses || [])) {
      if (synapseMap[saved.id]) {
        synapseMap[saved.id].loadWeight(saved.weight);
      }
    }

    return true;
  }

  /**
   * Reset the brain to a fresh state (keep topology, reset weights)
   */
  resetLearning() {
    this.timestep = 0;
    this.taughtOnce = false;
    this.dopamineLevel = 0;
    this.dopamineHistory = [];
    this.stats = { totalFires: 0, totalRewards: 0, totalPunishments: 0, avgDopamine: 0, decisions: [] };
    for (const n of this.neurons) n.reset();
    for (const s of this.synapses) {
      s.weight = 0.05 + Math.random() * 0.15;
      s.eligibilityTrace = 0;
    }
  }
}
