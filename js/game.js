/**
 * game.js - Survival Maze Game Logic
 *
 * A 10x10 grid-based game where the neural network controls an agent.
 * The agent must find food (reward) and avoid hazards (punishment).
 *
 * States:
 *   'idle'     - Waiting to start
 *   'teaching' - 1x demonstration phase
 *   'playing'  - Neural network in control
 *   'dead'     - Agent died (hit hazard), episode over
 */

export class Game {
  constructor(gridSize = 10) {
    this.gridSize = gridSize;
    this.cellSize = 48;

    this.state = 'idle';
    this.agent = { x: 1, y: 1 };
    this.food = [];
    this.hazards = [];
    this.prevDistToFood = Infinity;

    // Episode stats
    this.score = 0;
    this.episode = 0;
    this.steps = 0;
    this.maxSteps = 10000;
    this.foodEaten = 0;
    this.wallHits = 0;
    this.idleCount = 0;
    this.lastPos = { x: 1, y: 1 };

    // History
    this.episodeHistory = [];
    this.bestScore = 0;

    // Callbacks
    this.onReward = null;        // (amount, reason) => {}
    this.onEpisodeEnd = null;    // (stats) => {}
    this.onTeachStep = null;     // (action, pos) => {}

    this.reset();
  }

  // ─── Setup ────────────────────────────────────────────────────────────────

  reset() {
    this.state = 'idle';
    this.score = 0;
    this.steps = 0;
    this.foodEaten = 0;
    this.wallHits = 0;
    this.idleCount = 0;

    // Place agent at a random edge-safe position
    this.agent = {
      x: 1 + Math.floor(Math.random() * (this.gridSize - 2)),
      y: 1 + Math.floor(Math.random() * (this.gridSize - 2))
    };
    this.lastPos = { ...this.agent };
    this.prevDistToFood = Infinity;

    this._spawnFood(10);
    this._spawnHazards(4);
  }

  _spawnFood(count) {
    this.food = [];
    for (let i = 0; i < count; i++) {
      this.food.push(this._randomFreeCell());
    }
  }

  _spawnHazards(count) {
    this.hazards = [];
    for (let i = 0; i < count; i++) {
      this.hazards.push(this._randomFreeCell());
    }
  }

  _randomFreeCell() {
    let cell;
    do {
      cell = {
        x: 1 + Math.floor(Math.random() * (this.gridSize - 2)),
        y: 1 + Math.floor(Math.random() * (this.gridSize - 2))
      };
    } while (
      (cell.x === this.agent.x && cell.y === this.agent.y) ||
      this.food.some(f => f.x === cell.x && f.y === cell.y) ||
      this.hazards.some(h => h.x === cell.x && h.y === cell.y)
    );
    return cell;
  }

  // ─── Sensor Computation ───────────────────────────────────────────────────

  /**
   * Compute the 5 sensor values for the neural network.
   * Returns values normalized between 0 and 1.
   */
  getSensors() {
    const ax = this.agent.x, ay = this.agent.y;
    const maxDist = Math.sqrt(2) * this.gridSize;

    // Find nearest food
    let nearestFood = null;
    let minFoodDist = Infinity;
    for (const f of this.food) {
      const d = Math.hypot(f.x - ax, f.y - ay);
      if (d < minFoodDist) { minFoodDist = d; nearestFood = f; }
    }

    // 1. Normalized distance to nearest food (1 = far, 0 = close)
    const foodDist = nearestFood ? 1 - (minFoodDist / maxDist) : 0;

    // 2. Food angle: normalized to 0-1 (0.5 = straight ahead)
    const foodAngle = nearestFood
      ? ((Math.atan2(nearestFood.y - ay, nearestFood.x - ax) / Math.PI) + 1) / 2
      : 0.5;

    // 3. Danger vertical: is there a hazard directly above or below?
    const dangerV = this.hazards.some(h =>
      h.x === ax && Math.abs(h.y - ay) <= 1
    ) ? 1 : 0;

    // 4. Danger horizontal: is there a hazard directly left or right?
    const dangerH = this.hazards.some(h =>
      h.y === ay && Math.abs(h.x - ax) <= 1
    ) ? 1 : 0;

    // 5. Wall distance: how close to nearest wall (0 = touching, 1 = far)
    const wallDist = Math.min(ax, ay, this.gridSize - 1 - ax, this.gridSize - 1 - ay)
                     / (this.gridSize / 2);

    this.prevDistToFood = minFoodDist;

    return { foodDist, foodAngle, dangerV, dangerH, wallDist, _nearestFood: nearestFood, _foodDist: minFoodDist };
  }

  // ─── Step ─────────────────────────────────────────────────────────────────

