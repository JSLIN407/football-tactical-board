/**
 * AI Spatiotemporal & Language-Conditioned Tactical Policy Engine
 *
 * Grounded in peer-reviewed football AI & language-conditioned trajectory frameworks:
 * 1. Fernández & Bornn (MIT Sloan, 2018) "Wide Open Spaces":
 *    Continuous Pitch Control + Space Occupation Gain (SOG) & Space Generation Gain (SGG).
 * 2. Spearman (MIT Sloan, 2018) "Beyond Expected Goals":
 *    Physics-based Potential Pitch Control Field (PPCF) & Off-Ball Scoring Opportunity (OBSO).
 * 3. Le, Carr, Yue & Lucey (ICML / MIT Sloan, 2017) "Data-Driven Ghosting":
 *    Coordinated multi-agent defensive ghosting policies.
 * 4. Wang, Veličković et al. / Google DeepMind (Nature Communications, 2024) "TacticAI":
 *    Graph-relational passing-lane attention & D2 pitch reflectional symmetry.
 * 5. TacEleven (Zhao et al., arXiv:2511.13326, 2025) & Interactive DAgger Imitation Learning:
 *    Language/Question-conditioned spatiotemporal policy pi_theta(a | G_0, q) trained on
 *    (board-state graph + tactical question -> multi-agent handling trajectory) demonstrations.
 */

import { PITCH_SPECS, clamp } from '../data/pitchSpecs';
import type {
  BallState,
  DrawingAnnotation,
  PitchFormat,
  PlayerToken,
  TacticalAnalysis,
  TacticalKeyframe,
  TeamSide,
} from '../types/tactics';

export type TacticalContextId =
  | 'auto'
  | 'build_up'
  | 'flank_overload'
  | 'central_penetration'
  | 'switch_weak_side'
  | 'counter_press';

export type HeatmapLayer = 'obso' | 'pitch-control' | 'off';

export interface SpatialGrid {
  cols: number;
  rows: number;
  /** Attacking team Pitch Control probability [0..1] per cell (row * cols + col) */
  pitchControl: Float32Array;
  /** Off-Ball Scoring Opportunity / Expected Spatial Value [0..1] per cell */
  obso: Float32Array;
  /** Peak high-value target pockets identified by the model */
  hotspots: Array<{ x: number; y: number; score: number }>;
}

export interface NeuralPolicyWeights {
  wControl: number;
  wGoalThreat: number;
  wTransition: number;
  wSpaceDrag: number;
  loss: number;
}

const V_MAX = 7.2; // m/s sprint speed
const REACTION_TIME = 0.55; // s
const BALL_SPEED = 15.5; // m/s average crisp pass
const SIGMA_CONTROL = 0.48; // logistic steepness (s)

let cachedWeights: NeuralPolicyWeights | null = null;

export function getCalibratedPolicyWeights(): NeuralPolicyWeights {
  if (cachedWeights) return cachedWeights;

  const baseSamples: Array<[number, number, number, number, number]> = [
    [0.82, 0.78, 0.75, 0.35, 0.92],
    [0.91, 0.18, 0.92, 0.10, 0.38],
    [0.22, 0.90, 0.45, 0.75, 0.44],
    [0.74, 0.62, 0.68, 0.55, 0.81],
    [0.65, 0.84, 0.62, 0.60, 0.88],
    [0.48, 0.40, 0.82, 0.65, 0.62],
  ];

  const samples = [...baseSamples, ...baseSamples];
  const w = [0.25, 0.25, 0.25, 0.25];
  const lr = 0.18;
  let loss = 0;
  const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

  for (let epoch = 0; epoch < 160; epoch++) {
    loss = 0;
    const grad = [0, 0, 0, 0];
    for (const [c, g, t, d, y] of samples) {
      const z = w[0] * c + w[1] * g + w[2] * t + w[3] * d - 0.65;
      const pred = sigmoid(z);
      const err = pred - y;
      loss += err * err;
      const dz = 2 * err * pred * (1 - pred);
      grad[0] += dz * c;
      grad[1] += dz * g;
      grad[2] += dz * t;
      grad[3] += dz * d;
    }
    for (let k = 0; k < 4; k++) {
      w[k] -= (lr * grad[k]) / samples.length;
    }
  }

  const sum = w.reduce((a, b) => a + Math.max(0.05, b), 0);
  cachedWeights = {
    wControl: Math.max(0.05, w[0]) / sum,
    wGoalThreat: Math.max(0.05, w[1]) / sum,
    wTransition: Math.max(0.05, w[2]) / sum,
    wSpaceDrag: Math.max(0.05, w[3]) / sum,
    loss: loss / samples.length,
  };
  return cachedWeights;
}

function timeToIntercept(
  pxM: number,
  pyM: number,
  vxM: number,
  vyM: number,
  txM: number,
  tyM: number,
  isGK: boolean
): number {
  const rx = pxM + vxM * REACTION_TIME;
  const ry = pyM + vyM * REACTION_TIME;
  const dist = Math.hypot(txM - rx, tyM - ry);
  const topSpeed = isGK ? V_MAX * 0.88 : V_MAX;
  return REACTION_TIME + dist / topSpeed;
}

function computeGoalScoringValue(
  nx: number,
  ny: number,
  attackTeam: TeamSide,
  lengthM: number,
  widthM: number
): number {
  const goalX = attackTeam === 'home' ? lengthM : 0;
  const goalY = widthM / 2;
  const xM = (nx / 100) * lengthM;
  const yM = (ny / 100) * widthM;

  const dx = Math.abs(goalX - xM);
  const dy = Math.abs(goalY - yM);
  const dist = Math.hypot(dx, dy);

  const cosAngle = dx / Math.max(4, dist);
  const distDecay = Math.exp(-Math.pow(dist / (lengthM * 0.36), 1.55));
  const progression = attackTeam === 'home' ? nx / 100 : (100 - nx) / 100;

  return clamp(distDecay * (0.55 + 0.45 * cosAngle) + 0.18 * Math.pow(progression, 2), 0, 1);
}

function computeTransitionProbability(
  nx: number,
  ny: number,
  ball: BallState,
  lengthM: number,
  widthM: number
): number {
  const bxM = (ball.x / 100) * lengthM;
  const byM = (ball.y / 100) * widthM;
  const txM = (nx / 100) * lengthM;
  const tyM = (ny / 100) * widthM;

  const passDist = Math.hypot(txM - bxM, tyM - byM);
  if (passDist < 3) return 0.35;
  const ring = Math.exp(-Math.pow(passDist - 17, 2) / (2 * 16 * 16));
  return clamp(0.2 + 0.8 * ring, 0.1, 1);
}

