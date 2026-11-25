import type {
  BallState,
  FormationPreset,
  PitchFormat,
  PlayerToken,
  TacticalScenarioPreset,
  TeamSide,
} from '../types/tactics';

export const FORMATIONS: FormationPreset[] = [
  // ================= 8v8 FORMATIONS =================
  {
    id: '8v8-2-3-2',
    name: '2-3-2（均衡三角）',
    format: '8v8',
    description: '雙中衛保護門前，三中場形成三角接應，雙前鋒拉扯空間。',
    slots: [
      { number: 1, role: 'GK', label: '門將', x: 6, y: 50, isGK: true },
      { number: 4, role: 'LCB', label: '左後衛', x: 22, y: 31 },
      { number: 5, role: 'RCB', label: '右後衛', x: 22, y: 69 },
      { number: 11, role: 'LM', label: '左翼衛', x: 40, y: 18 },
      { number: 6, role: 'CM', label: '中前衛', x: 37, y: 50 },
      { number: 7, role: 'RM', label: '右翼衛', x: 40, y: 82 },
      { number: 9, role: 'ST', label: '左前鋒', x: 56, y: 36 },
      { number: 10, role: 'CF', label: '右前鋒', x: 56, y: 64 },
    ],
  },
  {
    id: '8v8-3-2-2',
    name: '3-2-2（三後衛組織）',
    format: '8v8',
    description: '三名後衛提供穩定後場寬度與出球三角，雙中場控制肋部。',
    slots: [
      { number: 1, role: 'GK', label: '門將', x: 6, y: 50, isGK: true },
      { number: 3, role: 'LB', label: '左邊衛', x: 23, y: 20 },
      { number: 4, role: 'CB', label: '中衛', x: 19, y: 50 },
      { number: 2, role: 'RB', label: '右邊衛', x: 23, y: 80 },
      { number: 6, role: 'LCM', label: '左中場', x: 39, y: 36 },
      { number: 8, role: 'RCM', label: '右中場', x: 39, y: 64 },
      { number: 10, role: 'ST', label: '左前鋒', x: 55, y: 35 },
      { number: 9, role: 'CF', label: '右前鋒', x: 55, y: 65 },
    ],
  },
  {
    id: '8v8-3-3-1',
    name: '3-3-1（控球壓迫）',
    format: '8v8',
    description: '單箭頭牽制中衛，三中場前後層次分明，邊衛可積極套邊。',
    slots: [
      { number: 1, role: 'GK', label: '門將', x: 6, y: 50, isGK: true },
      { number: 3, role: 'LB', label: '左後衛', x: 22, y: 21 },
      { number: 4, role: 'CB', label: '中衛', x: 19, y: 50 },
      { number: 2, role: 'RB', label: '右後衛', x: 22, y: 79 },
      { number: 11, role: 'LW', label: '左翼', x: 40, y: 20 },
      { number: 8, role: 'CAM', label: '前腰', x: 39, y: 50 },
      { number: 7, role: 'RW', label: '右翼', x: 40, y: 80 },
      { number: 9, role: 'ST', label: '中鋒', x: 57, y: 50 },
    ],
  },
  {
    id: '8v8-2-4-1',
    name: '2-4-1（菱形中場）',
    format: '8v8',
    description: '菱形四中場強化中路傳導與高位反搶密度。',
    slots: [
      { number: 1, role: 'GK', label: '門將', x: 6, y: 50, isGK: true },
      { number: 4, role: 'LCB', label: '左中衛', x: 20, y: 34 },
      { number: 5, role: 'RCB', label: '右中衛', x: 20, y: 66 },
      { number: 6, role: 'CDM', label: '後腰', x: 32, y: 50 },
      { number: 11, role: 'LM', label: '左中場', x: 41, y: 18 },
      { number: 7, role: 'RM', label: '右中場', x: 41, y: 82 },
      { number: 10, role: 'CAM', label: '前腰', x: 47, y: 50 },
      { number: 9, role: 'ST', label: '前鋒', x: 59, y: 50 },
    ],
  },

  // ================= 11v11 FORMATIONS =================
  {
    id: '11v11-4-3-3',
    name: '4-3-3（進攻寬度與內切）',
    format: '11v11',
    description: '雙邊鋒拉開或內切，邊後衛套邊支援，單後腰串聯三中場。',
    slots: [
      { number: 1, role: 'GK', label: '門將', x: 5, y: 50, isGK: true },
      { number: 3, role: 'LB', label: '左後衛', x: 21, y: 16 },
      { number: 4, role: 'LCB', label: '左中衛', x: 18, y: 38 },
      { number: 5, role: 'RCB', label: '右中衛', x: 18, y: 62 },
      { number: 2, role: 'RB', label: '右後衛', x: 21, y: 84 },
      { number: 6, role: 'CDM', label: '後腰', x: 31, y: 50 },
      { number: 8, role: 'LCM', label: '左中場', x: 39, y: 31 },
      { number: 10, role: 'RCM', label: '右中場', x: 39, y: 69 },
      { number: 11, role: 'LW', label: '左邊鋒', x: 53, y: 17 },
      { number: 9, role: 'ST', label: '中鋒', x: 57, y: 50 },
      { number: 7, role: 'RW', label: '右邊鋒', x: 53, y: 83 },
    ],
  },
  {
    id: '11v11-4-2-3-1',
    name: '4-2-3-1（雙後腰與10號位）',
    format: '11v11',
    description: '雙後腰保護肋部身後，10號前腰主導直塞與半空間滲透。',
    slots: [
      { number: 1, role: 'GK', label: '門將', x: 5, y: 50, isGK: true },
      { number: 3, role: 'LB', label: '左後衛', x: 20, y: 16 },
      { number: 4, role: 'LCB', label: '左中衛', x: 17, y: 38 },
      { number: 5, role: 'RCB', label: '右中衛', x: 17, y: 62 },
      { number: 2, role: 'RB', label: '右後衛', x: 20, y: 84 },
      { number: 6, role: 'CDM', label: '左後腰', x: 31, y: 38 },
      { number: 8, role: 'CDM', label: '右後腰', x: 31, y: 62 },
      { number: 11, role: 'LW', label: '左前衛', x: 45, y: 18 },
      { number: 10, role: 'CAM', label: '前腰', x: 45, y: 50 },
      { number: 7, role: 'RW', label: '右前衛', x: 45, y: 82 },
      { number: 9, role: 'ST', label: '中鋒', x: 58, y: 50 },
    ],
  },
  {
    id: '11v11-4-4-2',
    name: '4-4-2（雙層四線緊縮）',
    format: '11v11',
    description: '防線橫移與雙前鋒封鎖中路傳導的經典防守與反擊陣型。',
    slots: [
      { number: 1, role: 'GK', label: '門將', x: 5, y: 50, isGK: true },
      { number: 3, role: 'LB', label: '左後衛', x: 20, y: 16 },
      { number: 4, role: 'LCB', label: '左中衛', x: 18, y: 38 },
      { number: 5, role: 'RCB', label: '右中衛', x: 18, y: 62 },
      { number: 2, role: 'RB', label: '右後衛', x: 20, y: 84 },
      { number: 11, role: 'LM', label: '左中場', x: 37, y: 16 },
      { number: 6, role: 'LCM', label: '左中前衛', x: 35, y: 39 },
      { number: 8, role: 'RCM', label: '右中前衛', x: 35, y: 61 },
      { number: 7, role: 'RM', label: '右中場', x: 37, y: 84 },
      { number: 9, role: 'ST', label: '左前鋒', x: 54, y: 39 },
      { number: 10, role: 'CF', label: '右前鋒', x: 54, y: 61 },
    ],
  },
  {
    id: '11v11-3-5-2',
    name: '3-5-2（翼衛寬度與中場人數）',
    format: '11v11',
    description: '三中衛撐起後場出球，雙翼衛上下往返拉開全寬度。',
    slots: [
      { number: 1, role: 'GK', label: '門將', x: 5, y: 50, isGK: true },
      { number: 4, role: 'LCB', label: '左中衛', x: 19, y: 29 },
      { number: 5, role: 'CB', label: '拖後中衛', x: 16, y: 50 },
      { number: 2, role: 'RCB', label: '右中衛', x: 19, y: 71 },
      { number: 3, role: 'LWB', label: '左翼衛', x: 36, y: 12 },
      { number: 6, role: 'CDM', label: '後腰', x: 32, y: 50 },
      { number: 8, role: 'LCM', label: '左中場', x: 40, y: 34 },
      { number: 10, role: 'RCM', label: '右中場', x: 40, y: 66 },
      { number: 7, role: 'RWB', label: '右翼衛', x: 36, y: 88 },
      { number: 9, role: 'ST', label: '左前鋒', x: 56, y: 38 },
      { number: 11, role: 'CF', label: '右前鋒', x: 56, y: 62 },
    ],
  },
];