  /**
   * Execute one action from the neural network.
   * Actions: 0=Up, 1=Down, 2=Left, 3=Right
   * Returns: reward amount (for dopamine signal)
   */
  step(action) {
    if (this.state === 'dead' || this.state === 'idle') return 0;

    this.steps++;
    this.lastPos = { ...this.agent };

    // Apply action
    const deltas = [[0,-1],[0,1],[-1,0],[1,0]];
    const d = action >= 0 && action < 4 ? deltas[action] : [0,0];

    const newX = this.agent.x + d[0];
    const newY = this.agent.y + d[1];

    let reward = 0;

    // --- Wall collision ---
    if (newX < 0 || newX >= this.gridSize || newY < 0 || newY >= this.gridSize) {
      this.wallHits++;
      reward = -0.2;
      if (this.onReward) this.onReward(reward, 'Wall hit');
      if (this.steps >= this.maxSteps) this._endEpisode();
      return reward;
    }

    this.agent.x = newX;
    this.agent.y = newY;

    // --- Hazard collision ---
    const hitHazard = this.hazards.find(h => h.x === newX && h.y === newY);
    if (hitHazard) {
      reward = -0.8;
      this.score += reward;
      if (this.onReward) this.onReward(reward, 'Hazard!');
      this._endEpisode();
      return reward;
    }

    // --- Food pickup ---
    const foodIdx = this.food.findIndex(f => f.x === newX && f.y === newY);
    if (foodIdx !== -1) {
      this.food.splice(foodIdx, 1);
      this.foodEaten++;
      reward = 1.0;
      this.score += reward;
      if (this.onReward) this.onReward(reward, 'Food!');

      // Respawn food
      if (this.food.length === 0) this._spawnFood(3);
      if (this.onReward) {} // already called
    } else {
      // --- Proximity reward ---
      const sensors = this.getSensors();
      const curDist = sensors._foodDist;

      if (curDist < this.prevDistToFood) {
        reward = 0.1;  // Moving toward food
      } else if (curDist > this.prevDistToFood) {
        reward = -0.05; // Moving away
      }

      this.prevDistToFood = curDist;
    }

    // --- Idle penalty ---
    if (this.agent.x === this.lastPos.x && this.agent.y === this.lastPos.y) {
      this.idleCount++;
      if (this.idleCount > 5) reward -= 0.1;
    } else {
      this.idleCount = 0;
    }

    this.score += reward;
    if (reward !== 0 && this.onReward) this.onReward(reward, reward > 0 ? 'Closer' : 'Farther');

    if (this.steps >= this.maxSteps) this._endEpisode();
    return reward;
  }

  _endEpisode() {
    this.state = 'dead';
    if (this.score > this.bestScore) this.bestScore = this.score;

    const stats = {
      episode: this.episode,
      score: this.score,
      steps: this.steps,
      foodEaten: this.foodEaten,
      wallHits: this.wallHits
    };
    this.episodeHistory.push(stats);

    if (this.onEpisodeEnd) this.onEpisodeEnd(stats);
  }

  startEpisode() {
    this.episode++;
    this.reset();
    this.state = 'playing';
  }

  // ─── Teaching Demo ─────────────────────────────────────────────────────────

  /**
   * Generate a teaching sequence of actions to guide agent toward food.
   * Returns an array of action indices.
   */
  generateTeachingSequence(maxSteps = 15) {
    const sequence = [];
    let pos = { ...this.agent };

    for (let s = 0; s < maxSteps; s++) {
      if (this.food.length === 0) break;

      // Greedy: find food, move toward it
      let nearestFood = null;
      let minDist = Infinity;
      for (const f of this.food) {
        const d = Math.abs(f.x - pos.x) + Math.abs(f.y - pos.y);
        if (d < minDist) { minDist = d; nearestFood = f; }
      }
      if (!nearestFood || minDist === 0) break;

      const dx = nearestFood.x - pos.x;
      const dy = nearestFood.y - pos.y;

      let action;
      if (Math.abs(dx) >= Math.abs(dy)) {
        action = dx > 0 ? 3 : 2; // Right or Left
      } else {
        action = dy > 0 ? 1 : 0; // Down or Up
      }

      sequence.push(action);
      const deltas = [[0,-1],[0,1],[-1,0],[1,0]];
      pos.x += deltas[action][0];
      pos.y += deltas[action][1];

      // Simulate food pickup
      const fi = this.food.findIndex(f => f.x === pos.x && f.y === pos.y);
      if (fi !== -1) {
        this.food.splice(fi, 1);
        break;
      }
    }

    return sequence;
  }

  // ─── Grid Access ──────────────────────────────────────────────────────────

  getCellType(x, y) {
    if (this.agent.x === x && this.agent.y === y) return 'agent';
    if (this.food.some(f => f.x === x && f.y === y)) return 'food';
    if (this.hazards.some(h => h.x === x && h.y === y)) return 'hazard';
    return 'empty';
  }
}
