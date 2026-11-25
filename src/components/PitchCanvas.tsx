import { useCallback, useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { PITCH_SPECS, clamp } from '../data/pitchSpecs';
import { computeSpatialGrid } from '../engine/spatialModel';
import type { HeatmapLayer } from '../engine/spatialModel';
import type {
  BallState,
  DrawingAnnotation,
  PitchFormat,
  PlayerToken,
} from '../types/tactics';

export type PitchOrientation = 'horizontal' | 'vertical';

interface PitchCanvasProps {
  format: PitchFormat;
  orientation?: PitchOrientation;
  fullscreen?: boolean;
  players: PlayerToken[];
  ball: BallState;
  annotations: DrawingAnnotation[];
  heatmapLayer: HeatmapLayer;
  onMovePlayer: (id: string, x: number, y: number) => void;
  onMoveBall: (x: number, y: number, holderId: string | null) => void;
  onCanvasInteract?: () => void;
}

const SCALE = 10;

function buildWavyPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 6) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const nx = -dy / len;
  const ny = dx / len;
  const segments = Math.max(4, Math.floor(len / 18));
  const amp = 4;
  let d = `M ${x1} ${y1}`;
  for (let i = 0; i < segments; i++) {
    const tMid = (i + 0.5) / segments;
    const tEnd = (i + 1) / segments;
    const sign = i % 2 === 0 ? 1 : -1;
    const cx = x1 + dx * tMid + nx * amp * sign;
    const cy = y1 + dy * tMid + ny * amp * sign;
    const ex = x1 + dx * tEnd;
    const ey = y1 + dy * tEnd;
    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  }
  return d;
}