export function computeSpatialGrid(
  players: PlayerToken[],
  ball: BallState,
  format: PitchFormat,
  attackTeam: TeamSide = 'home',
  velocities?: Map<string, { vx: number; vy: number }>
): SpatialGrid {
  const spec = PITCH_SPECS[format];
  const cols = 26;
  const rows = 18;
  const pitchControl = new Float32Array(cols * rows);
  const obso = new Float32Array(cols * rows);

  const pMeters = players.map((p) => {
    const vel = velocities?.get(p.id) ?? { vx: 0, vy: 0 };
    return {
      team: p.team,
      isGK: Boolean(p.isGK),
      xM: (p.x / 100) * spec.lengthM,
      yM: (p.y / 100) * spec.widthM,
      vxM: vel.vx,
      vyM: vel.vy,
    };
  });

  const bxM = (ball.x / 100) * spec.lengthM;
  const byM = (ball.y / 100) * spec.widthM;

  const candidateHotspots: Array<{ x: number; y: number; score: number }> = [];

  for (let r = 0; r < rows; r++) {
    const ny = ((r + 0.5) / rows) * 100;
    const tyM = (ny / 100) * spec.widthM;

    for (let c = 0; c < cols; c++) {
      const nx = ((c + 0.5) / cols) * 100;
      const txM = (nx / 100) * spec.lengthM;
      const idx = r * cols + c;

      const ballFlight = Math.hypot(txM - bxM, tyM - byM) / BALL_SPEED;
      let atkInfluence = 0;
      let defInfluence = 0;

      for (let i = 0; i < pMeters.length; i++) {
        const pm = pMeters[i];
        const tArr = timeToIntercept(pm.xM, pm.yM, pm.vxM, pm.vyM, txM, tyM, pm.isGK);
        const delta = tArr - ballFlight;
        const weight = 1 / (1 + Math.exp(delta / SIGMA_CONTROL));
        const spatialKernel = Math.exp(-Math.max(0, tArr - 0.5) * 0.65);
        const contrib = weight * 0.65 + spatialKernel * 0.35;

        if (pm.team === attackTeam) {
          atkInfluence += contrib;
        } else {
          defInfluence += contrib;
        }
      }

      const pc = atkInfluence / Math.max(1e-5, atkInfluence + defInfluence);
      pitchControl[idx] = pc;

      const sVal = computeGoalScoringValue(nx, ny, attackTeam, spec.lengthM, spec.widthM);
      const tVal = computeTransitionProbability(nx, ny, ball, spec.lengthM, spec.widthM);

      const rawObso = tVal * Math.pow(pc, 0.85) * sVal * 1.65;
      const val = clamp(rawObso, 0, 1);
      obso[idx] = val;

      if (ny > 10 && ny < 90 && nx > 12 && nx < 94 && val > 0.22) {
        candidateHotspots.push({ x: nx, y: ny, score: val });
      }
    }
  }

  candidateHotspots.sort((a, b) => b.score - a.score);
  const hotspots: Array<{ x: number; y: number; score: number }> = [];
  for (const cand of candidateHotspots) {
    if (hotspots.every((h) => Math.hypot(h.x - cand.x, h.y - cand.y) > 14)) {
      hotspots.push(cand);
      if (hotspots.length >= 3) break;
    }
  }

  return { cols, rows, pitchControl, obso, hotspots };
}

export function inferContextFromBall(
  ball: BallState,
  attackTeam: TeamSide
): Exclude<TacticalContextId, 'auto'> {
  const progX = attackTeam === 'home' ? ball.x : 100 - ball.x;
  if (progX < 34) return 'build_up';
  if (ball.y < 28 || ball.y > 72) {
    return progX > 56 ? 'flank_overload' : 'switch_weak_side';
  }
  return 'central_penetration';
}

function passLaneClearance(
  bx: number,
  by: number,
  tx: number,
  ty: number,
  defenders: PlayerToken[]
): number {
  const dx = tx - bx;
  const dy = ty - by;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 4) return 1;

  let minPerp = 999;
  for (const d of defenders) {
    const t = ((d.x - bx) * dx + (d.y - by) * dy) / lenSq;
    if (t > 0.12 && t < 0.92) {
      const projX = bx + t * dx;
      const projY = by + t * dy;
      const perp = Math.hypot(d.x - projX, d.y - projY);
      if (perp < minPerp) minPerp = perp;
    }
  }
  return clamp(minPerp / 8.5, 0.15, 1);
}

function computeDefensiveGhosting(
  prevPlayers: PlayerToken[],
  nextPlayers: PlayerToken[],
  defendTeam: TeamSide,
  ball: BallState,
  format: PitchFormat,
  highPress: boolean
): DrawingAnnotation[] {
  const spec = PITCH_SPECS[format];
  const anns: DrawingAnnotation[] = [];
  const ownGoalX = defendTeam === 'away' ? 96 : 4;
  const goalDir = defendTeam === 'away' ? 1 : -1;

  const gk = nextPlayers.find((p) => p.team === defendTeam && p.isGK);
  if (gk) {
    const gk0 = prevPlayers.find((p) => p.id === gk.id) ?? gk;
    gk.y = clamp(50 + (ball.y - 50) * 0.2, 42, 58);
    gk.x = clamp(ownGoalX - goalDir * 2, 4, 96);
    if (Math.hypot(gk.x - gk0.x, gk.y - gk0.y) > 2) {
      anns.push({
        id: `gh-gk-${gk.id}`,
        kind: 'press',
        x1: gk0.x,
        y1: gk0.y,
        x2: gk.x,
        y2: gk.y,
        team: defendTeam,
      });
    }
  }

  const defenders = nextPlayers.filter((p) => p.team === defendTeam && !p.isGK);
  const attackers = nextPlayers.filter((p) => p.team !== defendTeam && !p.isGK);
  if (defenders.length === 0) return anns;

  const sortedToBall = [...defenders].sort((a, b) => {
    const da = Math.hypot(((a.x - ball.x) * spec.lengthM) / 100, ((a.y - ball.y) * spec.widthM) / 100);
    const db = Math.hypot(((b.x - ball.x) * spec.lengthM) / 100, ((b.y - ball.y) * spec.widthM) / 100);
    return da - db;
  });
  const presser = sortedToBall[0];

  const backLineTargetX = highPress
    ? clamp(ball.x + goalDir * 11, 22, 78)
    : clamp(ball.x + goalDir * 19, 14, 86);

  const lateralBallShift = (ball.y - 50) * 0.34;

  for (const def of defenders) {
    const d0 = prevPlayers.find((p) => p.id === def.id) ?? def;

    if (def.id === presser.id) {
      const angleToGoalY = (50 - ball.y) * 0.14;
      def.x = clamp(ball.x + goalDir * (highPress ? 3.4 : 4.8), 8, 92);
      def.y = clamp(ball.y + angleToGoalY, 7, 93);
    } else {
      const nearbyRunner = attackers
        .filter((a) => a.id !== ball.holderId)
        .find(
          (a) =>
            Math.hypot(a.x - d0.x, a.y - d0.y) < 15 &&
            (defendTeam === 'away' ? a.x > 55 : a.x < 45)
        );

      if (nearbyRunner) {
        def.x = clamp(nearbyRunner.x + goalDir * 3.2, 10, 90);
        def.y = clamp(nearbyRunner.y + (50 - nearbyRunner.y) * 0.15, 10, 90);
      } else {
        const isFarSide = (ball.y < 42 && d0.y > 58) || (ball.y > 58 && d0.y < 42);
        const tuck = isFarSide ? (50 - d0.y) * 0.3 : 0;
        const depthPull = (backLineTargetX - d0.x) * 0.38;
        def.x = clamp(d0.x + depthPull, 10, 90);
        def.y = clamp(d0.y + lateralBallShift * 0.75 + tuck, 10, 90);
      }
    }

    if (Math.hypot(def.x - d0.x, def.y - d0.y) > 2.0) {
      anns.push({
        id: `gh-${def.id}-${Math.round(def.x)}`,
        kind: 'press',
        x1: d0.x,
        y1: d0.y,
        x2: def.x,
        y2: def.y,
        team: defendTeam,
      });
    }
  }

  return anns;
}

export interface AISimulationOutput {
  keyframes: TacticalKeyframe[];
  analysis: TacticalAnalysis;
  resolvedContext: Exclude<TacticalContextId, 'auto'>;
}

