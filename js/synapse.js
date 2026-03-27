/**
 * synapse.js - Synaptic Connection Model
 * 
 * Implements biological synaptic properties:
 * - Excitatory / Inhibitory connections
 * - Signal transmission delay
 * - Spike-Timing Dependent Plasticity (STDP)
 * - Dopamine-modulated reward learning
 * - Synaptic weight decay
 */

export class Synapse {
  constructor(preNeuron, postNeuron, options = {}) {
    this.pre = preNeuron;
    this.post = postNeuron;
    this.id = `${preNeuron.id}->${postNeuron.id}`;

    // Connection type: 'excitatory' (+) or 'inhibitory' (-)
    this.type = options.type || (Math.random() > 0.2 ? 'excitatory' : 'inhibitory');
    this.sign = this.type === 'excitatory' ? 1 : -1;

    // Synaptic strength (0.0 - 1.0)
    this.weight = options.weight !== undefined
      ? options.weight
      : 0.05 + Math.random() * 0.15;

    // Transmission delay in timesteps (mimics axon length)
    this.delay = options.delay !== undefined
      ? options.delay
      : Math.floor(1 + Math.random() * 4);

    // Signal queue: [{signal, remainingDelay}]
    this.signalQueue = [];

    // === STDP Parameters ===
    this.A_plus = 0.01;       // LTP magnitude
    this.A_minus = 0.012;     // LTD magnitude (slightly larger for stability)
    this.tau_plus = 20;       // LTP time window (ms/ticks)
    this.tau_minus = 20;      // LTD time window
    this.maxWeight = 1.0;
    this.minWeight = 0.001;

    // === Eligibility Trace (for reward-modulated STDP) ===
    this.eligibilityTrace = 0;  // Decaying trace of recent STDP
    this.traceDecay = 0.95;

    // === Weight Decay ===
    this.decayRate = 0.0001;    // Slow passive decay toward zero

    // === Stats ===
    this.totalTransmissions = 0;
    this.lastUpdateTime = 0;
  }

  /**
   * Queue a signal to be transmitted after delay ticks
   */
  queueSignal(ntLevel) {
    this.signalQueue.push({
      signal: this.weight * this.sign * ntLevel * 15, // 15mV scaling
      delay: this.delay
    });
  }

  /**
   * Process the signal queue each timestep
   * Returns the current that arrives at the post-synaptic neuron
   */
  tick(timestep) {
    let delivered = 0;
    const remaining = [];

    for (const item of this.signalQueue) {
      item.delay--;
      if (item.delay <= 0) {
        // Signal arrives
        this.post.injectCurrent(item.signal);
        delivered += item.signal;
        this.totalTransmissions++;

        // Update STDP eligibility trace using spike timing
        this._applySTDP(timestep);
      } else {
        remaining.push(item);
      }
    }

    this.signalQueue = remaining;

    // Decay eligibility trace
    this.eligibilityTrace *= this.traceDecay;

    // Passive weight decay
    this.weight = Math.max(this.minWeight, this.weight - this.decayRate);

    return delivered;
  }

  /**
   * Spike-Timing Dependent Plasticity
   * Hebbian rule: "Neurons that fire together, wire together"
   *
   * ΔW = A+ * exp(-Δt / τ+)  if pre fires before post (potentiation)
   * ΔW = -A- * exp(Δt / τ-)  if post fires before pre (depression)
   */
  _applySTDP(timestep) {
    const preSpikeTime = this.pre.lastSpikeTime;
    const postSpikeTime = this.post.lastSpikeTime;

    if (preSpikeTime < 0 && postSpikeTime < 0) return;

    const dt = preSpikeTime - postSpikeTime;
    let dw = 0;

    if (dt > 0 && dt < this.tau_plus * 3) {
      // Pre fired BEFORE post → causally linked → LTP (strengthen)
      dw = this.A_plus * Math.exp(-dt / this.tau_plus);
    } else if (dt < 0 && dt > -this.tau_minus * 3) {
      // Pre fired AFTER post → not causal → LTD (weaken)
      dw = -this.A_minus * Math.exp(dt / this.tau_minus);
    }

    // Store in eligibility trace (to be gated by reward signal)
    this.eligibilityTrace += dw;
    this.lastUpdateTime = timestep;
  }

  /**
   * Apply reward modulation (dopamine-like)
   * Eligibility trace × dopamine level determines final weight change
   * This is the key to "learning without labeled data"
   * 
   * @param {number} dopamine - Reward signal (-1 to +1)
   */
  applyRewardModulation(dopamine) {
    if (Math.abs(this.eligibilityTrace) < 0.0001) return;

    const dw = this.eligibilityTrace * dopamine * 0.1;
    this.weight = Math.max(this.minWeight,
                  Math.min(this.maxWeight, this.weight + dw));

    // Partially reset trace after modulation
    this.eligibilityTrace *= 0.3;
  }

  /**
   * Serialize synapse state for memory.json
   */
  serialize() {
    return {
      id: this.id,
      from: this.pre.id,
      to: this.post.id,
      weight: +this.weight.toFixed(6),
      type: this.type,
      delay: this.delay,
      totalTransmissions: this.totalTransmissions
    };
  }

  /**
   * Load weight from saved memory
   */
  loadWeight(weight) {
    this.weight = Math.max(this.minWeight, Math.min(this.maxWeight, weight));
  }
}