export function getFormationsForFormat(format: PitchFormat): FormationPreset[] {
  return FORMATIONS.filter((f) => f.format === format);
}

export function instantiateTeam(
  formationId: string,
  team: TeamSide
): PlayerToken[] {
  const preset = FORMATIONS.find((f) => f.id === formationId) ?? FORMATIONS[0];
  return preset.slots.map((slot) => {
    const x = team === 'home' ? slot.x : 100 - slot.x;
    const y = team === 'home' ? slot.y : 100 - slot.y;
    return {
      id: `${team}-${slot.number}-${slot.role}`,
      team,
      number: slot.number,
      role: slot.role,
      label: slot.label,
      x,
      y,
      isGK: slot.isGK,
    };
  });
}

export function createInitialBall(players: PlayerToken[]): BallState {
  // Attach to central midfielder or pivot of home team
  const carrier =
    players.find(
      (p) =>
        p.team === 'home' &&
        (p.role === 'CM' || p.role === 'CDM' || p.role === 'CAM' || p.role === 'LCM')
    ) ?? players.find((p) => p.team === 'home' && !p.isGK);

  if (carrier) {
    return {
      x: carrier.x + 1.8,
      y: carrier.y,
      holderId: carrier.id,
    };
  }
  return { x: 50, y: 50, holderId: null };
}

