import type { PitchFormat } from '../types/tactics';

export interface PitchSpec {
  format: PitchFormat;
  label: string;
  subtitle: string;
  playersPerTeam: number;
  lengthM: number;
  widthM: number;
  penaltyAreaDepthM: number;
  penaltyAreaWidthM: number;
  goalAreaDepthM: number;
  goalAreaWidthM: number;
  penaltySpotM: number;
  penaltyArcRadiusM: number;
  centerCircleRadiusM: number;
  cornerRadiusM: number;
  goalWidthM: number;
}

export const PITCH_SPECS: Record<PitchFormat, PitchSpec> = {
  '8v8': {
    format: '8v8',
    label: '8人制場地',
    subtitle: '65m × 45m（基層少足 8v8 標準比例）',
    playersPerTeam: 8,
    lengthM: 65,
    widthM: 45,
    penaltyAreaDepthM: 12,
    penaltyAreaWidthM: 26,
    goalAreaDepthM: 4,
    goalAreaWidthM: 12,
    penaltySpotM: 9,
    penaltyArcRadiusM: 7,
    centerCircleRadiusM: 7,
    cornerRadiusM: 1,
    goalWidthM: 5,
  },
  '11v11': {
    format: '11v11',
    label: '11人制場地',
    subtitle: '105m × 68m（FIFA 標準 11v11 比例）',
    playersPerTeam: 11,
    lengthM: 105,
    widthM: 68,
    penaltyAreaDepthM: 16.5,
    penaltyAreaWidthM: 40.32,
    goalAreaDepthM: 5.5,
    goalAreaWidthM: 18.32,
    penaltySpotM: 11,
    penaltyArcRadiusM: 9.15,
    centerCircleRadiusM: 9.15,
    cornerRadiusM: 1,
    goalWidthM: 7.32,
  },
};

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function distanceNorm(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  format: PitchFormat
): number {
  const spec = PITCH_SPECS[format];
  const dx = ((ax - bx) / 100) * spec.lengthM;
  const dy = ((ay - by) / 100) * spec.widthM;
  return Math.hypot(dx, dy);
}
