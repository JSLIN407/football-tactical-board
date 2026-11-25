import { clamp, distanceNorm } from '../data/pitchSpecs';
import type {
  BallState,
  DrawingAnnotation,
  PitchFormat,
  PlayerRole,
  PlayerToken,
  SimulationMode,
  TacticalAnalysis,
  TacticalKeyframe,
  TeamSide,
} from '../types/tactics';

export interface TacticalSimulationResult {
  keyframes: TacticalKeyframe[];
  analysis: TacticalAnalysis;
}

type Flank = 'left' | 'right' | 'center';

type ScenarioPattern =
  | 'wing_overlap_cut_inside'
  | 'through_ball_third_man'
  | 'switch_of_play'
  | 'build_up_press_break'
  | 'offball_decoy_rotation'
  | 'high_press_gegenpress'
  | 'compact_defensive_shift'
  | 'custom_player_action';

interface ParsedIntent {
  pattern: ScenarioPattern;
  effectiveMode: 'on-ball' | 'off-ball';
  flank: Flank;
  explicitNumber: number | null;
  targetNumber: number | null;
  offenseTeam: TeamSide;
  wantsPress: boolean;
  wantsDrop: boolean;
  wantsOverlap: boolean;
  wantsThrough: boolean;
  wantsSwitch: boolean;
}

function clonePlayers(players: PlayerToken[]): PlayerToken[] {
  return players.map((p) => ({ ...p }));
}

function findPlayerByNumber(
  players: PlayerToken[],
  team: TeamSide,
  num: number | null
): PlayerToken | undefined {
  if (num === null) return undefined;
  return players.find((p) => p.team === team && p.number === num);
}

function findByRoles(
  players: PlayerToken[],
  team: TeamSide,
  roles: PlayerRole[],
  flankHint?: Flank
): PlayerToken | undefined {
  const teamPlayers = players.filter((p) => p.team === team);
  for (const role of roles) {
    const matches = teamPlayers.filter((p) => p.role === role);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      if (flankHint === 'left') {
        return [...matches].sort((a, b) => a.y - b.y)[0];
      }
      if (flankHint === 'right') {
        return [...matches].sort((a, b) => b.y - a.y)[0];
      }
      return matches[0];
    }
  }
  return undefined;
}

function findWideAttacker(
  players: PlayerToken[],
  team: TeamSide,
  flank: Flank
): PlayerToken | undefined {
  const outfield = players.filter((p) => p.team === team && !p.isGK);
  if (flank === 'left') {
    const roleMatch = findByRoles(players, team, ['LW', 'LM', 'LWB', 'ST', 'CF'], 'left');
    if (roleMatch && roleMatch.y < 52) return roleMatch;
    return [...outfield].sort((a, b) => a.y - b.y)[0];
  }
  if (flank === 'right') {
    const roleMatch = findByRoles(players, team, ['RW', 'RM', 'RWB', 'CF', 'ST'], 'right');
    if (roleMatch && roleMatch.y > 48) return roleMatch;
    return [...outfield].sort((a, b) => b.y - a.y)[0];
  }
  return findByRoles(players, team, ['CAM', 'ST', 'CF', 'CM']);
}

function findFullback(
  players: PlayerToken[],
  team: TeamSide,
  flank: Flank
): PlayerToken | undefined {
  if (flank === 'left') {
    return (
      findByRoles(players, team, ['LB', 'LWB', 'LCB'], 'left') ??
      [...players.filter((p) => p.team === team && !p.isGK)].sort(
        (a, b) => a.x + a.y - (b.x + b.y)
      )[0]
    );
  }
  if (flank === 'right') {
    return (
      findByRoles(players, team, ['RB', 'RWB', 'RCB'], 'right') ??
      [...players.filter((p) => p.team === team && !p.isGK)].sort(
        (a, b) => a.x - a.y - (b.x - b.y)
      )[0]
    );
  }
  return findByRoles(players, team, ['CB', 'LCB', 'RCB']);
}

function findPlaymaker(players: PlayerToken[], team: TeamSide): PlayerToken | undefined {
  return (
    findByRoles(players, team, ['CAM', 'CM', 'LCM', 'RCM', 'CDM']) ??
    players.find((p) => p.team === team && !p.isGK)
  );
}

function findStriker(players: PlayerToken[], team: TeamSide): PlayerToken | undefined {
  return (
    findByRoles(players, team, ['ST', 'CF', 'CAM']) ??
    [...players.filter((p) => p.team === team && !p.isGK)].sort((a, b) =>
      team === 'home' ? b.x - a.x : a.x - b.x
    )[0]
  );
}