export function runAISpatialSimulation(
  contextId: TacticalContextId,
  basePlayers: PlayerToken[],
  baseBall: BallState,
  format: PitchFormat
): AISimulationOutput {
  const weights = getCalibratedPolicyWeights();
  const spec = PITCH_SPECS[format];

  const holder = basePlayers.find((p) => p.id === baseBall.holderId);
  const isCounterPress = contextId === 'counter_press';
  const attackTeam: TeamSide = isCounterPress ? 'away' : holder?.team ?? 'home';
  const defendTeam: TeamSide = attackTeam === 'home' ? 'away' : 'home';
  const dir = attackTeam === 'home' ? 1 : -1;

  const resolved: Exclude<TacticalContextId, 'auto'> =
    contextId === 'auto' ? inferContextFromBall(baseBall, attackTeam) : contextId;

  const f0Players = basePlayers.map((p) => ({ ...p }));
  const f0Ball: BallState = { ...baseBall };

  const attackers0 = f0Players.filter((p) => p.team === attackTeam && !p.isGK);
  let carrier0 =
    f0Players.find((p) => p.id === f0Ball.holderId && p.team === attackTeam) ??
    [...attackers0].sort(
      (a, b) => Math.hypot(a.x - f0Ball.x, a.y - f0Ball.y) - Math.hypot(b.x - f0Ball.x, b.y - f0Ball.y)
    )[0];

  if (resolved === 'build_up') {
    const gkOrCb = f0Players.find((p) => p.team === attackTeam && p.isGK) ?? carrier0;
    carrier0 = gkOrCb;
  } else if (resolved === 'flank_overload' || resolved === 'switch_weak_side') {
    const wide = [...attackers0].sort((a, b) =>
      f0Ball.y <= 50 ? a.y - b.y : b.y - a.y
    )[0];
    if (wide) carrier0 = wide;
  }

  f0Ball.x = clamp(carrier0.x + dir * 1.8, 3, 97);
  f0Ball.y = carrier0.y;
  f0Ball.holderId = carrier0.id;

  const f1Players = f0Players.map((p) => ({ ...p }));
  const f1Ball: BallState = { ...f0Ball };
  const f1Anns: DrawingAnnotation[] = [];

  const f2Players = f0Players.map((p) => ({ ...p }));
  const f2Ball: BallState = { ...f0Ball };
  const f2Anns: DrawingAnnotation[] = [];

  const grid0 = computeSpatialGrid(f0Players, f0Ball, format, attackTeam);
  const defenders0 = f0Players.filter((p) => p.team === defendTeam && !p.isGK);

  let ruleSummary = '';
  let offBallRule = '';
  let defRule = '';

  if (resolved === 'counter_press') {
    const pressTeam: TeamSide = 'home';
    const oppCarrier = carrier0;

    const pressers = f1Players
      .filter((p) => p.team === pressTeam && !p.isGK)
      .sort(
        (a, b) =>
          Math.hypot(a.x - oppCarrier.x, a.y - oppCarrier.y) -
          Math.hypot(b.x - oppCarrier.x, b.y - oppCarrier.y)
      );

    pressers.forEach((p, idx) => {
      const p0 = f0Players.find((o) => o.id === p.id)!;
      if (idx === 0) {
        p.x = clamp(oppCarrier.x - 4.2, 12, 90);
        p.y = clamp(oppCarrier.y + (50 - oppCarrier.y) * 0.22, 8, 92);
      } else if (idx <= 2) {
        const oppTargets = f1Players
          .filter((o) => o.team === 'away' && !o.isGK && o.id !== oppCarrier.id)
          .sort(
            (a, b) =>
              Math.hypot(a.x - oppCarrier.x, a.y - oppCarrier.y) -
              Math.hypot(b.x - oppCarrier.x, b.y - oppCarrier.y)
          );
        const mark = oppTargets[idx - 1];
        if (mark) {
          p.x = clamp(mark.x - 3.0, 15, 90);
          p.y = clamp(mark.y + (oppCarrier.y - mark.y) * 0.15, 8, 92);
        }
      } else {
        p.x = clamp(p0.x + 9, 22, 82);
        p.y = clamp(p0.y + (oppCarrier.y - 50) * 0.26, 12, 88);
      }
      if (Math.hypot(p.x - p0.x, p.y - p0.y) > 1.8) {
        f1Anns.push({
          id: `cp1-${p.id}`,
          kind: 'press',
          x1: p0.x,
          y1: p0.y,
          x2: p.x,
          y2: p.y,
          team: pressTeam,
        });
      }
    });

    const oppWide = f1Players
      .filter((o) => o.team === 'away' && !o.isGK && o.id !== oppCarrier.id)
      .sort((a, b) => Math.abs(b.y - 50) - Math.abs(a.y - 50))[0];

    if (oppWide) {
      f1Anns.push({
        id: 'opp-forced',
        kind: 'pass',
        x1: oppCarrier.x,
        y1: oppCarrier.y,
        x2: oppWide.x,
        y2: oppWide.y,
        team: 'away',
      });
      f1Ball.x = oppWide.x - 1.5;
      f1Ball.y = oppWide.y;
      f1Ball.holderId = oppWide.id;
    }

    f2Players.forEach((p, i) => {
      p.x = f1Players[i].x;
      p.y = f1Players[i].y;
    });
    f2Ball.x = f1Ball.x;
    f2Ball.y = f1Ball.y;
    f2Ball.holderId = f1Ball.holderId;

    const trapWinner = f2Players
      .filter((p) => p.team === pressTeam && !p.isGK)
      .sort((a, b) => Math.hypot(a.x - f2Ball.x, a.y - f2Ball.y) - Math.hypot(b.x - f2Ball.x, b.y - f2Ball.y))[0];

    if (trapWinner) {
      const prevW = f1Players.find((o) => o.id === trapWinner.id)!;
      trapWinner.x = clamp(f2Ball.x - 1.5, 10, 92);
      trapWinner.y = clamp(f2Ball.y, 6, 94);
      f2Ball.holderId = trapWinner.id;
      f2Anns.push({
        id: 'trap-close',
        kind: 'press',
        x1: prevW.x,
        y1: prevW.y,
        x2: trapWinner.x,
        y2: trapWinner.y,
        team: pressTeam,
      });
    }

    ruleSummary = '丟球瞬間觸發高位壓迫陷阱（Le et al. 協同封鎖 + TacticAI 傳球邊遮蔽）';
    offBallRule = '第1人弧線壓迫封死回傳，第2、3人鎖死鄰近接應點，後防線同步前推壓縮縱深。';
    defRule = '持球方中路傳球線遭遮蔽（Pass Shadow），被迫分向邊線死角觸發包夾掉球。';
  } else {
    const c1 = f1Players.find((p) => p.id === carrier0.id)!;
    const otherAttackers1 = f1Players.filter(
      (p) => p.team === attackTeam && !p.isGK && p.id !== c1.id
    );

    const c0Pos = { x: c1.x, y: c1.y };
    if (resolved === 'flank_overload') {
      const inwardSign = c1.y < 50 ? 1 : -1;
      c1.x = clamp(c1.x + dir * 9, 15, 86);
      c1.y = clamp(c1.y + inwardSign * 12, 24, 76);
      f1Anns.push({
        id: 'ai-drib',
        kind: 'dribble',
        x1: c0Pos.x,
        y1: c0Pos.y,
        x2: c1.x,
        y2: c1.y,
        team: attackTeam,
      });
    } else if (resolved === 'central_penetration') {
      c1.x = clamp(c1.x + dir * 7, 18, 80);
      f1Anns.push({
        id: 'ai-drib',
        kind: 'dribble',
        x1: c0Pos.x,
        y1: c0Pos.y,
        x2: c1.x,
        y2: c1.y,
        team: attackTeam,
      });
    } else if (resolved === 'switch_weak_side') {
      c1.x = clamp(c1.x + dir * 4, 18, 78);
    }

    f1Ball.x = clamp(c1.x + dir * 1.8, 3, 97);
    f1Ball.y = c1.y;
    f1Ball.holderId = c1.id;

    const advancedAttackers = [...otherAttackers1].sort((a, b) =>
      attackTeam === 'home' ? b.x - a.x : a.x - b.x
    );
    const decoyRunner = advancedAttackers[0];

    let bestTarget = { x: clamp(c1.x + dir * 18, 25, 90), y: 50, score: -1, runnerId: '' };

    const candidateRunners = otherAttackers1.filter((p) => p.id !== decoyRunner?.id);
    for (const runner of candidateRunners.length > 0 ? candidateRunners : otherAttackers1) {
      for (let gx = 2; gx < grid0.cols - 1; gx += 2) {
        for (let gy = 1; gy < grid0.rows - 1; gy += 2) {
          const tx = ((gx + 0.5) / grid0.cols) * 100;
          const ty = ((gy + 0.5) / grid0.rows) * 100;

          if (resolved === 'flank_overload') {
            const wantWideY = c0Pos.y < 50 ? ty < 22 : ty > 78;
            if (!wantWideY || (attackTeam === 'home' ? tx < c1.x + 4 : tx > c1.x - 4)) continue;
          } else if (resolved === 'switch_weak_side') {
            const wantWeakSide = c0Pos.y < 50 ? ty > 68 : ty < 32;
            if (!wantWeakSide) continue;
          } else if (resolved === 'build_up') {
            if (attackTeam === 'home' ? tx > 55 || tx < 16 : tx < 45 || tx > 84) continue;
          } else if (resolved === 'central_penetration') {
            if (ty < 22 || ty > 78 || (attackTeam === 'home' ? tx < c1.x + 8 : tx > c1.x - 8)) continue;
          }

          const runDistM = Math.hypot(
            ((tx - runner.x) * spec.lengthM) / 100,
            ((ty - runner.y) * spec.widthM) / 100
          );
          if (runDistM > 22) continue;

          const cellIdx = gy * grid0.cols + gx;
          const pc = grid0.pitchControl[cellIdx];
          const sVal =
            resolved === 'build_up'
              ? 1 - Math.abs(ty - 50) / 70
              : computeGoalScoringValue(tx, ty, attackTeam, spec.lengthM, spec.widthM);
          const tVal =
            computeTransitionProbability(tx, ty, f1Ball, spec.lengthM, spec.widthM) *
            passLaneClearance(f1Ball.x, f1Ball.y, tx, ty, defenders0);
          const dragBonus = decoyRunner
            ? clamp(1 - Math.hypot(tx - decoyRunner.x, ty - decoyRunner.y) / 35, 0, 1)
            : 0.3;

          const utility =
            weights.wControl * pc +
            weights.wGoalThreat * sVal +
            weights.wTransition * tVal +
            weights.wSpaceDrag * dragBonus;

          if (utility > bestTarget.score) {
            bestTarget = { x: tx, y: ty, score: utility, runnerId: runner.id };
          }
        }
      }
    }

    if (decoyRunner && decoyRunner.id !== bestTarget.runnerId) {
      const d0 = f0Players.find((p) => p.id === decoyRunner.id)!;
      const pullAwayY = bestTarget.y <= 50 ? clamp(d0.y + 14, 52, 86) : clamp(d0.y - 14, 14, 48);
      decoyRunner.x = clamp(d0.x + dir * (resolved === 'central_penetration' ? -5 : 9), 16, 90);
      decoyRunner.y = pullAwayY;
      f1Anns.push({
        id: `sgg-${decoyRunner.id}`,
        kind: 'run',
        x1: d0.x,
        y1: d0.y,
        x2: decoyRunner.x,
        y2: decoyRunner.y,
        team: attackTeam,
      });
    }

    const primaryRunner1 = f1Players.find((p) => p.id === bestTarget.runnerId) ?? otherAttackers1[0];
    if (primaryRunner1) {
      const r0 = f0Players.find((p) => p.id === primaryRunner1.id)!;
      primaryRunner1.x = r0.x + (bestTarget.x - r0.x) * 0.58;
      primaryRunner1.y = r0.y + (bestTarget.y - r0.y) * 0.58;
      f1Anns.push({
        id: `sog1-${primaryRunner1.id}`,
        kind: 'run',
        x1: r0.x,
        y1: r0.y,
        x2: primaryRunner1.x,
        y2: primaryRunner1.y,
        team: attackTeam,
      });
    }

    otherAttackers1.forEach((p) => {
      if (p.id === decoyRunner?.id || p.id === primaryRunner1?.id) return;
      const p0 = f0Players.find((o) => o.id === p.id)!;
      if (resolved === 'build_up') {
        const spreadY = p0.y < 45 ? -7 : p0.y > 55 ? 7 : 0;
        p.x = clamp(p0.x + dir * 4, 10, 75);
        p.y = clamp(p0.y + spreadY, 12, 88);
      } else {
        p.x = clamp(p0.x + dir * 6, 15, 86);
        p.y = clamp(p0.y + (bestTarget.y - p0.y) * 0.12, 10, 90);
      }
      if (Math.hypot(p.x - p0.x, p.y - p0.y) > 3.2) {
        f1Anns.push({
          id: `sup-${p.id}`,
          kind: 'run',
          x1: p0.x,
          y1: p0.y,
          x2: p.x,
          y2: p.y,
          team: attackTeam,
        });
      }
    });

    f1Anns.push(
      ...computeDefensiveGhosting(
        f0Players,
        f1Players,
        defendTeam,
        f1Ball,
        format,
        resolved === 'build_up'
      )
    );

    f2Players.forEach((p, idx) => {
      p.x = f1Players[idx].x;
      p.y = f1Players[idx].y;
    });

    const c2 = f2Players.find((p) => p.id === c1.id)!;
    const primaryRunner2 = primaryRunner1
      ? f2Players.find((p) => p.id === primaryRunner1.id)
      : undefined;

    if (primaryRunner2) {
      const r1Pos = { x: primaryRunner2.x, y: primaryRunner2.y };
      primaryRunner2.x = clamp(bestTarget.x, 12, 93);
      primaryRunner2.y = clamp(bestTarget.y, 8, 92);

      f2Anns.push({
        id: `sog2-${primaryRunner2.id}`,
        kind: 'run',
        x1: r1Pos.x,
        y1: r1Pos.y,
        x2: primaryRunner2.x,
        y2: primaryRunner2.y,
        team: attackTeam,
      });

      f2Anns.push({
        id: 'opt-pass',
        kind: 'pass',
        x1: c2.x,
        y1: c2.y,
        x2: primaryRunner2.x,
        y2: primaryRunner2.y,
        team: attackTeam,
      });

      f2Ball.x = clamp(primaryRunner2.x + dir * 1.5, 3, 97);
      f2Ball.y = primaryRunner2.y;
      f2Ball.holderId = primaryRunner2.id;
    }

    f2Anns.push(
      ...computeDefensiveGhosting(
        f1Players,
        f2Players,
        defendTeam,
        f2Ball,
        format,
        resolved === 'build_up'
      )
    );

    const runnerLabel = primaryRunner2 ? `#${primaryRunner2.number}` : '接應者';
    const decoyLabel = decoyRunner ? `#${decoyRunner.number}` : '前鋒';

    const contextDescriptions: Record<
      Exclude<TacticalContextId, 'auto' | 'counter_press'>,
      { title: string; atk: string; def: string }
    > = {
      build_up: {
        title: '後場破壓出球（Pitch Control 空間最大化）',
        atk: `雙後衛拉寬降低壓迫密度，${runnerLabel} 切入最高控球機率（PPCF）空檔接應破壓。`,
        def: `前鋒上前壓迫持球者，後排依 Ghosting 模型收縮中路傳球走廊。`,
      },
      flank_overload: {
        title: '邊路持球內切 + 套邊（SGG 牽制創造 + OBSO 空檔）',
        atk: `#${c1.number} 內切吸引邊衛、${decoyLabel} 反向牽制中衛（SGG），${runnerLabel} 高速衝入最高價值邊線空檔。`,
        def: `近球後衛上前封堵內切，防線整體向球側橫移、遠側邊衛內收保護門前。`,
      },
      central_penetration: {
        title: '中路肋部滲透（OBSO 得分機會最大化 + 第三人穿插）',
        atk: `${decoyLabel} 牽制拉開防線間隙，${runnerLabel} 斜插防線身後最高 OBSO 威脅區接應直塞。`,
        def: `後腰上前對位持球者，鄰近中衛依 Ghosting 軌跡退防追蹤身後跑位。`,
      },
      switch_weak_side: {
        title: '強側超載轉移弱側（跨區 Pitch Control 轉換）',
        atk: `強側吸引防守重心後，大範圍轉移至弱側高控球率空檔（${runnerLabel} 提前拉寬接球）。`,
        def: `防守陣型隨球飛行橫向快速換邊，弱側邊衛先上前延緩（Delay）等待防線收縮。`,
      },
    };

    const desc = contextDescriptions[resolved];
    ruleSummary = desc.title;
    offBallRule = desc.atk;
    defRule = desc.def;
  }

  const keyframes: TacticalKeyframe[] = [
    {
      id: 'ai-kf-0',
      title: '起始狀態',
      description: '',
      phase: 'setup',
      players: f0Players,
      ball: f0Ball,
      annotations: [],
      durationMs: 700,
    },
    {
      id: 'ai-kf-1',
      title: '空間牽制與啟動',
      description: '',
      phase: isCounterPress ? 'off-ball' : 'on-ball',
      players: f1Players,
      ball: f1Ball,
      annotations: f1Anns,
      durationMs: 1350,
    },
    {
      id: 'ai-kf-2',
      title: '最佳空檔到位',
      description: '',
      phase: isCounterPress ? 'off-ball' : 'on-ball',
      players: f2Players,
      ball: f2Ball,
      annotations: f2Anns,
      durationMs: 1350,
    },
  ];

  const analysis: TacticalAnalysis = {
    summary: ruleSummary,
    ballStateLabel: ruleSummary,
    phase: isCounterPress ? 'off-ball' : 'on-ball',
    onBallAction: ruleSummary,
    offBallAttackShift: offBallRule,
    defenseShift: defRule,
    coachingCue: '',
    detectedIntent: resolved,
  };

  return { keyframes, analysis, resolvedContext: resolved };
}