export const TACTICAL_PRESETS: TacticalScenarioPreset[] = [
  {
    id: 'wing-overlap-left',
    title: '左路邊鋒內切 + 邊後衛套邊',
    format: '11v11',
    mode: 'on-ball',
    command: '左邊鋒持球內切肋部，左後衛套邊重疊接應，中鋒牽制中衛，觀察防守右路聯動補位',
    tag: '持球進攻',
  },
  {
    id: 'center-through-third-man',
    title: '中路10號直塞 + 第三人斜插',
    format: 'both',
    mode: 'on-ball',
    command: '10號中路持球吸引壓迫後直塞肋部空檔，前鋒回撤牽制，無球邊鋒斜插身後',
    tag: '持球穿透',
  },
  {
    id: 'switch-weak-side',
    title: '右路吸引壓迫 → 轉移左路弱側',
    format: 'both',
    mode: 'on-ball',
    command: '右路持球吸引防守壓縮後大範圍轉移至左路弱側空檔，左翼迅速拉寬接應，防守防線橫移',
    tag: '持球轉移',
  },
  {
    id: 'offball-decoy-run',
    title: '無球中鋒拉邊牽制 + 中場前插肋部',
    format: 'both',
    mode: 'off-ball',
    command: '無球階段中鋒斜向拉邊帶走對方中衛，前腰無球前插肋部空檔接應，遠側邊鋒內收埋伏',
    tag: '無球跑位',
  },
  {
    id: 'high-press-gegenpress',
    title: '前場丟球立即反搶（高位壓迫）',
    format: 'both',
    mode: 'off-ball',
    command: '無球防守時前場立即高位逼搶，前鋒弧線封鎖回傳線，同側中場與邊衛向前壓迫鎖死邊路',
    tag: '無球逼搶',
  },
  {
    id: 'compact-defensive-shift',
    title: '對手右路推進：全隊鏈式橫移緊縮',
    format: 'both',
    mode: 'off-ball',
    command: '對手在邊路持球推進時，無球防守方全隊向球側橫移緊縮，近側上搶施壓、遠側內收保護肋部',
    tag: '防守聯動',
  },
  {
    id: '8v8-buildup-triangle',
    title: '8人制後場門將出球三角破壓迫',
    format: '8v8',
    mode: 'on-ball',
    command: '8人制後場門將與雙中衛拉寬建立三角出球，後腰無球回撤接應破除對方高位逼搶',
    tag: '8v8 出球',
  },
  {
    id: '8v8-wing-rotation',
    title: '8人制2-3-2邊翼衛推進與雙鋒交叉',
    format: '8v8',
    mode: 'on-ball',
    command: '8人制左翼衛持球沿邊線推進，雙前鋒無球交叉跑位拉開中路，觀察防守3人防線橫移補位',
    tag: '8v8 進攻',
  },
];
