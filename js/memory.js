/**
 * memory.js - Memory Persistence System
 *
 * Handles saving and loading of learned synaptic patterns to/from memory.json.
 * Since this runs in the browser, we use localStorage as the storage backend
 * (JSON file access requires a server; this simulates the same concept).
 *
 * Also maintains learning history and performance metrics.
 */

export class Memory {
  constructor(storageKey = 'neurosim_memory') {
    this.storageKey = storageKey;
    this.data = this._getDefault();
  }

  _getDefault() {
    return {
      version: 2,
      created: new Date().toISOString(),
      lastSaved: null,
      generations: 0,
      totalTimesteps: 0,
      totalExperience: 0,
      bestScore: 0,
      bestFoodEaten: 0,
      taughtOnce: false,
      synapses: [],
      neurons: [],
      learningHistory: [],    // [{episode, score, foodEaten, timestamp}]
      dopamineHistory: [],
      brainStats: {}
    };
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  /**
   * Save brain state to localStorage (simulates memory.json)
   */
  save(brainData, gameStats) {
    this.data.lastSaved = new Date().toISOString();
    this.data.generations = (this.data.generations || 0) + 1;
    this.data.totalTimesteps = brainData.timestep || 0;
    this.data.taughtOnce = brainData.taughtOnce || false;

    if (gameStats) {
      this.data.totalExperience = (this.data.totalExperience || 0) + (gameStats.steps || 0);
      if ((gameStats.score || 0) > (this.data.bestScore || 0)) {
        this.data.bestScore = gameStats.score;
      }
      if ((gameStats.foodEaten || 0) > (this.data.bestFoodEaten || 0)) {
        this.data.bestFoodEaten = gameStats.foodEaten;
      }

      // Keep last 100 episodes
      this.data.learningHistory.push({
        episode: gameStats.episode,
        score: +(gameStats.score || 0).toFixed(3),
        foodEaten: gameStats.foodEaten || 0,
        steps: gameStats.steps || 0,
        timestamp: Date.now()
      });
      if (this.data.learningHistory.length > 100) {
        this.data.learningHistory = this.data.learningHistory.slice(-100);
      }
    }

    this.data.synapses = brainData.synapses || [];
    this.data.neurons = brainData.neurons || [];
    this.data.dopamineHistory = brainData.dopamineHistory || [];
    this.data.brainStats = brainData.stats || {};

    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.data));
      return true;
    } catch (e) {
      console.warn('Memory save failed:', e);
      return false;
    }
  }

  /**
   * Load brain state from localStorage
   * Returns { found: bool, data: object }
   */
  load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return { found: false, data: this._getDefault() };

      const parsed = JSON.parse(raw);
      if (parsed.version < 2) return { found: false, data: this._getDefault() };

      this.data = parsed;
      return { found: true, data: parsed };
    } catch (e) {
      console.warn('Memory load failed:', e);
      return { found: false, data: this._getDefault() };
    }
  }

  /**
   * Export memory as downloadable JSON file (simulates memory.json file)
   */
  exportJSON() {
    const json = JSON.stringify(this.data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'memory.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Import memory from a JSON file
   */
  importJSON(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          this.data = data;
          localStorage.setItem(this.storageKey, JSON.stringify(data));
          resolve(data);
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsText(file);
    });
  }

  /**
   * Clear all saved memory
   */
  clear() {
    this.data = this._getDefault();
    localStorage.removeItem(this.storageKey);
  }

  // ─── Analytics ────────────────────────────────────────────────────────────

  /**
   * Compute learning trend from episode history
   * Returns average score improvement over last N episodes
   */
  getLearningTrend(windowSize = 10) {
    const hist = this.data.learningHistory;
    if (hist.length < windowSize * 2) return 0;

    const recent = hist.slice(-windowSize);
    const prev = hist.slice(-windowSize * 2, -windowSize);

    const avgRecent = recent.reduce((a, b) => a + b.score, 0) / recent.length;
    const avgPrev = prev.reduce((a, b) => a + b.score, 0) / prev.length;

    return avgRecent - avgPrev;
  }

  /**
   * Get statistics summary for display
   */
  getSummary() {
    return {
      generations: this.data.generations,
      totalExperience: this.data.totalExperience,
      bestScore: this.data.bestScore,
      bestFoodEaten: this.data.bestFoodEaten,
      taughtOnce: this.data.taughtOnce,
      episodesRecorded: this.data.learningHistory.length,
      lastSaved: this.data.lastSaved,
      trend: this.getLearningTrend()
    };
  }

  /**
   * Get the score data series for chart rendering
   */
  getScoreSeries() {
    return this.data.learningHistory.map(e => e.score);
  }
}