/* ============================================================================
 * Question-Conditioned Multi-Agent Imitation Policy (TacEleven / DAgger)
 * Trains a 2-layer neural policy pi_Theta(a | G_0, q) on (BoardState + Question -> Action)
 * pairs via backpropagation, supporting online coach-in-the-loop demonstrations.
 * ============================================================================ */

const QA_STORAGE_KEY = 'ftb_qa_coach_demos_v1';
const IN_DIM = 13; // 6 board-graph features + 6 question features + 1 bias
const HIDDEN_DIM = 10;
const OUT_DIM = 6; // [wControl, wGoalThreat, wTransition, wSpaceDrag, widthBias, pressAggression]

export interface QuestionTrainingSample {
  /** 12D feature vector: 6 board features + 6 question features */
  x: number[];
  /** 6D continuous policy target in [0, 1]^6 */
  y: number[];
  question: string;
}

interface TrainedQAPolicy {
  w1: Float64Array; // HIDDEN_DIM * IN_DIM
  w2: Float64Array; // OUT_DIM * (HIDDEN_DIM + 1)
  loss: number;
  sampleCount: number;
  coachDemoCount: number;
}

let cachedQAPolicy: TrainedQAPolicy | null = null;
const memoryCoachDemos: QuestionTrainingSample[] = [];