export function PitchCanvas({
  format,
  orientation = 'horizontal',
  fullscreen = false,
  players,
  ball,
  annotations,
  heatmapLayer,
  onMovePlayer,
  onMoveBall,
  onCanvasInteract,
}: PitchCanvasProps) {
  const spec = PITCH_SPECS[format];
  const isVertical = orientation === 'vertical';
  const pad = fullscreen ? 22 : 28;

  const pitchLen = spec.lengthM * SCALE;
  const pitchWid = spec.widthM * SCALE;
  const boardW = isVertical ? pitchWid : pitchLen;
  const boardH = isVertical ? pitchLen : pitchWid;
  const fullWidth = boardW + pad * 2;
  const fullHeight = boardH + pad * 2;

  // In vertical mode (6-inch portrait phone): Home attacks bottom -> top, Left Wing stays on left
  const toSvg = useCallback(
    (nx: number, ny: number): { x: number; y: number } => {
      if (isVertical) {
        return {
          x: pad + (ny / 100) * pitchWid,
          y: pad + ((100 - nx) / 100) * pitchLen,
        };
      }
      return {
        x: pad + (nx / 100) * pitchLen,
        y: pad + (ny / 100) * pitchWid,
      };
    },
    [isVertical, pad, pitchLen, pitchWid]
  );

  const [dragState, setDragState] = useState<
    { type: 'player'; id: string } | { type: 'ball' } | null
  >(null);

  const holderTeam = useMemo(() => {
    const holder = players.find((p) => p.id === ball.holderId);
    return holder?.team ?? 'home';
  }, [ball.holderId, players]);

  const spatialGrid = useMemo(() => {
    if (heatmapLayer === 'off') return null;
    return computeSpatialGrid(players, ball, format, holderTeam);
  }, [ball, format, heatmapLayer, holderTeam, players]);

  const clientToNorm = (
    svg: SVGSVGElement,
    clientX: number,
    clientY: number
  ): { x: number; y: number } => {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 50, y: 50 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const svgPt = pt.matrixTransform(ctm.inverse());
    const relX = (svgPt.x - pad) / boardW;
    const relY = (svgPt.y - pad) / boardH;

    if (isVertical) {
      return {
        x: clamp((1 - relY) * 100, 1, 99),
        y: clamp(relX * 100, 1, 99),
      };
    }
    return {
      x: clamp(relX * 100, 1, 99),
      y: clamp(relY * 100, 1, 99),
    };
  };

  const handlePointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragState) return;
    e.preventDefault();
    const pos = clientToNorm(e.currentTarget, e.clientX, e.clientY);
    if (dragState.type === 'player') {
      onMovePlayer(dragState.id, pos.x, pos.y);
    } else {
      onMoveBall(pos.x, pos.y, null);
    }
  };

  const handlePointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragState) return;
    if (dragState.type === 'ball') {
      const pos = clientToNorm(e.currentTarget, e.clientX, e.clientY);
      const snapRadius = isVertical ? 5.2 : 3.8;
      const nearest = [...players]
        .sort((a, b) => Math.hypot(a.x - pos.x, a.y - pos.y) - Math.hypot(b.x - pos.x, b.y - pos.y))
        .find((p) => Math.hypot(p.x - pos.x, p.y - pos.y) < snapRadius);
      if (nearest) {
        const offset = nearest.team === 'home' ? 1.8 : -1.8;
        onMoveBall(clamp(nearest.x + offset, 2, 98), nearest.y, nearest.id);
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate?.(8);
        }
      }
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragState(null);
  };

  const paDepth = spec.penaltyAreaDepthM * SCALE;
  const paWidth = spec.penaltyAreaWidthM * SCALE;
  const gaDepth = spec.goalAreaDepthM * SCALE;
  const gaWidth = spec.goalAreaWidthM * SCALE;
  const penSpot = spec.penaltySpotM * SCALE;
  const penArcR = spec.penaltyArcRadiusM * SCALE;
  const centerR = spec.centerCircleRadiusM * SCALE;
  const cornerR = spec.cornerRadiusM * SCALE;
  const goalW = spec.goalWidthM * SCALE;
  const goalDepth = 18;

  const stripeCount = format === '8v8' ? 8 : 12;
  const stripeSpan = pitchLen / stripeCount;
  const tokenRadius = isVertical
    ? format === '8v8'
      ? 19
      : 22
    : format === '8v8'
      ? 15
      : 17;
  const hitRadius = isVertical ? tokenRadius + 15 : tokenRadius + 7;
  const ballSvg = toSvg(ball.x, ball.y);

  return (
    <div
      className={`pitch-frame ${isVertical ? 'is-vertical' : ''} ${fullscreen ? 'is-fullscreen' : ''}`}
    >
      <svg
        viewBox={`0 0 ${fullWidth} ${fullHeight}`}
        preserveAspectRatio="xMidYMid meet"
        className={`pitch-svg ${isVertical ? 'is-vertical' : ''} ${fullscreen ? 'is-fullscreen' : ''}`}
        role="img"
        aria-label={`${spec.label}戰術板`}
        onPointerDown={() => onCanvasInteract?.()}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <defs>
          {isVertical ? (
            <>
              <clipPath id="clip-away-arc">
                <rect x={pad} y={pad + paDepth} width={boardW} height={boardH} />
              </clipPath>
              <clipPath id="clip-home-arc">
                <rect x={pad} y={pad} width={boardW} height={boardH - paDepth} />
              </clipPath>
            </>
          ) : (
            <>
              <clipPath id="clip-home-arc">
                <rect x={pad + paDepth} y={pad} width={boardW} height={boardH} />
              </clipPath>
              <clipPath id="clip-away-arc">
                <rect x={pad} y={pad} width={boardW - paDepth} height={boardH} />
              </clipPath>
            </>
          )}

          {spatialGrid && (
            <>
              <filter id="heat-blur" x="-10%" y="-10%" width="120%" height="120%">
                <feGaussianBlur stdDeviation="14" />
              </filter>

              <clipPath id="clip-pitch-surface">
                <rect x={pad} y={pad} width={boardW} height={boardH} />
              </clipPath>
            </>
          )}

          {annotations.length > 0 && (
            <>
              <marker id="arr-pass" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#facc15" />
              </marker>
              <marker id="arr-run" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#ffffff" />
              </marker>
              <marker id="arr-dribble" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#facc15" />
              </marker>
              <marker id="arr-press" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#93c5fd" />
              </marker>
            </>
          )}
        </defs>

        {/* Pitch Surround & Grass Stripes */}
        <rect x="0" y="0" width={fullWidth} height={fullHeight} fill="#143321" />
        {Array.from({ length: stripeCount }).map((_, idx) =>
          isVertical ? (
            <rect
              key={idx}
              x={pad}
              y={pad + idx * stripeSpan}
              width={boardW}
              height={stripeSpan + 0.5}
              fill={idx % 2 === 0 ? '#1d4d30' : '#19432a'}
            />
          ) : (
            <rect
              key={idx}
              x={pad + idx * stripeSpan}
              y={pad}
              width={stripeSpan + 0.5}
              height={boardH}
              fill={idx % 2 === 0 ? '#1d4d30' : '#19432a'}
            />
          )
        )}

        {/* AI Spatial Heatmap Layer */}
        {spatialGrid && (
          <g clipPath="url(#clip-pitch-surface)" pointerEvents="none">
            <g filter="url(#heat-blur)">
              {Array.from({ length: spatialGrid.rows * spatialGrid.cols }).map((_, idx) => {
                const r = Math.floor(idx / spatialGrid.cols);
                const c = idx % spatialGrid.cols;
                const cellLen = pitchLen / spatialGrid.cols;
                const cellWid = pitchWid / spatialGrid.rows;
                const x = isVertical ? pad + r * cellWid : pad + c * cellLen;
                const y = isVertical
                  ? pad + (spatialGrid.cols - 1 - c) * cellLen
                  : pad + r * cellWid;
                const w = isVertical ? cellWid : cellLen;
                const h = isVertical ? cellLen : cellWid;

                if (heatmapLayer === 'obso') {
                  const v = spatialGrid.obso[idx];
                  if (v < 0.14) return null;
                  const alpha = Math.min(0.62, v * 0.72);
                  const fill = v > 0.55 ? '#f59e0b' : '#fde047';
                  return (
                    <rect
                      key={idx}
                      x={x - 2}
                      y={y - 2}
                      width={w + 4}
                      height={h + 4}
                      fill={fill}
                      opacity={alpha}
                    />
                  );
                }

                const pcHome =
                  holderTeam === 'home'
                    ? spatialGrid.pitchControl[idx]
                    : 1 - spatialGrid.pitchControl[idx];
                const diff = Math.abs(pcHome - 0.5) * 2;
                if (diff < 0.12) return null;
                const fill = pcHome > 0.5 ? '#ef4444' : '#3b82f6';
                return (
                  <rect
                    key={idx}
                    x={x - 2}
                    y={y - 2}
                    width={w + 4}
                    height={h + 4}
                    fill={fill}
                    opacity={diff * 0.42}
                  />
                );
              })}
            </g>

            {heatmapLayer === 'obso' &&
              spatialGrid.hotspots.slice(0, 2).map((spot, i) => {
                const pt = toSvg(spot.x, spot.y);
                return (
                  <g key={i} transform={`translate(${pt.x}, ${pt.y})`} opacity={0.85}>
                    <circle
                      r={i === 0 ? 18 : 13}
                      fill="none"
                      stroke="#fde047"
                      strokeWidth={1.8}
                      strokeDasharray="4 3"
                    />
                    <circle r={3.2} fill="#fde047" />
                  </g>
                );
              })}
          </g>
        )}

        {/* Field Markings */}
        <g stroke="rgba(255, 255, 255, 0.85)" strokeWidth={2.2} fill="none" pointerEvents="none">
          <rect x={pad} y={pad} width={boardW} height={boardH} />

          {isVertical ? (
            <>
              <line
                x1={pad}
                y1={pad + boardH / 2}
                x2={pad + boardW}
                y2={pad + boardH / 2}
              />
              <circle cx={pad + boardW / 2} cy={pad + boardH / 2} r={centerR} />
              <circle
                cx={pad + boardW / 2}
                cy={pad + boardH / 2}
                r={3}
                fill="rgba(255, 255, 255, 0.85)"
              />

              <rect x={pad + (boardW - paWidth) / 2} y={pad} width={paWidth} height={paDepth} />
              <rect x={pad + (boardW - gaWidth) / 2} y={pad} width={gaWidth} height={gaDepth} />
              <circle
                cx={pad + boardW / 2}
                cy={pad + penSpot}
                r={2.8}
                fill="rgba(255, 255, 255, 0.85)"
              />
              <circle
                cx={pad + boardW / 2}
                cy={pad + penSpot}
                r={penArcR}
                clipPath="url(#clip-away-arc)"
              />

              <rect
                x={pad + (boardW - paWidth) / 2}
                y={pad + boardH - paDepth}
                width={paWidth}
                height={paDepth}
              />
              <rect
                x={pad + (boardW - gaWidth) / 2}
                y={pad + boardH - gaDepth}
                width={gaWidth}
                height={gaDepth}
              />
              <circle
                cx={pad + boardW / 2}
                cy={pad + boardH - penSpot}
                r={2.8}
                fill="rgba(255, 255, 255, 0.85)"
              />
              <circle
                cx={pad + boardW / 2}
                cy={pad + boardH - penSpot}
                r={penArcR}
                clipPath="url(#clip-home-arc)"
              />

              <rect
                x={pad + (boardW - goalW) / 2}
                y={pad - goalDepth}
                width={goalW}
                height={goalDepth}
                strokeWidth={2.4}
              />
              <rect
                x={pad + (boardW - goalW) / 2}
                y={pad + boardH}
                width={goalW}
                height={goalDepth}
                strokeWidth={2.4}
              />
            </>
          ) : (
            <>
              <line
                x1={pad + boardW / 2}
                y1={pad}
                x2={pad + boardW / 2}
                y2={pad + boardH}
              />
              <circle cx={pad + boardW / 2} cy={pad + boardH / 2} r={centerR} />
              <circle
                cx={pad + boardW / 2}
                cy={pad + boardH / 2}
                r={3}
                fill="rgba(255, 255, 255, 0.85)"
              />

              <rect x={pad} y={pad + (boardH - paWidth) / 2} width={paDepth} height={paWidth} />
              <rect x={pad} y={pad + (boardH - gaWidth) / 2} width={gaDepth} height={gaWidth} />
              <circle
                cx={pad + penSpot}
                cy={pad + boardH / 2}
                r={2.8}
                fill="rgba(255, 255, 255, 0.85)"
              />
              <circle
                cx={pad + penSpot}
                cy={pad + boardH / 2}
                r={penArcR}
                clipPath="url(#clip-home-arc)"
              />

              <rect
                x={pad + boardW - paDepth}
                y={pad + (boardH - paWidth) / 2}
                width={paDepth}
                height={paWidth}
              />
              <rect
                x={pad + boardW - gaDepth}
                y={pad + (boardH - gaWidth) / 2}
                width={gaDepth}
                height={gaWidth}
              />
              <circle
                cx={pad + boardW - penSpot}
                cy={pad + boardH / 2}
                r={2.8}
                fill="rgba(255, 255, 255, 0.85)"
              />
              <circle
                cx={pad + boardW - penSpot}
                cy={pad + boardH / 2}
                r={penArcR}
                clipPath="url(#clip-away-arc)"
              />

              <rect
                x={pad - goalDepth}
                y={pad + (boardH - goalW) / 2}
                width={goalDepth}
                height={goalW}
                strokeWidth={2.4}
              />
              <rect
                x={pad + boardW}
                y={pad + (boardH - goalW) / 2}
                width={goalDepth}
                height={goalW}
                strokeWidth={2.4}
              />
            </>
          )}

          <path d={`M ${pad} ${pad + cornerR} A ${cornerR} ${cornerR} 0 0 0 ${pad + cornerR} ${pad}`} />
          <path d={`M ${pad + boardW - cornerR} ${pad} A ${cornerR} ${cornerR} 0 0 0 ${pad + boardW} ${pad + cornerR}`} />
          <path d={`M ${pad} ${pad + boardH - cornerR} A ${cornerR} ${cornerR} 0 0 1 ${pad + cornerR} ${pad + boardH}`} />
          <path d={`M ${pad + boardW - cornerR} ${pad + boardH} A ${cornerR} ${cornerR} 0 0 1 ${pad + boardW} ${pad + boardH - cornerR}`} />
        </g>

        {/* Simple Graphic Movement Arrows */}
        <g pointerEvents="none">
          {annotations.map((ann) => {
            if (ann.kind === 'zone') return null;
            const p1 = toSvg(ann.x1, ann.y1);
            const p2 = toSvg(ann.x2, ann.y2);

            if (ann.kind === 'dribble') {
              return (
                <path
                  key={ann.id}
                  d={buildWavyPath(p1.x, p1.y, p2.x, p2.y)}
                  fill="none"
                  stroke="#facc15"
                  strokeWidth={isVertical ? 3.2 : 2.8}
                  markerEnd="url(#arr-dribble)"
                  opacity={0.95}
                />
              );
            }

            const stroke =
              ann.kind === 'pass'
                ? '#facc15'
                : ann.kind === 'run'
                  ? '#ffffff'
                  : '#93c5fd';
            const dash =
              ann.kind === 'run'
                ? '7 5'
                : ann.kind === 'press'
                  ? '4 4'
                  : undefined;

            return (
              <line
                key={ann.id}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke={stroke}
                strokeWidth={ann.kind === 'pass' ? 3.2 : 2.6}
                strokeDasharray={dash}
                markerEnd={`url(#arr-${ann.kind})`}
                opacity={ann.kind === 'press' ? 0.85 : 0.95}
              />
            );
          })}
        </g>

        {/* Magnetic-Board Player Circles with Fat-Finger Touch Target */}
        <g>
          {players.map((p) => {
            const pt = toSvg(p.x, p.y);
            const hasBall = ball.holderId === p.id;
            const isDragging = dragState?.type === 'player' && dragState.id === p.id;
            const fill =
              p.team === 'home'
                ? p.isGK
                  ? '#f97316'
                  : '#ef4444'
                : p.isGK
                  ? '#06b6d4'
                  : '#3b82f6';

            return (
              <g
                key={p.id}
                transform={`translate(${pt.x}, ${pt.y}) scale(${isDragging ? 1.18 : 1})`}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onCanvasInteract?.();
                  e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
                  setDragState({ type: 'player', id: p.id });
                  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                    navigator.vibrate?.(6);
                  }
                }}
              >
                <circle r={hitRadius} fill="transparent" />
                {isDragging && (
                  <circle
                    r={tokenRadius + 10}
                    fill="rgba(134, 239, 172, 0.22)"
                    stroke="#86efac"
                    strokeWidth={2}
                  />
                )}
                {hasBall && (
                  <circle
                    r={tokenRadius + 5}
                    fill="none"
                    stroke="#facc15"
                    strokeWidth={2.4}
                  />
                )}
                <circle
                  r={tokenRadius}
                  fill={fill}
                  stroke="#ffffff"
                  strokeWidth={2.3}
                />
                <text
                  y={isVertical ? 5.5 : 4.5}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize={
                    isVertical
                      ? format === '8v8'
                        ? '14.5'
                        : '16'
                      : format === '8v8'
                        ? '12.5'
                        : '13.5'
                  }
                  fontWeight="700"
                  style={{ fontVariantNumeric: 'tabular-nums', userSelect: 'none' }}
                >
                  {p.number}
                </text>
              </g>
            );
          })}
        </g>

        {/* Football Icon with Enlarged Mobile Touch Target */}
        <g
          transform={`translate(${ballSvg.x}, ${ballSvg.y}) scale(${dragState?.type === 'ball' ? 1.25 : 1})`}
          style={{ cursor: 'grab' }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onCanvasInteract?.();
            e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
            setDragState({ type: 'ball' });
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              navigator.vibrate?.(6);
            }
          }}
        >
          <circle r={isVertical ? 30 : 18} fill="transparent" />
          {dragState?.type === 'ball' && (
            <circle r={16} fill="rgba(250, 204, 21, 0.28)" stroke="#facc15" strokeWidth={1.8} />
          )}
          <circle r={isVertical ? 10.5 : 8.5} fill="#ffffff" stroke="#111827" strokeWidth={2} />
          <polygon
            points={
              isVertical
                ? '0,-4.6 4.4,-1.4 2.7,3.6 -2.7,3.6 -4.4,-1.4'
                : '0,-3.8 3.6,-1.2 2.2,3 -2.2,3 -3.6,-1.2'
            }
            fill="#111827"
          />
        </g>
      </svg>
    </div>
  );
}
