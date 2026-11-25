import { describe, expect, it } from 'vitest';
import { createInitialBall, instantiateTeam } from '../data/formations';
import {
  clearCoachDemosForTest,
  computeSpatialGrid,
  getCalibratedPolicyWeights,
  getPolicyTrainingStats,
  runAISpatialSimulation,
  simulateWithQuestionPolicy,
  trainPolicyFromCoachDemo,
} from './spatialModel';

describe('AI Spatial Tactical Literature Engine', () => {
  it('trains & calibrates policy weights via gradient descent with low MSE', () => {
    const w = getCalibratedPolicyWeights();
    expect(w.loss).toBeLessThan(0.06);
    expect(w.wControl + w.wGoalThreat + w.wTransition + w.wSpaceDrag).toBeCloseTo(1, 3);
  });

  it('computes continuous Pitch Control (PPCF) and OBSO surfaces across 11v11 and 8v8', () => {
    const players11 = [
      ...instantiateTeam('11v11-4-3-3', 'home'),
      ...instantiateTeam('11v11-4-4-2', 'away'),
    ];
    const ball11 = createInitialBall(players11);
    const grid = computeSpatialGrid(players11, ball11, '11v11', 'home');

    expect(grid.pitchControl).toHaveLength(grid.cols * grid.rows);
    expect(grid.obso).toHaveLength(grid.cols * grid.rows);
    expect(grid.hotspots.length).toBeGreaterThan(0);

    const homeBackIdx = Math.floor(grid.rows / 2) * grid.cols + 2;
    const awayBoxIdx = Math.floor(grid.rows / 2) * grid.cols + (grid.cols - 2);
    expect(grid.pitchControl[homeBackIdx]).toBeGreaterThan(0.65);
    expect(grid.pitchControl[awayBoxIdx]).toBeLessThan(0.35);
  });

  it('simulates all 5 AI match contexts + auto ball-position inference', () => {
    const players8 = [
      ...instantiateTeam('8v8-2-3-2', 'home'),
      ...instantiateTeam('8v8-3-2-2', 'away'),
    ];
    const ball8 = createInitialBall(players8);

    const contexts = [
      'auto',
      'build_up',
      'flank_overload',
      'central_penetration',
      'switch_weak_side',
      'counter_press',
    ] as const;

    for (const ctx of contexts) {
      const out = runAISpatialSimulation(ctx, players8, ball8, '8v8');
      expect(out.keyframes).toHaveLength(3);
      expect(out.keyframes[1].annotations.length).toBeGreaterThan(1);
      expect(out.analysis.offBallAttackShift.length).toBeGreaterThan(5);
      expect(out.analysis.defenseShift.length).toBeGreaterThan(5);
    }
  });

  it('trains AI via Question + Board Situation demonstrations (DAgger Imitation Learning)', () => {
    clearCoachDemosForTest();
    const players = [
      ...instantiateTeam('11v11-4-3-3', 'home'),
      ...instantiateTeam('11v11-4-4-2', 'away'),
    ];
    const ball = createInitialBall(players);
    const question = '中場被包夾這種情況該怎麼處理？';

    const beforeTrain = simulateWithQuestionPolicy(question, players, ball, '11v11');
    const lateralBefore = Math.abs(beforeTrain.keyframes[2].ball.y - 50);

    // Coach demonstrates handling this situation by switching wide to the right wing (#7 RW at y ~ 88)
    const demoPlayers = players.map((p) =>
      p.team === 'home' && p.role === 'RW' ? { ...p, x: 68, y: 90 } : { ...p }
    );
    const rw = demoPlayers.find((p) => p.team === 'home' && p.role === 'RW')!;
    const demoBall = { x: rw.x + 1.5, y: rw.y, holderId: rw.id };

    const stats = trainPolicyFromCoachDemo(
      question,
      players,
      ball,
      demoPlayers,
      demoBall,
      '11v11'
    );

    expect(stats.coachDemoCount).toBe(1);
    expect(stats.loss).toBeLessThan(0.05);
    expect(getPolicyTrainingStats().sampleCount).toBeGreaterThan(6);

    // Re-running the same question on the original situation now shifts the AI's target wider
    const afterTrain = simulateWithQuestionPolicy(question, players, ball, '11v11');
    const lateralAfter = Math.abs(afterTrain.keyframes[2].ball.y - 50);
    expect(lateralAfter).toBeGreaterThan(lateralBefore);
  });
});