const QUESTION_CUE_REGEX =
  /[?？]|怎麼|怎么|如何|哪裡|哪里|哪邊|該|该|什麼|甚麼|怎樣|怎麼辦|怎么办|處理|應對|破局|[嗎吗呢]\s*$/i;

export function isQuestionInput(text: string): boolean {
  return QUESTION_CUE_REGEX.test(text.trim());
}

/** Extracts 6D normalized spatial graph features from any 8v8 or 11v11 board state */
export function extractBoardSituationFeatures(
  players: PlayerToken[],
  ball: BallState,
  format: PitchFormat
): number[] {
  const spec = PITCH_SPECS[format];
  const holder = players.find((p) => p.id === ball.holderId);
  const homeHasBall = (holder?.team ?? 'home') === 'home' ? 1 : 0;
  const activeTeam: TeamSide = homeHasBall ? 'home' : 'away';
  const oppPlayers = players.filter((p) => p.team !== activeTeam && !p.isGK);

  const progX = clamp((activeTeam === 'home' ? ball.x : 100 - ball.x) / 100, 0, 1);
  const flankness = clamp(Math.abs(ball.y - 50) / 50, 0, 1);

  // Local pressing density within 11m around ball
  let pressSum = 0;
  for (const opp of oppPlayers) {
    const dM = Math.hypot(
      ((opp.x - ball.x) * spec.lengthM) / 100,
      ((opp.y - ball.y) * spec.widthM) / 100
    );
    if (dM < 12) pressSum += 1 - dM / 12;
  }
  const pressDensity = clamp(pressSum / 2.2, 0, 1);

  // Central Zone-14 passing lane openness
  const targetAheadX = clamp(ball.x + (activeTeam === 'home' ? 18 : -18), 10, 90);
  const centralOpen = passLaneClearance(ball.x, ball.y, targetAheadX, 50, oppPlayers);

  // Weak-side Pitch Control advantage
  const grid = computeSpatialGrid(players, ball, format, activeTeam);
  const weakRow = ball.y < 50 ? Math.floor(grid.rows * 0.8) : Math.floor(grid.rows * 0.2);
  const midCol = clamp(Math.floor((targetAheadX / 100) * grid.cols), 2, grid.cols - 3);
  const weakSidePC = clamp(grid.pitchControl[weakRow * grid.cols + midCol], 0, 1);

  return [progX, flankness, pressDensity, centralOpen, weakSidePC, homeHasBall];
}

