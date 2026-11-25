import { describe, expect, it } from 'vitest';
import { createInitialBall, getFormationsForFormat, instantiateTeam } from '../data/formations';
import { PITCH_SPECS } from '../data/pitchSpecs';
import { interpolateKeyframes, simulateTacticalCommand } from './tacticalEngine';

describe('Pitch & Formation Specs', () => {
  it('provides accurate 8v8 and 11v11 pitch dimensions and team counts', () => {
    expect(PITCH_SPECS['8v8'].playersPerTeam).toBe(8);
    expect(PITCH_SPECS['8v8'].lengthM).toBe(65);
    expect(PITCH_SPECS['8v8'].widthM).toBe(45);

    expect(PITCH_SPECS['11v11'].playersPerTeam).toBe(11);
    expect(PITCH_SPECS['11v11'].lengthM).toBe(105);
    expect(PITCH_SPECS['11v11'].widthM).toBe(68);

    for (const fmt of getFormationsForFormat('8v8')) {
      const team = instantiateTeam(fmt.id, 'home');
      expect(team).toHaveLength(8);
      expect(team.filter((p) => p.isGK)).toHaveLength(1);
    }

    for (const fmt of getFormationsForFormat('11v11')) {
      const team = instantiateTeam(fmt.id, 'away');
      expect(team).toHaveLength(11);
      expect(team.filter((p) => p.isGK)).toHaveLength(1);
    }
  });
});

describe('Tactical Voice/Text Simulation Engine', () => {
  it('simulates 11v11 on-ball wing cut-inside + overlap + defensive lateral shift', () => {
    const players = [
      ...instantiateTeam('11v11-4-3-3', 'home'),
      ...instantiateTeam('11v11-4-4-2', 'away'),
    ];
    const ball = createInitialBall(players);

    const res = simulateTacticalCommand(
      '左邊鋒持球內切肋部，左後衛套邊接應',
      players,
      ball,
      '11v11',
      'on-ball'
    );

    expect(res.keyframes).toHaveLength(3);
    expect(res.analysis.phase).toBe('on-ball');
    expect(res.keyframes[2].annotations.length).toBeGreaterThan(2);

    // Left-wing action happens on top half (y < 50), so away defending average y should shift toward top (< 50)
    const awayOutfield0 = res.keyframes[0].players.filter((p) => p.team === 'away' && !p.isGK);
    const awayOutfield2 = res.keyframes[2].players.filter((p) => p.team === 'away' && !p.isGK);
    const avgY0 = awayOutfield0.reduce((s, p) => s + p.y, 0) / awayOutfield0.length;
    const avgY2 = awayOutfield2.reduce((s, p) => s + p.y, 0) / awayOutfield2.length;
    expect(avgY2).toBeLessThan(avgY0);
  });

  it('simulates 8v8 off-ball decoy run & defensive reaction', () => {
    const players = [
      ...instantiateTeam('8v8-2-3-2', 'home'),
      ...instantiateTeam('8v8-3-2-2', 'away'),
    ];
    const ball = createInitialBall(players);

    const res = simulateTacticalCommand(
      '無球時前鋒斜向拉邊牽制中衛，中場前插肋部空檔',
      players,
      ball,
      '8v8',
      'off-ball'
    );

    expect(res.keyframes).toHaveLength(3);
    expect(res.analysis.phase).toBe('off-ball');
    expect(res.keyframes[1].annotations.some((a) => a.kind === 'run')).toBe(true);
    expect(res.keyframes[2].annotations.some((a) => a.kind === 'press')).toBe(true);
  });

  it('simulates off-ball high press & opponent compact shifting', () => {
    const players = [
      ...instantiateTeam('11v11-4-2-3-1', 'home'),
      ...instantiateTeam('11v11-4-3-3', 'away'),
    ];
    const ball = createInitialBall(players);

    const pressRes = simulateTacticalCommand(
      '前場丟球立即高位逼搶封鎖回傳線',
      players,
      ball,
      '11v11',
      'auto'
    );
    expect(pressRes.analysis.phase).toBe('off-ball');
    expect(pressRes.keyframes[1].annotations.some((a) => a.kind === 'press')).toBe(true);

    const shiftRes = simulateTacticalCommand(
      '對手右路持球推進，我方防線橫移緊縮',
      players,
      ball,
      '11v11',
      'auto'
    );
    expect(shiftRes.analysis.phase).toBe('off-ball');
  });

  it('handles explicit player numbers and interpolates smoothly', () => {
    const players = [
      ...instantiateTeam('8v8-2-3-2', 'home'),
      ...instantiateTeam('8v8-2-3-2', 'away'),
    ];
    const ball = createInitialBall(players);

    const res = simulateTacticalCommand(
      '6號中路持球推進後傳給9號前鋒',
      players,
      ball,
      '8v8',
      'on-ball'
    );

    const mid = interpolateKeyframes(res.keyframes[0], res.keyframes[1], 0.5);
    expect(mid.players).toHaveLength(16);
    for (const p of mid.players) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });
});
