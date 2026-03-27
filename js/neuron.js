/**
 * neuron.js - Biological Neuron Model
 * 
 * Implements a Leaky Integrate-and-Fire (LIF) neuron with biological properties:
 * - Membrane potential with resting state (-70mV)
 * - Action potential threshold (-55mV)
 * - Refractory period after firing
 * - Neurotransmitter depletion and recovery
 * - Neural fatigue from repeated firing
 * - Stochastic noise (biological randomness)
 */

export class Neuron {
  constructor(id, type, label) {
    this.id = id;
    this.type = type; // 'sensory', 'inter', 'motor', 'reward'
    this.label = label;

    // === Membrane Dynamics (mV) ===
    this.membranePotential = -70;   // Current voltage
    this.restingPotential = -70;    // Equilibrium voltage
    this.threshold = -55;           // Firing threshold
    this.resetPotential = -75;      // Post-fire hyperpolarization
    this.leakRate = 0.1;            // Leak conductance (return to rest)

    // === Refractory Period ===
    this.refractoryTime = 0;        // Remaining refractory ticks
    this.refractoryDuration = 3;    // Total refractory ticks

    // === Neurotransmitter System ===
    this.ntLevel = 1.0;             // Available neurotransmitter (0-1)
    this.ntRecovery = 0.03;         // Recovery rate per tick
    this.ntDepletion = 0.2;         // Depletion per fire

    // === Fatigue ===
    this.fatigue = 0;               // Current fatigue level (0-1)
    this.fatigueRecovery = 0.005;   // Recovery rate per tick
    this.fatigueRate = 0.03;        // Accumulation per fire

    // === State ===
    this.isFiring = false;
    this.lastSpikeTime = -1000;
    this.spikeCount = 0;
    this.activity = 0;              // Visual activity level (0-1)
    this.inputBuffer = 0;           // Accumulated input current

    // === Biological Noise ===
    this.noise = 0.3;               // Noise amplitude (mV)

    // === Connections ===
    this.axons = [];                // Outgoing synapses
    this.dendrites = [];            // Incoming synapses

    // === Visualization Position ===
    this.x = 0;
    this.y = 0;
  }

  /**
   * Inject current into this neuron (from synapse or external stimulus)
   * Respects refractory period and fatigue
   */
  injectCurrent(amount) {
    if (this.refractoryTime > 0) return;
    this.inputBuffer += amount * (1 - this.fatigue * 0.5);
  }

  /**
   * Update neuron state for one timestep
   * Returns true if the neuron fired
   */
  update(timestep) {
    // === Refractory Period ===
    if (this.refractoryTime > 0) {
      this.refractoryTime--;
      this.isFiring = false;
      // Gradually recover toward resting potential
      this.membranePotential += (this.restingPotential - this.membranePotential) * 0.3;
      this.activity *= 0.7;
      this.inputBuffer = 0;
      // Passive recovery
      this.ntLevel = Math.min(1, this.ntLevel + this.ntRecovery);
      this.fatigue = Math.max(0, this.fatigue - this.fatigueRecovery);
      return false;
    }

    // === Apply Accumulated Input ===
    this.membranePotential += this.inputBuffer;
    this.inputBuffer = 0;

    // === Biological Noise ===
    this.membranePotential += (Math.random() - 0.5) * this.noise;

    // === Leak Current (return toward resting) ===
    this.membranePotential += (this.restingPotential - this.membranePotential) * this.leakRate;

    // === Check Threshold ===
    if (this.membranePotential >= this.threshold && this.ntLevel > 0.1) {
      return this.fire(timestep);
    }

    // === No fire - passive recovery ===
    this.isFiring = false;
    this.activity *= 0.92;
    this.ntLevel = Math.min(1, this.ntLevel + this.ntRecovery);
    this.fatigue = Math.max(0, this.fatigue - this.fatigueRecovery);
    return false;
  }

  /**
   * Fire an action potential - transmit signal to all connected neurons
   */
  fire(timestep) {
    this.isFiring = true;
    this.lastSpikeTime = timestep;
    this.spikeCount++;
    this.activity = 1.0;

    // Hyperpolarization reset
    this.membranePotential = this.resetPotential;
    this.refractoryTime = this.refractoryDuration;

    // Neurotransmitter depletion
    this.ntLevel = Math.max(0, this.ntLevel - this.ntDepletion);

    // Fatigue accumulation
    this.fatigue = Math.min(1, this.fatigue + this.fatigueRate);

    // Propagate signal through all axonal synapses
    for (const synapse of this.axons) {
      synapse.queueSignal(this.ntLevel);
    }

    return true;
  }

  /**
   * Reset neuron to initial resting state
   */
  reset() {
    this.membranePotential = this.restingPotential;
    this.refractoryTime = 0;
    this.ntLevel = 1.0;
    this.fatigue = 0;
    this.isFiring = false;
    this.activity = 0;
    this.inputBuffer = 0;
    this.spikeCount = 0;
    this.lastSpikeTime = -1000;
  }

  /**
   * Get normalized membrane potential (0-1) for visualization
   */
  getNormalizedPotential() {
    const range = this.threshold - this.resetPotential;
    return Math.max(0, Math.min(1,
      (this.membranePotential - this.resetPotential) / range
    ));
  }
}