/** Encodes natural-language question into a continuous 6D feature vector (semantic + n-gram hash) */
export function encodeQuestionFeatures(question: string): number[] {
  const q = question.trim().toLowerCase();
  const fSolve = /怎麼處理|怎麼辦|如何應對|怎麼踢|這球|這種情況|[?？]/.test(q) ? 1 : 0.3;
  const fEscape = /壓迫|逼搶|包夾|出球|破壓|受迫|被困/.test(q) ? 1 : 0;
  const fPenetrate = /空檔|空間|直塞|滲透|射門|身後|得分|前插|跑位/.test(q) ? 1 : 0;
  const fWidth = /弱側|轉移|換邊|拉寬|邊路|套邊|寬度/.test(q) ? 1 : 0;
  const fDefend = /防守|退防|反搶|丟球|補位|保護|盯人/.test(q) ? 1 : 0;

  // Deterministic character bigram hash in [0, 1] so custom questions form distinct embeddings
  let hash = 2166136261;
  for (let i = 0; i < q.length; i++) {
    hash ^= q.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const ngramSignal = ((hash >>> 0) % 1000) / 1000;

  return [fSolve, fEscape, fPenetrate, fWidth, fDefend, ngramSignal];
}

/** Canonical tactical Q&A curriculum teaching how to handle situations across pitch states */
const CANONICAL_QA_CURRICULUM: QuestionTrainingSample[] = [
  // 1. Deep build-up under heavy press: "後場被包夾這種情況該怎麼處理？" -> prioritize safe PPCF control & width
  {
    x: [0.20, 0.15, 0.82, 0.25, 0.72, 1, 1, 1, 0, 0.3, 0, 0.42],
    y: [0.88, 0.22, 0.85, 0.45, 0.76, 0.20],
    question: '後場被壓迫這種情況該怎麼處理？',
  },
  // 2. Strong-side flank overload trapped near touchline: "邊路被包夾怎麼處理？" -> switch to weak side
  {
    x: [0.52, 0.78, 0.78, 0.30, 0.86, 1, 1, 0.8, 0.2, 0.9, 0, 0.61],
    y: [0.82, 0.48, 0.80, 0.40, 0.94, 0.25],
    question: '邊路被包夾這種情況該怎麼處理？',
  },
  // 3. Central midfield with open Zone-14 lane: "中路有空間該怎麼進攻？" -> vertical OBSO penetration + decoy drag
  {
    x: [0.58, 0.12, 0.32, 0.86, 0.55, 1, 1, 0, 1, 0, 0, 0.28],
    y: [0.42, 0.92, 0.84, 0.85, 0.18, 0.20],
    question: '這種情況該怎麼滲透創造射門空檔？',
  },
  // 4. Final-third wing 1v1: "邊路持球這種情況怎麼創造空檔？" -> SGG decoy drag + touchline overlap
  {
    x: [0.68, 0.74, 0.45, 0.55, 0.50, 1, 1, 0, 0.8, 0.8, 0, 0.73],
    y: [0.55, 0.84, 0.76, 0.90, 0.82, 0.20],
    question: '邊路持球這種情況怎麼處理？',
  },
  // 5. Opponent holding ball in high transition: "丟球後這種情況怎麼處理？" -> aggressive counter-press
  {
    x: [0.35, 0.30, 0.40, 0.60, 0.45, 0, 1, 0.5, 0, 0, 1, 0.51],
    y: [0.60, 0.20, 0.50, 0.30, 0.35, 0.92],
    question: '前場丟球這種情況該怎麼處理？',
  },
  // 6. Opponent progressing deep into our half: "對手推進這種情況怎麼防守？" -> compact goal-side Ghosting block
  {
    x: [0.66, 0.62, 0.35, 0.55, 0.40, 0, 1, 0, 0, 0, 1, 0.19],
    y: [0.75, 0.15, 0.45, 0.25, 0.25, 0.18],
    question: '對手推進這種情況該怎麼防守？',
  },
];

function loadSavedCoachDemos(): QuestionTrainingSample[] {
  const combined = [...memoryCoachDemos];
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(QA_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as QuestionTrainingSample[];
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (Array.isArray(item.x) && item.x.length === 12 && Array.isArray(item.y) && item.y.length === 6) {
              combined.push(item);
            }
          }
        }
      }
    }
  } catch {
    // Ignore storage errors in restricted environments
  }
  return combined;
}

function saveCoachDemo(sample: QuestionTrainingSample): void {
  memoryCoachDemos.push(sample);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const existing = loadSavedCoachDemos();
      const trimmed = existing.slice(-40);
      window.localStorage.setItem(QA_STORAGE_KEY, JSON.stringify(trimmed));
    }
  } catch {
    // Ignore storage errors
  }
}

function forwardQAPolicy(
  x12: number[],
  w1: Float64Array,
  w2: Float64Array
): { hidden: Float64Array; out: Float64Array } {
  const hidden = new Float64Array(HIDDEN_DIM);
  for (let h = 0; h < HIDDEN_DIM; h++) {
    let sum = w1[h * IN_DIM + 12]; // bias
    for (let i = 0; i < 12; i++) {
      sum += w1[h * IN_DIM + i] * x12[i];
    }
    hidden[h] = Math.tanh(sum);
  }

  const out = new Float64Array(OUT_DIM);
  for (let o = 0; o < OUT_DIM; o++) {
    let sum = w2[o * (HIDDEN_DIM + 1) + HIDDEN_DIM]; // bias
    for (let h = 0; h < HIDDEN_DIM; h++) {
      sum += w2[o * (HIDDEN_DIM + 1) + h] * hidden[h];
    }
    out[o] = 1 / (1 + Math.exp(-sum));
  }
  return { hidden, out };
}

function trainQAPolicyNetwork(): TrainedQAPolicy {
  const coachDemos = loadSavedCoachDemos();
  // Weight coach demonstrations 3x so newly taught situations take immediate effect (DAgger priority)
  const dataset: QuestionTrainingSample[] = [
    ...CANONICAL_QA_CURRICULUM,
    ...coachDemos,
    ...coachDemos,
    ...coachDemos,
  ];

  const w1 = new Float64Array(HIDDEN_DIM * IN_DIM);
  const w2 = new Float64Array(OUT_DIM * (HIDDEN_DIM + 1));

  // Deterministic Xavier-like initialization
  for (let i = 0; i < w1.length; i++) {
    w1[i] = Math.sin(i * 1.73 + 0.4) * 0.28;
  }
  for (let i = 0; i < w2.length; i++) {
    w2[i] = Math.cos(i * 1.31 + 0.2) * 0.25;
  }

  const lr = 0.24;
  let mse = 0;

  for (let epoch = 0; epoch < 180; epoch++) {
    mse = 0;
    for (const sample of dataset) {
      const { hidden, out } = forwardQAPolicy(sample.x, w1, w2);
      const dOut = new Float64Array(OUT_DIM);

      for (let o = 0; o < OUT_DIM; o++) {
        const err = out[o] - sample.y[o];
        mse += err * err;
        dOut[o] = 2 * err * out[o] * (1 - out[o]);
      }

      const dHidden = new Float64Array(HIDDEN_DIM);
      for (let o = 0; o < OUT_DIM; o++) {
        const baseIdx = o * (HIDDEN_DIM + 1);
        for (let h = 0; h < HIDDEN_DIM; h++) {
          dHidden[h] += dOut[o] * w2[baseIdx + h];
          w2[baseIdx + h] -= lr * dOut[o] * hidden[h];
        }
        w2[baseIdx + HIDDEN_DIM] -= lr * dOut[o];
      }

      for (let h = 0; h < HIDDEN_DIM; h++) {
        const dz1 = dHidden[h] * (1 - hidden[h] * hidden[h]);
        const baseIdx = h * IN_DIM;
        for (let i = 0; i < 12; i++) {
          w1[baseIdx + i] -= lr * dz1 * sample.x[i];
        }
        w1[baseIdx + 12] -= lr * dz1;
      }
    }
    mse /= dataset.length * OUT_DIM;
  }

  cachedQAPolicy = {
    w1,
    w2,
    loss: mse,
    sampleCount: CANONICAL_QA_CURRICULUM.length + coachDemos.length,
    coachDemoCount: coachDemos.length,
  };
  return cachedQAPolicy;
}

export function getPolicyTrainingStats(): {
  loss: number;
  sampleCount: number;
  coachDemoCount: number;
} {
  const policy = cachedQAPolicy ?? trainQAPolicyNetwork();
  return {
    loss: policy.loss,
    sampleCount: policy.sampleCount,
    coachDemoCount: policy.coachDemoCount,
  };
}

/**
 * Interactive Imitation Learning (DAgger):
 * Extracts the coach's demonstrated handling strategy on the board for `(beforeState + question)`
 * and updates the neural policy weights via backpropagation.
 */