function parseTacticalPrompt(
  prompt: string,
  mode: SimulationMode,
  players: PlayerToken[],
  currentBall: BallState
): ParsedIntent {
  const text = prompt.trim().toLowerCase();

  // Extract explicit numbers like "10號" or "#7"
  const numMatches = [...text.matchAll(/(?:#|no\.?\s*)?(\d{1,2})\s*(?:號)?/g)].map((m) =>
    parseInt(m[1], 10)
  );
  const validNums = numMatches.filter((n) => n >= 1 && n <= 23);
  const explicitNumber = validNums[0] ?? null;
  const targetNumber = validNums[1] ?? null;

  // Determine flank
  let flank: Flank = 'center';
  if (/左路|左側|左邊|左翼|左半|左肋|左邊鋒|左後衛|left/.test(text)) {
    flank = 'left';
  } else if (/右路|右側|右邊|右翼|右半|右肋|右邊鋒|右後衛|right/.test(text)) {
    flank = 'right';
  } else if (currentBall.y < 36) {
    flank = 'left';
  } else if (currentBall.y > 64) {
    flank = 'right';
  }

  // Determine offense vs defense focus
  const opponentHasBall = /對手|敵方|對方.*(?:持球|拿球|推進)/.test(text);
  const offenseTeam: TeamSide = opponentHasBall ? 'away' : 'home';

  const wantsPress = /逼搶|反搶|壓迫|高壓|上搶|gegenpress|press/.test(text);
  const wantsDrop = /退守|低位|緊縮|防線橫移|收縮|鏈式|補位|block/.test(text);
  const wantsOverlap = /套邊|內切|重疊|overlap|cut\s*inside|下底/.test(text);
  const wantsThrough = /直塞|身後|第三人|穿透|斜插|through|third/.test(text);
  const wantsSwitch = /轉移|弱側|大範圍|換邊|switch|diagonal/.test(text);
  const wantsBuildUp = /門將|後場|出球|破壓|組織|build/.test(text);
  const wantsOffBallAttack = /無球.*(?:拉邊|牽制|前插|跑位|接應|交叉)|(?:拉邊|牽制|交叉跑位)/.test(
    text
  );

  let effectiveMode: 'on-ball' | 'off-ball' =
    mode === 'auto'
      ? wantsPress || wantsDrop || wantsOffBallAttack || /無球|沒球|防守/.test(text) && !/持球/.test(text)
        ? 'off-ball'
        : 'on-ball'
      : mode;

  let pattern: ScenarioPattern = 'custom_player_action';
  if (wantsSwitch) {
    pattern = 'switch_of_play';
    effectiveMode = 'on-ball';
  } else if (wantsBuildUp) {
    pattern = 'build_up_press_break';
    effectiveMode = 'on-ball';
  } else if (wantsPress && !wantsOverlap && !wantsThrough) {
    pattern = 'high_press_gegenpress';
    effectiveMode = 'off-ball';
  } else if (wantsDrop || opponentHasBall) {
    pattern = 'compact_defensive_shift';
    effectiveMode = 'off-ball';
  } else if (wantsOverlap) {
    pattern = 'wing_overlap_cut_inside';
    effectiveMode = 'on-ball';
  } else if (wantsOffBallAttack) {
    pattern = 'offball_decoy_rotation';
    effectiveMode = 'off-ball';
  } else if (wantsThrough) {
    pattern = 'through_ball_third_man';
    effectiveMode = 'on-ball';
  } else if (explicitNumber !== null) {
    pattern = 'custom_player_action';
  } else if (flank !== 'center' && effectiveMode === 'on-ball') {
    pattern = 'wing_overlap_cut_inside';
  } else if (effectiveMode === 'off-ball') {
    pattern = 'offball_decoy_rotation';
  } else {
    pattern = 'through_ball_third_man';
  }

  // Refine flank if explicit player has clear wing role
  if (explicitNumber !== null) {
    const p = findPlayerByNumber(players, offenseTeam, explicitNumber);
    if (p) {
      if (p.y < 36) flank = 'left';
      else if (p.y > 64) flank = 'right';
    }
  }

  return {
    pattern,
    effectiveMode,
    flank,
    explicitNumber,
    targetNumber,
    offenseTeam,
    wantsPress,
    wantsDrop,
    wantsOverlap,
    wantsThrough,
    wantsSwitch,
  };
}

/**
 * Ball-oriented defensive shifting:
 * Shifts the defending team laterally toward the ball, maintains vertical compactness,
 * sends the nearest defender to press, and tucks far-side defenders into the central corridor.
 */
function applyBallOrientedDefenseShift(
  prevPlayers: PlayerToken[],
  nextPlayers: PlayerToken[],
  defendTeam: TeamSide,
  ball: { x: number; y: number },
  format: PitchFormat,
  intensity: 'press' | 'compact' | 'high-block'
): DrawingAnnotation[] {
  const annotations: DrawingAnnotation[] = [];
  const defenders = nextPlayers.filter((p) => p.team === defendTeam && !p.isGK);
  const gk = nextPlayers.find((p) => p.team === defendTeam && p.isGK);

  // GK tracks ball angle subtly
  if (gk) {
    const gkOrigin = prevPlayers.find((p) => p.id === gk.id) ?? gk;
    gk.y = clamp(50 + (ball.y - 50) * 0.22, 41, 59);
    gk.x = defendTeam === 'away' ? clamp(95 - (100 - ball.x) * 0.08, 86, 96) : clamp(5 + ball.x * 0.08, 4, 14);
    if (Math.hypot(gk.x - gkOrigin.x, gk.y - gkOrigin.y) > 1.5) {
      annotations.push({
        id: `auto-gk-${gk.id}`,
        kind: 'press',
        x1: gkOrigin.x,
        y1: gkOrigin.y,
        x2: gk.x,
        y2: gk.y,
        team: defendTeam,
        autoGenerated: true,
      });
    }
  }

  if (defenders.length === 0) return annotations;

  // Find closest defender to press the ball
  const sortedByDist = [...defenders].sort(
    (a, b) =>
      distanceNorm(a.x, a.y, ball.x, ball.y, format) -
      distanceNorm(b.x, b.y, ball.x, ball.y, format)
  );
  const presser = sortedByDist[0];
  const goalDir = defendTeam === 'away' ? 1 : -1; // toward own goal

  // Lateral shift toward ball y (ball-oriented compactness)
  const lateralShift = (ball.y - 50) * (intensity === 'compact' ? 0.36 : 0.28);

  // Longitudinal line anchor based on ball x
  const avgDefX = defenders.reduce((acc, d) => acc + d.x, 0) / defenders.length;
  const targetLineX =
    intensity === 'high-block'
      ? clamp(ball.x + goalDir * 12, 18, 82)
      : clamp(ball.x + goalDir * 19, 16, 84);
  const longitudinalShift = (targetLineX - avgDefX) * 0.55;

  for (const def of defenders) {
    const origin = prevPlayers.find((p) => p.id === def.id) ?? def;

    if (def.id === presser.id) {
      // Nearest defender steps up to engage goal-side of ball
      const pressOffset = intensity === 'press' || intensity === 'high-block' ? 4.2 : 6.0;
      def.x = clamp(ball.x + goalDir * pressOffset, 8, 92);
      def.y = clamp(ball.y + (50 - ball.y) * 0.12, 8, 92);
      annotations.push({
        id: `auto-press-${def.id}`,
        kind: 'press',
        x1: origin.x,
        y1: origin.y,
        x2: def.x,
        y2: def.y,
        team: defendTeam,
        label: '上搶壓迫',
        autoGenerated: true,
      });
    } else {
      // Rest of team shifts toward ball side and compresses far side
      const isFarSide = (ball.y < 45 && def.y > 55) || (ball.y > 55 && def.y < 45);
      const tuckAmount = isFarSide ? (50 - def.y) * 0.28 : 0;

      // Keep vertical spacing compact
      def.x = clamp(origin.x + longitudinalShift, 10, 90);
      def.y = clamp(origin.y + lateralShift * 0.72 + tuckAmount, 10, 90);

      if (Math.hypot(def.x - origin.x, def.y - origin.y) > 2.2) {
        annotations.push({
          id: `auto-shift-${def.id}`,
          kind: 'press',
          x1: origin.x,
          y1: origin.y,
          x2: def.x,
          y2: def.y,
          team: defendTeam,
          autoGenerated: true,
        });
      }
    }
  }

  return annotations;
}

function makeMoveAnnotation(
  id: string,
  kind: DrawingAnnotation['kind'],
  from: { x: number; y: number },
  to: { x: number; y: number },
  team: TeamSide,
  label?: string
): DrawingAnnotation {
  return {
    id,
    kind,
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y,
    team,
    label,
    autoGenerated: true,
  };
}

export function simulateTacticalCommand(
  prompt: string,
  currentPlayers: PlayerToken[],
  currentBall: BallState,
  format: PitchFormat,
  mode: SimulationMode = 'auto'
): TacticalSimulationResult {
  const intent = parseTacticalPrompt(prompt, mode, currentPlayers, currentBall);
  const attackTeam = intent.offenseTeam;
  const defendTeam: TeamSide = attackTeam === 'home' ? 'away' : 'home';
  const dir = attackTeam === 'home' ? 1 : -1;

  // Frame 0: Base snapshot
  const f0Players = clonePlayers(currentPlayers);
  const f0Ball: BallState = { ...currentBall };

  // Frame 1: Trigger / On-ball action + First wave of runs
  const f1Players = clonePlayers(f0Players);
  const f1Ball: BallState = { ...f0Ball };
  const f1Annotations: DrawingAnnotation[] = [];

  // Frame 2: Completion + Full offensive/defensive shift
  const f2Players = clonePlayers(f0Players);
  const f2Ball: BallState = { ...f0Ball };
  const f2Annotations: DrawingAnnotation[] = [];

  let analysis: TacticalAnalysis;

  const leftSign = -1; // toward y=0
  const rightSign = 1; // toward y=100
  const flankSign = intent.flank === 'right' ? rightSign : leftSign;
  const flankName = intent.flank === 'right' ? '右路' : intent.flank === 'left' ? '左路' : '中路';
  const oppFlankName = intent.flank === 'right' ? '左路' : '右路';

  switch (intent.pattern) {
    case 'wing_overlap_cut_inside': {
      const targetFlank: Flank = intent.flank === 'center' ? 'left' : intent.flank;
      const fSign = targetFlank === 'left' ? -1 : 1;
      const winger =
        findPlayerByNumber(f1Players, attackTeam, intent.explicitNumber) ??
        findWideAttacker(f1Players, attackTeam, targetFlank)!;
      const fullback = findFullback(f1Players, attackTeam, targetFlank);
      const striker = findStriker(f1Players, attackTeam);
      const farWinger = findWideAttacker(
        f1Players,
        attackTeam,
        targetFlank === 'left' ? 'right' : 'left'
      );
      const pivot = findPlaymaker(f1Players, attackTeam);

      // Step 1: Winger receives ball wide & dribbles inside into half-space
      const w0 = { x: winger.x, y: winger.y };
      const w1 = {
        x: clamp(w0.x + dir * 9, 15, 86),
        y: clamp(w0.y - fSign * 13, 24, 76),
      };
      winger.x = w1.x;
      winger.y = w1.y;
      f1Ball.x = w1.x + dir * 1.8;
      f1Ball.y = w1.y;
      f1Ball.holderId = winger.id;
      f1Annotations.push(makeMoveAnnotation('w-drib', 'dribble', w0, w1, attackTeam, '持球內切'));

      // Fullback begins overlap run along touchline
      if (fullback && fullback.id !== winger.id) {
        const fb0 = { x: fullback.x, y: fullback.y };
        const fb1 = {
          x: clamp(w1.x - dir * 2, 12, 84),
          y: clamp(targetFlank === 'left' ? 11 : 89, 8, 92),
        };
        fullback.x = fb1.x;
        fullback.y = fb1.y;
        f1Annotations.push(makeMoveAnnotation('fb-run1', 'run', fb0, fb1, attackTeam, '無球套邊'));
      }

      // Striker pins central defender toward far post
      if (striker && striker.id !== winger.id) {
        const st0 = { x: striker.x, y: striker.y };
        const st1 = { x: clamp(st0.x + dir * 12, 18, 90), y: clamp(50 - fSign * 6, 36, 64) };
        striker.x = st1.x;
        striker.y = st1.y;
        f1Annotations.push(makeMoveAnnotation('st-pin', 'run', st0, st1, attackTeam, '牽制中衛'));
      }

      // Defending shift for Step 1
      f1Annotations.push(
        ...applyBallOrientedDefenseShift(f0Players, f1Players, defendTeam, f1Ball, format, 'compact')
      );

      // Step 2: Copy Step 1 positions to Step 2 and finish overlap pass + far-side crash
      f2Players.forEach((p, idx) => {
        p.x = f1Players[idx].x;
        p.y = f1Players[idx].y;
      });

      const w2Target = findPlayerByNumber(f2Players, attackTeam, winger.number) ?? f2Players[0];
      const fb2 = fullback ? f2Players.find((p) => p.id === fullback.id) : undefined;
      const far2 = farWinger ? f2Players.find((p) => p.id === farWinger.id) : undefined;
      const piv2 = pivot ? f2Players.find((p) => p.id === pivot.id) : undefined;

      if (fb2) {
        const fbMid = { x: fb2.x, y: fb2.y };
        fb2.x = clamp(w2Target.x + dir * 13, 18, 91);
        fb2.y = clamp(targetFlank === 'left' ? 10 : 90, 7, 93);
        f2Annotations.push(makeMoveAnnotation('fb-run2', 'run', fbMid, { x: fb2.x, y: fb2.y }, attackTeam));
        f2Annotations.push(
          makeMoveAnnotation('pass-overlap', 'pass', { x: w2Target.x, y: w2Target.y }, { x: fb2.x, y: fb2.y }, attackTeam, '分球套邊')
        );
        f2Ball.x = fb2.x + dir * 1.6;
        f2Ball.y = fb2.y;
        f2Ball.holderId = fb2.id;
      }

      if (far2 && far2.id !== w2Target.id) {
        const farMid = { x: far2.x, y: far2.y };
        far2.x = clamp(farMid.x + dir * 16, 20, 89);
        far2.y = clamp(50 - fSign * 14, 28, 72);
        f2Annotations.push(makeMoveAnnotation('far-crash', 'run', farMid, { x: far2.x, y: far2.y }, attackTeam, '弱側斜插'));
      }

      if (piv2 && piv2.id !== w2Target.id) {
        const pivMid = { x: piv2.x, y: piv2.y };
        piv2.x = clamp(w2Target.x - dir * 8, 20, 78);
        piv2.y = clamp(50 + fSign * 8, 34, 66);
        f2Annotations.push(makeMoveAnnotation('piv-rest', 'run', pivMid, { x: piv2.x, y: piv2.y }, attackTeam, '肋部保護'));
      }

      f2Annotations.push(
        ...applyBallOrientedDefenseShift(f1Players, f2Players, defendTeam, f2Ball, format, 'compact')
      );

      analysis = {
        summary: `${targetFlank === 'left' ? '左路' : '右路'}邊翼持球內切肋部，同側邊後衛高速套邊接應，形成邊路 2 打 1 並拉動防線橫移。`,
        ballStateLabel: `持球進攻 · ${targetFlank === 'left' ? '左' : '右'}側肋部內切與套邊`,
        phase: 'on-ball',
        onBallAction: `#${winger.number}（${winger.label}）持球向內線肋部推進吸引對方邊後衛內收，觀察套邊時機送出斜塞球。`,
        offBallAttackShift: `持球內切肋部，同側後衛套邊，中鋒牽制中衛。`,
        defenseShift: `近側上搶與邊路協防，防線向球側橫移內收。`,
        coachingCue: `內切帶球角度朝向對方門柱吸引雙人包夾，為邊線套邊隊友製造傳中空間。`,
        detectedIntent: '持球內切 + 無球套邊重疊（Overlap）',
      };
      break;
    }

    case 'through_ball_third_man': {
      const carrier =
        findPlayerByNumber(f1Players, attackTeam, intent.explicitNumber) ??
        findPlaymaker(f1Players, attackTeam)!;
      const striker = findStriker(f1Players, attackTeam);
      const runner =
        findWideAttacker(f1Players, attackTeam, intent.flank === 'right' ? 'right' : 'left') ??
        striker!;

      const c0 = { x: carrier.x, y: carrier.y };
      const c1 = { x: clamp(c0.x + dir * 7, 20, 75), y: clamp(50 + flankSign * 5, 32, 68) };
      carrier.x = c1.x;
      carrier.y = c1.y;
      f1Ball.x = c1.x + dir * 1.8;
      f1Ball.y = c1.y;
      f1Ball.holderId = carrier.id;
      f1Annotations.push(makeMoveAnnotation('c-adv', 'dribble', c0, c1, attackTeam, '持球吸引'));

      // Striker checks short to draw CB out
      if (striker && striker.id !== carrier.id) {
        const st0 = { x: striker.x, y: striker.y };
        const st1 = { x: clamp(st0.x - dir * 7, 25, 78), y: clamp(50 - flankSign * 6, 36, 64) };
        striker.x = st1.x;
        striker.y = st1.y;
        f1Annotations.push(makeMoveAnnotation('st-drop', 'run', st0, st1, attackTeam, '回撤帶走中衛'));
      }

      // Third-man runner bends run behind defensive line
      if (runner && runner.id !== carrier.id) {
        const r0 = { x: runner.x, y: runner.y };
        const r1 = { x: clamp(r0.x + dir * 13, 25, 86), y: clamp(50 + flankSign * 14, 24, 76) };
        runner.x = r1.x;
        runner.y = r1.y;
        f1Annotations.push(makeMoveAnnotation('third-run1', 'run', r0, r1, attackTeam, '第三人斜插'));
      }

      f1Annotations.push(
        ...applyBallOrientedDefenseShift(f0Players, f1Players, defendTeam, f1Ball, format, 'press')
      );

      // Step 2: Through ball into space behind defense
      f2Players.forEach((p, idx) => {
        p.x = f1Players[idx].x;
        p.y = f1Players[idx].y;
      });
      const r2 = f2Players.find((p) => p.id === runner.id)!;
      const c2 = f2Players.find((p) => p.id === carrier.id)!;
      const rMid = { x: r2.x, y: r2.y };
      r2.x = clamp(rMid.x + dir * 15, 18, 92);
      r2.y = clamp(50 + flankSign * 10, 26, 74);

      f2Annotations.push(makeMoveAnnotation('third-run2', 'run', rMid, { x: r2.x, y: r2.y }, attackTeam));
      f2Annotations.push(
        makeMoveAnnotation('through-pass', 'pass', { x: c2.x, y: c2.y }, { x: r2.x, y: r2.y }, attackTeam, '直塞身後空檔')
      );
      f2Ball.x = r2.x + dir * 1.5;
      f2Ball.y = r2.y;
      f2Ball.holderId = r2.id;

      f2Annotations.push(
        ...applyBallOrientedDefenseShift(f1Players, f2Players, defendTeam, f2Ball, format, 'compact')
      );

      analysis = {
        summary: `中路持球者推進吸引中場上搶，配合前鋒回撤牽制中衛，為無球第三人創造直塞身後空檔。`,
        ballStateLabel: `持球進攻 · 中路直塞與第三人無球穿插`,
        phase: 'on-ball',
        onBallAction: `#${carrier.number}（${carrier.label}）帶球前壓迫使對方防線猶豫，抓住中衛跟防瞬間送出穿透直塞球。`,
        offBallAttackShift: `中路持球直塞，前鋒回撤牽制，隊友斜插身後。`,
        defenseShift: `後腰上搶持球者，後衛內收補防身後空檔。`,
        coachingCue: `傳跑時機（Timing）：斜插球員應在持球者抬頭觸球前啟動，保持與最後一名後衛平行。`,
        detectedIntent: '中路持球吸引 + 回撤牽制 + 第三人直塞身後',
      };
      break;
    }

    case 'switch_of_play': {
      // Overload on one side, then long diagonal switch to weak side
      const fromFlank: Flank = intent.flank === 'left' ? 'right' : 'left';
      const toFlank: Flank = fromFlank === 'left' ? 'right' : 'left';
      const toSign = toFlank === 'left' ? -1 : 1;

      const carrier =
        findWideAttacker(f1Players, attackTeam, fromFlank) ??
        findPlaymaker(f1Players, attackTeam)!;
      const pivot = findPlaymaker(f1Players, attackTeam)!;
      const weakWinger = findWideAttacker(f1Players, attackTeam, toFlank);
      const weakFB = findFullback(f1Players, attackTeam, toFlank);

      // Step 1: Ball on strong side, pass inside to pivot while weak winger holds maximum width
      const c0 = { x: carrier.x, y: carrier.y };
      f1Ball.x = c0.x + dir * 2;
      f1Ball.y = c0.y;
      f1Ball.holderId = carrier.id;

      const p1 = { x: clamp(c0.x - dir * 4, 22, 74), y: clamp(50 - toSign * 10, 28, 72) };
      pivot.x = p1.x;
      pivot.y = p1.y;
      f1Annotations.push(makeMoveAnnotation('sw-pass1', 'pass', c0, p1, attackTeam, '回做轉移點'));

      if (weakWinger && weakWinger.id !== carrier.id) {
        const ww0 = { x: weakWinger.x, y: weakWinger.y };
        const ww1 = {
          x: clamp(ww0.x + dir * 10, 22, 85),
          y: clamp(toFlank === 'left' ? 9 : 91, 6, 94),
        };
        weakWinger.x = ww1.x;
        weakWinger.y = ww1.y;
        f1Annotations.push(makeMoveAnnotation('ww-wide', 'run', ww0, ww1, attackTeam, '弱側拉最大寬度'));
      }

      f1Annotations.push(
        ...applyBallOrientedDefenseShift(f0Players, f1Players, defendTeam, f1Ball, format, 'compact')
      );

      // Step 2: Switch diagonal ball to weak side winger!
      f2Players.forEach((p, idx) => {
        p.x = f1Players[idx].x;
        p.y = f1Players[idx].y;
      });
      const piv2 = f2Players.find((p) => p.id === pivot.id)!;
      const ww2 = weakWinger ? f2Players.find((p) => p.id === weakWinger.id) : undefined;
      const fb2 = weakFB ? f2Players.find((p) => p.id === weakFB.id) : undefined;

      if (ww2) {
        f2Annotations.push(
          makeMoveAnnotation('sw-diag', 'pass', { x: piv2.x, y: piv2.y }, { x: ww2.x, y: ww2.y }, attackTeam, '大範圍轉移弱側')
        );
        f2Ball.x = ww2.x + dir * 1.6;
        f2Ball.y = ww2.y;
        f2Ball.holderId = ww2.id;
      }
      if (fb2) {
        const fbMid = { x: fb2.x, y: fb2.y };
        fb2.x = clamp(fbMid.x + dir * 12, 20, 78);
        fb2.y = clamp(toFlank === 'left' ? 18 : 82, 12, 88);
        f2Annotations.push(makeMoveAnnotation('fb-support', 'run', fbMid, { x: fb2.x, y: fb2.y }, attackTeam, '支援接應'));
      }

      f2Annotations.push(
        ...applyBallOrientedDefenseShift(f1Players, f2Players, defendTeam, f2Ball, format, 'compact')
      );

      analysis = {
        summary: `於強側吸引對手整體防線橫移壓縮後，透過中路支點迅速大範圍轉移至${toFlank === 'left' ? '左路' : '右路'}弱側，打擊對方橫移不及的邊路空間。`,
        ballStateLabel: `持球進攻 · 強側吸引轉移弱側（Switch of Play）`,
        phase: 'on-ball',
        onBallAction: `強側持球後回做給#${pivot.number}（${pivot.label}），不拖泥帶水以兩腳球直接長傳轉移至遠端邊線。`,
        offBallAttackShift: `強側回做轉移，弱側邊鋒拉寬接應、後衛跟進。`,
        defenseShift: `全隊隨長傳加速橫移換邊，近球邊衛上前延緩。`,
        coachingCue: `弱側球員「先拉寬、再接球」：接球前完成掃描（Scanning），決定直接 1v1 突破或傳中。`,
        detectedIntent: '強弱側轉移（Switch of Play）與防線橫移',
      };
      break;
    }

    case 'build_up_press_break': {
      const gk = f1Players.find((p) => p.team === attackTeam && p.isGK)!;
      const cbs = f1Players.filter(
        (p) => p.team === attackTeam && (p.role === 'CB' || p.role === 'LCB' || p.role === 'RCB' || p.role === 'LB' || p.role === 'RB')
      );
      const dm = findByRoles(f1Players, attackTeam, ['CDM', 'CM', 'LCM']) ?? findPlaymaker(f1Players, attackTeam);

      f1Ball.x = gk.x + dir * 2;
      f1Ball.y = gk.y;
      f1Ball.holderId = gk.id;

      // CBs split wide toward box corners
      cbs.forEach((cb) => {
        const origin = { x: cb.x, y: cb.y };
        if (cb.y < 45) {
          cb.x = clamp(gk.x + dir * 11, 12, 88);
          cb.y = clamp(24, 15, 35);
        } else if (cb.y > 55) {
          cb.x = clamp(gk.x + dir * 11, 12, 88);
          cb.y = clamp(76, 65, 85);
        } else {
          cb.x = clamp(gk.x + dir * 13, 12, 88);
        }
        f1Annotations.push(makeMoveAnnotation(`cb-split-${cb.id}`, 'run', origin, { x: cb.x, y: cb.y }, attackTeam, '拉開出球寬度'));
      });

      // DM drops into diamond pivot pocket
      if (dm) {
        const dm0 = { x: dm.x, y: dm.y };
        dm.x = clamp(gk.x + dir * 21, 18, 82);
        dm.y = 50;
        f1Annotations.push(makeMoveAnnotation('dm-drop', 'run', dm0, { x: dm.x, y: dm.y }, attackTeam, '回撤菱形接應'));
      }

      f1Annotations.push(
        ...applyBallOrientedDefenseShift(f0Players, f1Players, defendTeam, f1Ball, format, 'high-block')
      );

      // Step 2: GK plays to one wide CB -> bypass press to pivot
      f2Players.forEach((p, idx) => {
        p.x = f1Players[idx].x;
        p.y = f1Players[idx].y;
      });
      const targetCB =
        f2Players.find((p) => p.team === attackTeam && (intent.flank === 'right' ? p.y > 60 : p.y < 40)) ??
        f2Players.find((p) => p.team === attackTeam && !p.isGK)!;
      const gk2 = f2Players.find((p) => p.id === gk.id)!;
      const dm2 = dm ? f2Players.find((p) => p.id === dm.id) : undefined;

      f2Annotations.push(
        makeMoveAnnotation('gk-pass', 'pass', { x: gk2.x, y: gk2.y }, { x: targetCB.x, y: targetCB.y }, attackTeam, '門將分邊出球')
      );
      if (dm2) {
        dm2.y = clamp(targetCB.y < 50 ? 40 : 60, 32, 68);
        f2Annotations.push(
          makeMoveAnnotation('cb-to-dm', 'pass', { x: targetCB.x, y: targetCB.y }, { x: dm2.x, y: dm2.y }, attackTeam, '破壓斜傳後腰')
        );
        f2Ball.x = dm2.x + dir * 1.5;
        f2Ball.y = dm2.y;
        f2Ball.holderId = dm2.id;
      } else {
        f2Ball.x = targetCB.x + dir * 1.5;
        f2Ball.y = targetCB.y;
        f2Ball.holderId = targetCB.id;
      }

      f2Annotations.push(
        ...applyBallOrientedDefenseShift(f1Players, f2Players, defendTeam, f2Ball, format, 'high-block')
      );

      analysis = {
        summary: `後場門將與雙中衛拉寬建立三角出球結構，後腰無球回撤至壓迫線後方破除對方高位逼搶。`,
        ballStateLabel: `持球組織 · 後場門將出球破壓迫`,
        phase: 'on-ball',
        onBallAction: `門將持球耐心等待對方前鋒啟動壓迫後，精準分球給拉開至禁區兩側的空檔中衛。`,
        offBallAttackShift: `雙中衛拉寬接球，後腰回撤空檔銜接出球。`,
        defenseShift: `前鋒前壓封鎖路線，中場同步跟緊回撤後腰。`,
        coachingCue: `後腰接球時身體保持半轉身（Open body shape），第一腳觸球即可面向前進方向。`,
        detectedIntent: '後場菱形出球組織與破除高位壓迫',
      };
      break;
    }

    case 'high_press_gegenpress': {
      // Off-ball defending team presses high in final third
      const pressTeam: TeamSide = 'home'; // coach simulates pressing team aggressively
      const buildupTeam: TeamSide = 'away';
      const pressDir = 1;

      const awayGK = f1Players.find((p) => p.team === buildupTeam && p.isGK)!;
      const awayCB =
        findByRoles(f1Players, buildupTeam, ['RCB', 'LCB', 'CB'], intent.flank) ??
        f1Players.find((p) => p.team === buildupTeam && !p.isGK)!;

      // Ball starts with opponent defender in their buildup zone
      f0Ball.x = awayCB.x - 1.5;
      f0Ball.y = awayCB.y;
      f0Ball.holderId = awayCB.id;

      // Step 1: Striker curves run to block switch to GK/other CB, nearest winger & mid step up
      const st = findStriker(f1Players, pressTeam)!;
      const st0 = { x: st.x, y: st.y };
      st.x = clamp(awayCB.x - pressDir * 6, 40, 88);
      st.y = clamp(awayCB.y + (50 - awayCB.y) * 0.25, 22, 78);
      f1Annotations.push(makeMoveAnnotation('st-press', 'press', st0, { x: st.x, y: st.y }, pressTeam, '弧線封鎖回傳線'));

      const flankToPress: Flank = awayCB.y < 50 ? 'left' : 'right';
      const nearWinger = findWideAttacker(f1Players, pressTeam, flankToPress);
      if (nearWinger && nearWinger.id !== st.id) {
        const nw0 = { x: nearWinger.x, y: nearWinger.y };
        nearWinger.x = clamp(awayCB.x - pressDir * 4, 35, 88);
        nearWinger.y = clamp(awayCB.y < 50 ? 18 : 82, 10, 90);
        f1Annotations.push(makeMoveAnnotation('nw-trap', 'press', nw0, { x: nearWinger.x, y: nearWinger.y }, pressTeam, '鎖死邊路出口'));
      }

      const mid = findPlaymaker(f1Players, pressTeam);
      if (mid) {
        const m0 = { x: mid.x, y: mid.y };
        mid.x = clamp(m0.x + pressDir * 14, 35, 78);
        mid.y = clamp(awayCB.y < 50 ? 38 : 62, 28, 72);
        f1Annotations.push(makeMoveAnnotation('mid-push', 'press', m0, { x: mid.x, y: mid.y }, pressTeam, '中場前壓跟緊'));
      }

      // Opponent tries passing to fullback under pressure
      const awayFB = findFullback(f1Players, buildupTeam, flankToPress);
      if (awayFB) {
        f1Ball.x = awayFB.x - 1.5;
        f1Ball.y = awayFB.y;
        f1Ball.holderId = awayFB.id;
        f1Annotations.push(makeMoveAnnotation('away-trap-pass', 'pass', { x: awayCB.x, y: awayCB.y }, { x: awayFB.x, y: awayFB.y }, buildupTeam, '被迫分邊'));
      }

      // Step 2: Pressing trap closes in + rest of team squeezes forward
      f2Players.forEach((p, idx) => {
        p.x = f1Players[idx].x;
        p.y = f1Players[idx].y;
      });
      f2Ball.x = f1Ball.x;
      f2Ball.y = f1Ball.y;
      f2Ball.holderId = f1Ball.holderId;

      f2Players
        .filter((p) => p.team === pressTeam && !p.isGK)
        .forEach((p) => {
          const prev = f1Players.find((o) => o.id === p.id)!;
          if (p.id === nearWinger?.id && awayFB) {
            p.x = clamp(awayFB.x - 3.5, 30, 90);
            p.y = clamp(awayFB.y, 10, 90);
            f2Annotations.push(makeMoveAnnotation(`trap-win-${p.id}`, 'press', { x: prev.x, y: prev.y }, { x: p.x, y: p.y }, pressTeam, '觸發邊線搶斷'));
          } else {
            p.x = clamp(prev.x + pressDir * 8, 25, 86);
            p.y = clamp(prev.y + (f2Ball.y - 50) * 0.25, 14, 86);
            if (Math.hypot(p.x - prev.x, p.y - prev.y) > 2) {
              f2Annotations.push(makeMoveAnnotation(`squeeze-${p.id}`, 'press', { x: prev.x, y: prev.y }, { x: p.x, y: p.y }, pressTeam));
            }
          }
        });

      void awayGK;

      analysis = {
        summary: `無球階段執行前場高位壓迫（High Press / Gegenpressing）：利用弧線跑動切斷橫傳與回傳，將對手逼入邊線壓迫陷阱。`,
        ballStateLabel: `無球防守轉換 · 前場高位逼搶與邊線陷阱`,
        phase: 'off-ball',
        onBallAction: `對手後衛在${flankToPress === 'left' ? '左' : '右'}側半空間受壓，被迫將球傳向視野受限的邊路邊衛。`,
        offBallAttackShift: `對手受壓被迫分向邊路，接應角度受限。`,
        defenseShift: `前鋒弧線封死回傳，邊路與中場前壓鎖死邊線。`,
        coachingCue: `逼搶觸發點（Trigger）：球傳向邊衛且背對進攻方向時，全隊同時啟動三秒反搶壓迫。`,
        detectedIntent: '無球高位壓迫與邊線逼搶陷阱',
      };
      break;
    }

    case 'compact_defensive_shift': {
      // Away or Home ball in flank/midfield -> defending team shifts as compact unit
      const carrier =
        findWideAttacker(f1Players, attackTeam, intent.flank === 'center' ? 'right' : intent.flank) ??
        findPlaymaker(f1Players, attackTeam)!;

      const c0 = { x: carrier.x, y: carrier.y };
      const c1 = {
        x: clamp(c0.x + dir * 10, 22, 78),
        y: clamp(intent.flank === 'left' ? 16 : intent.flank === 'right' ? 84 : 50, 12, 88),
      };
      carrier.x = c1.x;
      carrier.y = c1.y;
      f1Ball.x = c1.x + dir * 1.5;
      f1Ball.y = c1.y;
      f1Ball.holderId = carrier.id;
      f1Annotations.push(makeMoveAnnotation('opp-carry', 'dribble', c0, c1, attackTeam, '推進持球'));

      f1Annotations.push(
        ...applyBallOrientedDefenseShift(f0Players, f1Players, defendTeam, f1Ball, format, 'compact')
      );

      // Step 2: Further advance + full defensive compactness shift
      f2Players.forEach((p, idx) => {
        p.x = f1Players[idx].x;
        p.y = f1Players[idx].y;
      });
      const c2 = f2Players.find((p) => p.id === carrier.id)!;
      const cMid = { x: c2.x, y: c2.y };
      c2.x = clamp(cMid.x + dir * 7, 18, 82);
      f2Ball.x = c2.x + dir * 1.5;
      f2Ball.y = c2.y;
      f2Ball.holderId = c2.id;
      f2Annotations.push(makeMoveAnnotation('opp-carry2', 'dribble', cMid, { x: c2.x, y: c2.y }, attackTeam));

      f2Annotations.push(
        ...applyBallOrientedDefenseShift(f1Players, f2Players, defendTeam, f2Ball, format, 'compact')
      );

      analysis = {
        summary: `無球防守階段依球所在位置實施鏈式橫移緊縮：近球側一人施壓延緩，其餘隊友封鎖肋部與內線通道，遠側內收保護門前。`,
        ballStateLabel: `無球防守 · 鏈式防線橫移與肋部保護`,
        phase: 'off-ball',
        onBallAction: `${attackTeam === 'home' ? '進攻方' : '對手'}沿${flankName}推進試圖拉扯防線寬度或尋找內切滲透空檔。`,
        offBallAttackShift: `邊路持球推進，無球隊友於肋部與弱側接應。`,
        defenseShift: `近球者上搶阻斷內線，全隊橫移緊縮、遠側內收。`,
        coachingCue: `防守紀律三原則：近者施壓（Pressure）、鄰者保護（Cover）、遠者平衡內收（Balance）。`,
        detectedIntent: '無球防守鏈式橫移與陣型緊縮',
      };
      break;
    }

    case 'offball_decoy_rotation': {
      // Off-ball movement: Striker pulls wide to drag CB, CAM/CM surges into half-space pocket
      const carrier = findPlaymaker(f1Players, attackTeam) ?? findFullback(f1Players, attackTeam, 'left')!;
      const striker = findStriker(f1Players, attackTeam)!;
      const cam =
        findByRoles(f1Players, attackTeam, ['CAM', 'RCM', 'LCM', 'CM']) ??
        f1Players.find((p) => p.team === attackTeam && !p.isGK && p.id !== striker.id && p.id !== carrier.id)!;
      const farWinger = findWideAttacker(
        f1Players,
        attackTeam,
        intent.flank === 'left' ? 'right' : 'left'
      );

      f1Ball.x = carrier.x + dir * 1.6;
      f1Ball.y = carrier.y;
      f1Ball.holderId = carrier.id;

      // Step 1: Striker runs diagonally wide to pull CB out of channel
      const st0 = { x: striker.x, y: striker.y };
      const st1 = {
        x: clamp(st0.x + dir * 6, 20, 86),
        y: clamp(50 + flankSign * 26, 14, 86),
      };
      striker.x = st1.x;
      striker.y = st1.y;
      f1Annotations.push(makeMoveAnnotation('st-decoy', 'run', st0, st1, attackTeam, '無球拉邊牽制'));

      // CAM runs into vacated central/half-space channel
      if (cam && cam.id !== striker.id) {
        const cam0 = { x: cam.x, y: cam.y };
        const cam1 = {
          x: clamp(st0.x + dir * 4, 22, 84),
          y: clamp(50 + flankSign * 8, 34, 66),
        };
        cam.x = cam1.x;
        cam.y = cam1.y;
        f1Annotations.push(makeMoveAnnotation('cam-surge', 'run', cam0, cam1, attackTeam, '前插肋部空檔'));
      }

      // Far winger tucks in toward penalty spot
      if (farWinger && farWinger.id !== striker.id && farWinger.id !== cam?.id) {
        const fw0 = { x: farWinger.x, y: farWinger.y };
        const fw1 = {
          x: clamp(fw0.x + dir * 11, 20, 86),
          y: clamp(50 - flankSign * 14, 26, 74),
        };
        farWinger.x = fw1.x;
        farWinger.y = fw1.y;
        f1Annotations.push(makeMoveAnnotation('fw-tuck', 'run', fw0, fw1, attackTeam, '遠側內收埋伏'));
      }

      f1Annotations.push(
        ...applyBallOrientedDefenseShift(f0Players, f1Players, defendTeam, f1Ball, format, 'compact')
      );

      // Step 2: Ball delivered into the vacated channel for CAM
      f2Players.forEach((p, idx) => {
        p.x = f1Players[idx].x;
        p.y = f1Players[idx].y;
      });
      const cam2 = cam ? f2Players.find((p) => p.id === cam.id) : undefined;
      const car2 = f2Players.find((p) => p.id === carrier.id)!;
      if (cam2) {
        const camMid = { x: cam2.x, y: cam2.y };
        cam2.x = clamp(camMid.x + dir * 9, 18, 90);
        f2Annotations.push(makeMoveAnnotation('cam-surge2', 'run', camMid, { x: cam2.x, y: cam2.y }, attackTeam));
        f2Annotations.push(
          makeMoveAnnotation('pass-pocket', 'pass', { x: car2.x, y: car2.y }, { x: cam2.x, y: cam2.y }, attackTeam, '送入牽制後空檔')
        );
        f2Ball.x = cam2.x + dir * 1.5;
        f2Ball.y = cam2.y;
        f2Ball.holderId = cam2.id;
      }

      f2Annotations.push(
        ...applyBallOrientedDefenseShift(f1Players, f2Players, defendTeam, f2Ball, format, 'compact')
      );

      analysis = {
        summary: `利用無球前鋒斜向拉邊製造牽制（Decoy Run），誘使對方中衛跟防離位，再由中場前插搶占清空的肋部通道。`,
        ballStateLabel: `無球進攻組織 · 無球牽制與交叉前插`,
        phase: 'off-ball',
        onBallAction: `#${carrier.number}（${carrier.label}）持球延緩節奏等待隊友無球交叉跑位完成，隨即傳入被清空的半空間。`,
        offBallAttackShift: `#${striker.number}前鋒主動斜向拉邊帶開中衛；#${cam?.number ?? ''}中場從二線無球高速前插空檔；${oppFlankName}遠側翼鋒內收準備接應二點。`,
        defenseShift: `防守中衛面臨兩難：若緊跟前鋒拉邊則肋部洞開，若留守中路則必須由後腰深度追蹤前插中場，兩者溝通稍慢即產生射門空檔。`,
        coachingCue: `無球跑動的價值在於「為隊友清空空間」或「替自己創造空間」，兩人啟動方向必須形成交叉角度。`,
        detectedIntent: '無球拉邊牽制 + 中場插上肋部',
      };
      break;
    }

    case 'custom_player_action':
    default: {
      const actor =
        findPlayerByNumber(f1Players, attackTeam, intent.explicitNumber) ??
        findPlayerByNumber(f1Players, attackTeam, currentBall.holderId ? parseInt(currentBall.holderId.split('-')[1], 10) : null) ??
        findPlaymaker(f1Players, attackTeam)!;

      const target =
        findPlayerByNumber(f1Players, attackTeam, intent.targetNumber) ??
        (intent.flank !== 'center'
          ? findWideAttacker(f1Players, attackTeam, intent.flank)
          : findStriker(f1Players, attackTeam));

      const a0 = { x: actor.x, y: actor.y };
      const dy =
        intent.flank === 'left' ? -10 : intent.flank === 'right' ? 10 : actor.y < 50 ? 6 : -6;
      const dx = intent.wantsDrop ? -dir * 6 : dir * 10;

      actor.x = clamp(a0.x + dx, 12, 86);
      actor.y = clamp(a0.y + dy, 12, 88);

      if (intent.effectiveMode === 'on-ball') {
        f1Ball.x = actor.x + dir * 1.6;
        f1Ball.y = actor.y;
        f1Ball.holderId = actor.id;
        f1Annotations.push(
          makeMoveAnnotation('act-drib', 'dribble', a0, { x: actor.x, y: actor.y }, attackTeam, `#${actor.number} 持球推進`)
        );
      } else {
        f1Annotations.push(
          makeMoveAnnotation('act-run', 'run', a0, { x: actor.x, y: actor.y }, attackTeam, `#${actor.number} 無球跑位`)
        );
      }

      // Supporting teammates adjust
      const support = f1Players
        .filter((p) => p.team === attackTeam && !p.isGK && p.id !== actor.id)
        .sort((a, b) => Math.hypot(a.x - actor.x, a.y - actor.y) - Math.hypot(b.x - actor.x, b.y - actor.y))
        .slice(0, 2);

      support.forEach((sp, i) => {
        const sp0 = { x: sp.x, y: sp.y };
        sp.x = clamp(sp0.x + dir * (i === 0 ? 8 : 5), 14, 88);
        sp.y = clamp(sp0.y + (sp0.y < actor.y ? -4 : 4), 10, 90);
        f1Annotations.push(
          makeMoveAnnotation(`sup-${sp.id}`, 'run', sp0, { x: sp.x, y: sp.y }, attackTeam, i === 0 ? '接應跑位' : undefined)
        );
      });

      f1Annotations.push(
        ...applyBallOrientedDefenseShift(f0Players, f1Players, defendTeam, f1Ball, format, 'compact')
      );

      // Step 2: Pass or further shift
      f2Players.forEach((p, idx) => {
        p.x = f1Players[idx].x;
        p.y = f1Players[idx].y;
      });
      const actor2 = f2Players.find((p) => p.id === actor.id)!;
      const target2 = target && target.id !== actor.id ? f2Players.find((p) => p.id === target.id) : undefined;

      if (target2) {
        const tMid = { x: target2.x, y: target2.y };
        target2.x = clamp(tMid.x + dir * 7, 16, 90);
        f2Annotations.push(makeMoveAnnotation('t2-run', 'run', tMid, { x: target2.x, y: target2.y }, attackTeam, '前插接應'));
        f2Annotations.push(
          makeMoveAnnotation('t2-pass', 'pass', { x: actor2.x, y: actor2.y }, { x: target2.x, y: target2.y }, attackTeam, '傳球連線')
        );
        f2Ball.x = target2.x + dir * 1.5;
        f2Ball.y = target2.y;
        f2Ball.holderId = target2.id;
      } else {
        f2Ball.x = actor2.x + dir * 1.5;
        f2Ball.y = actor2.y;
        f2Ball.holderId = actor2.id;
      }

      f2Annotations.push(
        ...applyBallOrientedDefenseShift(f1Players, f2Players, defendTeam, f2Ball, format, 'compact')
      );

      analysis = {
        summary: `依指令演算 #${actor.number}（${actor.label}）於${flankName}的${intent.effectiveMode === 'on-ball' ? '持球推進與傳接' : '無球移位'}，並同步模擬無球隊友接應三角與防守方聯動橫移。`,
        ballStateLabel: `${intent.effectiveMode === 'on-ball' ? '持球推演' : '無球推演'} · #${actor.number} ${actor.label}（${flankName}）`,
        phase: intent.effectiveMode,
        onBallAction: `#${actor.number}（${actor.label}）於${flankName}移動創造傳球角度${target2 ? `，將球推進/分給 #${target2.number}（${target2.label}）` : ''}。`,
        offBallAttackShift: `持球推進分球，鄰近隊友拉開三角接應。`,
        defenseShift: `防守方隨球權移動進行球向壓縮：最近防守球員上前延緩壓迫，防線其餘成員向${flankName}橫移並內收保護門前中軸。`,
        coachingCue: `每次持球與無球移位都要檢視「接應距離（10–15 公尺）」與「對角線傳球視野」。`,
        detectedIntent: prompt.trim() || `#${actor.number} ${flankName}戰術推演`,
      };
      break;
    }
  }

  const keyframes: TacticalKeyframe[] = [
    {
      id: 'kf-0',
      title: '1. 初始對位',
      description: '攻守雙方起始陣型站位與球權位置',
      phase: 'setup',
      players: f0Players,
      ball: f0Ball,
      annotations: [],
      durationMs: 900,
    },
    {
      id: 'kf-1',
      title: '2. 觸發跑位與壓迫',
      description: analysis.onBallAction,
      phase: intent.effectiveMode,
      players: f1Players,
      ball: f1Ball,
      annotations: f1Annotations,
      durationMs: 1400,
    },
    {
      id: 'kf-2',
      title: '3. 攻守移位完成',
      description: analysis.defenseShift,
      phase: intent.effectiveMode,
      players: f2Players,
      ball: f2Ball,
      annotations: f2Annotations,
      durationMs: 1400,
    },
  ];

  return { keyframes, analysis };
}

export function interpolateKeyframes(
  from: TacticalKeyframe,
  to: TacticalKeyframe,
  t: number
): { players: PlayerToken[]; ball: BallState } {
  const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const players = to.players.map((tp) => {
    const fp = from.players.find((p) => p.id === tp.id);
    if (!fp) return tp;
    return {
      ...tp,
      x: fp.x + (tp.x - fp.x) * ease,
      y: fp.y + (tp.y - fp.y) * ease,
    };
  });

  const ball: BallState = {
    x: from.ball.x + (to.ball.x - from.ball.x) * ease,
    y: from.ball.y + (to.ball.y - from.ball.y) * ease,
    holderId: ease > 0.85 ? to.ball.holderId : from.ball.holderId,
  };

  return { players, ball };
}