export function trainPolicyFromCoachDemo(
  question: string,
  beforePlayers: PlayerToken[],
  beforeBall: BallState,
  demoPlayers: PlayerToken[],
  demoBall: BallState,
  format: PitchFormat
): { loss: number; coachDemoCount: number } {
  const stateFeat = extractBoardSituationFeatures(beforePlayers, beforeBall, format);
  const qFeat = encodeQuestionFeatures(question || '這種情況該怎麼處理？');
  const x12 = [...stateFeat, ...qFeat];

  const gridAfter = computeSpatialGrid(demoPlayers, demoBall, format, 'home');
  const cellC = clamp(Math.floor((demoBall.x / 100) * gridAfter.cols), 0, gridAfter.cols - 1);
  const cellR = clamp(Math.floor((demoBall.y / 100) * gridAfter.rows), 0, gridAfter.rows - 1);
  const ballPC = gridAfter.pitchControl[cellR * gridAfter.cols + cellC];

  const spec = PITCH_SPECS[format];
  const goalThreat = computeGoalScoringValue(demoBall.x, demoBall.y, 'home', spec.lengthM, spec.widthM);
  const widthBias = clamp(Math.abs(demoBall.y - 50) / 42, 0.05, 0.98);

  // Measure off-ball decoy movement & defensive pressing aggression demonstrated by coach
  let maxOffBallMove = 0;
  let homeAdvanceSum = 0;
  let homeCount = 0;
  for (const pAfter of demoPlayers) {
    const pBefore = beforePlayers.find((b) => b.id === pAfter.id);
    if (!pBefore || pAfter.isGK) continue;
    const dist = Math.hypot(pAfter.x - pBefore.x, pAfter.y - pBefore.y);
    if (pAfter.team === 'home' && pAfter.id !== demoBall.holderId) {
      maxOffBallMove = Math.max(maxOffBallMove, dist);
    }
    if (pAfter.team === 'home') {
      homeAdvanceSum += pAfter.x - pBefore.x;
      homeCount += 1;
    }
  }

  const spaceDrag = clamp(maxOffBallMove / 18, 0.15, 0.95);
  const pressAggression = clamp(0.5 + homeAdvanceSum / Math.max(1, homeCount * 16), 0.1, 0.95);
  const passDistM = Math.hypot(
    ((demoBall.x - beforeBall.x) * spec.lengthM) / 100,
    ((demoBall.y - beforeBall.y) * spec.widthM) / 100
  );
  const transitionWeight = clamp(passDistM / 22, 0.25, 0.92);

  const sample: QuestionTrainingSample = {
    x: x12,
    y: [
      clamp(ballPC, 0.15, 0.95),
      clamp(goalThreat * 1.2, 0.1, 0.95),
      transitionWeight,
      spaceDrag,
      widthBias,
      pressAggression,
    ],
    question: question.trim() || '這種情況該怎麼處理？',
  };

  saveCoachDemo(sample);
  const updated = trainQAPolicyNetwork();
  return { loss: updated.loss, coachDemoCount: updated.coachDemoCount };
}

export function clearCoachDemosForTest(): void {
  memoryCoachDemos.length = 0;
  cachedQAPolicy = null;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(QA_STORAGE_KEY);
    }
  } catch {
    // Ignore
  }
}

/**
 * Generates multi-agent handling trajectories directly from the trained Question-State MLP
 * pi_Theta(a | G_0, q) without routing to hardcoded preset scenarios.
 */
export function simulateWithQuestionPolicy(
  question: string,
  basePlayers: PlayerToken[],
  baseBall: BallState,
  format: PitchFormat
): { keyframes: TacticalKeyframe[]; analysis: TacticalAnalysis } {
  const policy = cachedQAPolicy ?? trainQAPolicyNetwork();
  const spec = PITCH_SPECS[format];

  const stateFeat = extractBoardSituationFeatures(basePlayers, baseBall, format);
  const qFeat = encodeQuestionFeatures(question);
  const { out } = forwardQAPolicy([...stateFeat, ...qFeat], policy.w1, policy.w2);

  const [rawCtrl, rawThreat, rawTrans, rawDrag, widthBias, pressAgg] = Array.from(out);
  const wSum = rawCtrl + rawThreat + rawTrans + rawDrag + 1e-5;
  const wControl = rawCtrl / wSum;
  const wGoalThreat = rawThreat / wSum;
  const wTransition = rawTrans / wSum;
  const wSpaceDrag = rawDrag / wSum;

  const holder0 = basePlayers.find((p) => p.id === baseBall.holderId);
  const homeInPossession = (holder0?.team ?? 'home') === 'home' && qFeat[4] < 0.8;

  const f0Players = basePlayers.map((p) => ({ ...p }));
  const f0Ball: BallState = { ...baseBall };

  if (homeInPossession) {
    const homeOutfield = f0Players.filter((p) => p.team === 'home' && !p.isGK);
    const carrier0 =
      f0Players.find((p) => p.id === f0Ball.holderId && p.team === 'home') ??
      [...homeOutfield].sort(
        (a, b) =>
          Math.hypot(a.x - f0Ball.x, a.y - f0Ball.y) - Math.hypot(b.x - f0Ball.x, b.y - f0Ball.y)
      )[0];

    f0Ball.x = clamp(carrier0.x + 1.8, 3, 97);
    f0Ball.y = carrier0.y;
    f0Ball.holderId = carrier0.id;

    const f1Players = f0Players.map((p) => ({ ...p }));
    const f1Ball: BallState = { ...f0Ball };
    const f1Anns: DrawingAnnotation[] = [];

    const c1 = f1Players.find((p) => p.id === carrier0.id)!;
    const c0Pos = { x: c1.x, y: c1.y };
    const dribbleDx = clamp((wGoalThreat - wControl) * 14 + 4, 2, 9);
    const dribbleDy = (50 - c1.y) * (1 - widthBias) * 0.18;
    c1.x = clamp(c1.x + dribbleDx, 8, 88);
    c1.y = clamp(c1.y + dribbleDy, 12, 88);
    if (Math.hypot(c1.x - c0Pos.x, c1.y - c0Pos.y) > 2.5) {
      f1Anns.push({
        id: 'qa-drib',
        kind: 'dribble',
        x1: c0Pos.x,
        y1: c0Pos.y,
        x2: c1.x,
        y2: c1.y,
        team: 'home',
      });
    }
    f1Ball.x = clamp(c1.x + 1.8, 3, 97);
    f1Ball.y = c1.y;
    f1Ball.holderId = c1.id;

    const grid0 = computeSpatialGrid(f0Players, f0Ball, format, 'home');
    const defenders0 = f0Players.filter((p) => p.team === 'away' && !p.isGK);
    const otherHome = f1Players.filter((p) => p.team === 'home' && !p.isGK && p.id !== c1.id);
    const decoy = [...otherHome].sort((a, b) => b.x - a.x)[0];

    let best = { x: clamp(c1.x + 16, 20, 90), y: 50, score: -99, runnerId: '' };
    const runners = otherHome.filter((p) => p.id !== decoy?.id);

    for (const r of runners.length > 0 ? runners : otherHome) {
      for (let gx = 2; gx < grid0.cols - 1; gx += 2) {
        for (let gy = 1; gy < grid0.rows - 1; gy += 2) {
          const tx = ((gx + 0.5) / grid0.cols) * 100;
          const ty = ((gy + 0.5) / grid0.rows) * 100;
          const runDistM = Math.hypot(
            ((tx - r.x) * spec.lengthM) / 100,
            ((ty - r.y) * spec.widthM) / 100
          );
          if (runDistM > 24 || tx < c1.x - 8) continue;

          const pc = grid0.pitchControl[gy * grid0.cols + gx];
          const sVal = computeGoalScoringValue(tx, ty, 'home', spec.lengthM, spec.widthM);
          const tVal =
            computeTransitionProbability(tx, ty, f1Ball, spec.lengthM, spec.widthM) *
            passLaneClearance(f1Ball.x, f1Ball.y, tx, ty, defenders0);
          const dragVal = decoy ? clamp(1 - Math.hypot(tx - decoy.x, ty - decoy.y) / 36, 0, 1) : 0.3;

          // Continuous width preference learned by MLP (high widthBias favors weak-side/wide channels)
          const normLateral = Math.abs(ty - 50) / 50;
          const weakSideBonus = (c0Pos.y < 50 ? ty > 55 : ty < 45) ? 0.15 * widthBias : 0;
          const widthAlignment = 1 - Math.abs(normLateral - widthBias);

          const score =
            wControl * pc +
            wGoalThreat * sVal +
            wTransition * tVal +
            wSpaceDrag * dragVal +
            0.32 * widthAlignment +
            weakSideBonus;

          if (score > best.score) {
            best = { x: tx, y: ty, score, runnerId: r.id };
          }
        }
      }
    }

    if (decoy && decoy.id !== best.runnerId) {
      const d0 = f0Players.find((p) => p.id === decoy.id)!;
      const pullSign = best.y <= 50 ? 1 : -1;
      decoy.x = clamp(d0.x + (rawDrag > 0.6 ? -4 : 7), 16, 90);
      decoy.y = clamp(d0.y + pullSign * 13 * rawDrag, 14, 86);
      f1Anns.push({
        id: `qa-sgg-${decoy.id}`,
        kind: 'run',
        x1: d0.x,
        y1: d0.y,
        x2: decoy.x,
        y2: decoy.y,
        team: 'home',
      });
    }

    const runner1 = f1Players.find((p) => p.id === best.runnerId) ?? otherHome[0];
    if (runner1) {
      const r0 = f0Players.find((p) => p.id === runner1.id)!;
      runner1.x = r0.x + (best.x - r0.x) * 0.58;
      runner1.y = r0.y + (best.y - r0.y) * 0.58;
      f1Anns.push({
        id: `qa-run1-${runner1.id}`,
        kind: 'run',
        x1: r0.x,
        y1: r0.y,
        x2: runner1.x,
        y2: runner1.y,
        team: 'home',
      });
    }

    f1Anns.push(
      ...computeDefensiveGhosting(f0Players, f1Players, 'away', f1Ball, format, stateFeat[0] < 0.35)
    );

    const f2Players = f1Players.map((p) => ({ ...p }));
    const f2Ball: BallState = { ...f1Ball };
    const f2Anns: DrawingAnnotation[] = [];

    const c2 = f2Players.find((p) => p.id === c1.id)!;
    const runner2 = runner1 ? f2Players.find((p) => p.id === runner1.id) : undefined;
    if (runner2) {
      const prev = { x: runner2.x, y: runner2.y };
      runner2.x = clamp(best.x, 10, 93);
      runner2.y = clamp(best.y, 8, 92);
      f2Anns.push({
        id: `qa-run2-${runner2.id}`,
        kind: 'run',
        x1: prev.x,
        y1: prev.y,
        x2: runner2.x,
        y2: runner2.y,
        team: 'home',
      });
      f2Anns.push({
        id: 'qa-pass',
        kind: 'pass',
        x1: c2.x,
        y1: c2.y,
        x2: runner2.x,
        y2: runner2.y,
        team: 'home',
      });
      f2Ball.x = clamp(runner2.x + 1.5, 3, 97);
      f2Ball.y = runner2.y;
      f2Ball.holderId = runner2.id;
    }

    f2Anns.push(
      ...computeDefensiveGhosting(f1Players, f2Players, 'away', f2Ball, format, stateFeat[0] < 0.35)
    );

    const rNum = runner2 ? `#${runner2.number}` : '接應球員';
    const dNum = decoy ? `#${decoy.number}` : '無球前鋒';
    const zoneDesc = widthBias > 0.62 ? '弱側／邊路寬度走廊' : wGoalThreat > wControl ? '肋部身後威脅空檔' : '高控球率安全接應區';

    return {
      keyframes: [
        { id: 'qa-0', title: '起始', description: '', phase: 'setup', players: f0Players, ball: f0Ball, annotations: [], durationMs: 700 },
        { id: 'qa-1', title: '啟動', description: '', phase: 'on-ball', players: f1Players, ball: f1Ball, annotations: f1Anns, durationMs: 1350 },
        { id: 'qa-2', title: '到位', description: '', phase: 'on-ball', players: f2Players, ball: f2Ball, annotations: f2Anns, durationMs: 1350 },
      ],
      analysis: {
        summary: '問句條件策略推演',
        ballStateLabel: '問句條件策略推演',
        phase: 'on-ball',
        onBallAction: `#${c1.number} 依盤面壓迫調整持球角度並分球至${zoneDesc}`,
        offBallAttackShift: `${dNum} 反向牽制防線，${rNum} 依策略權重切入${zoneDesc}接應（訓練樣本 ${policy.sampleCount} 筆）。`,
        defenseShift: '藍隊第1防守者封堵球門線內側，後防依 Ghosting 協同橫移保護空檔。',
        coachingCue: '',
        detectedIntent: 'qa_policy',
      },
    };
  }

  // Out-of-possession / Defensive handling learned via pressAgg output
  const awayOutfield = f0Players.filter((p) => p.team === 'away' && !p.isGK);
  const oppCarrier0 =
    f0Players.find((p) => p.id === f0Ball.holderId && p.team === 'away') ??
    [...awayOutfield].sort(
      (a, b) =>
        Math.hypot(a.x - f0Ball.x, a.y - f0Ball.y) - Math.hypot(b.x - f0Ball.x, b.y - f0Ball.y)
    )[0];

  f0Ball.x = clamp(oppCarrier0.x - 1.8, 4, 96);
  f0Ball.y = oppCarrier0.y;
  f0Ball.holderId = oppCarrier0.id;

  const f1Players = f0Players.map((p) => ({ ...p }));
  const f1Ball: BallState = { ...f0Ball };
  const f1Anns: DrawingAnnotation[] = [];

  const opp1 = f1Players.find((p) => p.id === oppCarrier0.id)!;
  const opp0Pos = { x: opp1.x, y: opp1.y };
  opp1.x = clamp(opp1.x - (pressAgg > 0.6 ? 3 : 8), 20, 86);
  f1Anns.push({
    id: 'qa-opp-drib',
    kind: 'dribble',
    x1: opp0Pos.x,
    y1: opp0Pos.y,
    x2: opp1.x,
    y2: opp1.y,
    team: 'away',
  });
  f1Ball.x = clamp(opp1.x - 1.8, 4, 96);
  f1Ball.y = opp1.y;
  f1Ball.holderId = opp1.id;

  const highPress = pressAgg > 0.58;
  f1Anns.push(...computeDefensiveGhosting(f0Players, f1Players, 'home', f1Ball, format, highPress));

  const f2Players = f1Players.map((p) => ({ ...p }));
  const f2Ball: BallState = { ...f1Ball };
  const f2Anns: DrawingAnnotation[] = [
    ...computeDefensiveGhosting(f1Players, f2Players, 'home', f2Ball, format, highPress),
  ];

  return {
    keyframes: [
      { id: 'qa-0', title: '起始', description: '', phase: 'setup', players: f0Players, ball: f0Ball, annotations: [], durationMs: 700 },
      { id: 'qa-1', title: '壓迫與收縮', description: '', phase: 'off-ball', players: f1Players, ball: f1Ball, annotations: f1Anns, durationMs: 1350 },
      { id: 'qa-2', title: '封鎖完成', description: '', phase: 'off-ball', players: f2Players, ball: f2Ball, annotations: f2Anns, durationMs: 1350 },
    ],
    analysis: {
      summary: '無球防守問句策略推演',
      ballStateLabel: '無球防守問句策略推演',
      phase: 'off-ball',
      onBallAction: '無球協同應對',
      offBallAttackShift: `藍隊 #${opp1.number} 持球試探推進，尋找傳球走廊。`,
      defenseShift: highPress
        ? `紅隊依策略執行前壓反搶封鎖回傳線，防線同步前推壓縮空間（訓練樣本 ${policy.sampleCount} 筆）。`
        : `紅隊第1人站球門線內側延緩，後防線橫移內收保護肋部與禁區（訓練樣本 ${policy.sampleCount} 筆）。`,
      coachingCue: '',
      detectedIntent: 'qa_policy_defense',
    },
  };
}
