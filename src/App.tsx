import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createInitialBall,
  getFormationsForFormat,
  instantiateTeam,
} from './data/formations';
import { clamp } from './data/pitchSpecs';
import {
  isQuestionInput,
  runAISpatialSimulation,
  simulateWithQuestionPolicy,
  trainPolicyFromCoachDemo,
} from './engine/spatialModel';
import type { HeatmapLayer, TacticalContextId } from './engine/spatialModel';
import { interpolateKeyframes, simulateTacticalCommand } from './engine/tacticalEngine';
import type {
  BallState,
  DrawingAnnotation,
  PitchFormat,
  PlayerToken,
  TacticalAnalysis,
  TacticalKeyframe,
} from './types/tactics';
import { PitchCanvas } from './components/PitchCanvas';
import type { PitchOrientation } from './components/PitchCanvas';
import {
  IconFootball,
  IconInstall,
  IconPause,
  IconPlay,
  IconReset,
  IconRotate,
  IconSend,
} from './components/Icons';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const AI_SCENARIOS: Array<{ id: Exclude<TacticalContextId, 'auto'>; label: string }> = [
  { id: 'build_up', label: '後場破壓出球' },
  { id: 'flank_overload', label: '邊路內切套邊' },
  { id: 'central_penetration', label: '中路滲透直塞' },
  { id: 'switch_weak_side', label: '強側轉移弱側' },
  { id: 'counter_press', label: '丟球高位反搶' },
];

function detectDefaultOrientation(): PitchOrientation {
  if (typeof window !== 'undefined' && window.innerWidth <= 820 && window.innerHeight > window.innerWidth) {
    return 'vertical';
  }
  return 'horizontal';
}

function buildDefaultState(homeFmtId: string, awayFmtId: string) {
  const players = [
    ...instantiateTeam(homeFmtId, 'home'),
    ...instantiateTeam(awayFmtId, 'away'),
  ];
  const ball = createInitialBall(players);
  const initialKeyframe: TacticalKeyframe = {
    id: 'kf-init',
    title: '初始',
    description: '',
    phase: 'setup',
    players,
    ball,
    annotations: [],
    durationMs: 700,
  };
  return { players, ball, keyframes: [initialKeyframe] };
}

export function App() {
  const [format, setFormat] = useState<PitchFormat>('11v11');
  const [orientation, setOrientation] = useState<PitchOrientation>(detectDefaultOrientation);
  const [manualOrientation, setManualOrientation] = useState<boolean>(false);
  const [homeFormationId, setHomeFormationId] = useState<string>('11v11-4-3-3');
  const [awayFormationId, setAwayFormationId] = useState<string>('11v11-4-4-2');

  const initialData = useMemo(
    () => buildDefaultState('11v11-4-3-3', '11v11-4-4-2'),
    []
  );

  const [baseSnapshot, setBaseSnapshot] = useState<{
    players: PlayerToken[];
    ball: BallState;
  }>({
    players: initialData.players,
    ball: initialData.ball,
  });

  const [qaStartSnapshot, setQaStartSnapshot] = useState<{
    players: PlayerToken[];
    ball: BallState;
  }>({
    players: initialData.players,
    ball: initialData.ball,
  });

  const [keyframes, setKeyframes] = useState<TacticalKeyframe[]>(initialData.keyframes);
  const [players, setPlayers] = useState<PlayerToken[]>(initialData.players);
  const [ball, setBall] = useState<BallState>(initialData.ball);
  const [annotations, setAnnotations] = useState<DrawingAnnotation[]>([]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const rafRef = useRef<number | null>(null);

  const [heatmapLayer, setHeatmapLayer] = useState<HeatmapLayer>('obso');
  const [activeScenario, setActiveScenario] = useState<TacticalContextId | null>(null);
  const [commandInput, setCommandInput] = useState<string>('');
  const [analysis, setAnalysis] = useState<TacticalAnalysis | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const availableFormations = useMemo(() => getFormationsForFormat(format), [format]);

  // Auto-adapt pitch orientation when rotating a 6-inch phone unless manually locked
  useEffect(() => {
    if (typeof window === 'undefined' || manualOrientation) return;
    const onResize = () => {
      setOrientation(detectDefaultOrientation());
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [manualOrientation]);

  // Capture PWA native install prompt on mobile browsers
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const applyReset = (nextHomeId = homeFormationId, nextAwayId = awayFormationId) => {
    setIsPlaying(false);
    const fresh = buildDefaultState(nextHomeId, nextAwayId);
    setBaseSnapshot({ players: fresh.players, ball: fresh.ball });
    setQaStartSnapshot({ players: fresh.players, ball: fresh.ball });
    setKeyframes(fresh.keyframes);
    setPlayers(fresh.players);
    setBall(fresh.ball);
    setAnnotations([]);
    setAnalysis(null);
    setActiveScenario(null);
  };

  const handleChangeFormat = (nextFormat: PitchFormat) => {
    if (nextFormat === format) return;
    const fmtList = getFormationsForFormat(nextFormat);
    const nextHome = fmtList[0].id;
    const nextAway = (fmtList[1] ?? fmtList[0]).id;
    setFormat(nextFormat);
    setHomeFormationId(nextHome);
    setAwayFormationId(nextAway);
    applyReset(nextHome, nextAway);
  };

  const handleMovePlayer = useCallback((id: string, x: number, y: number) => {
    setIsPlaying(false);
    setAnnotations([]);
    setPlayers((prev) => {
      const target = prev.find((p) => p.id === id);
      const nextPlayers = prev.map((p) => (p.id === id ? { ...p, x, y } : p));
      setBall((prevBall) => {
        const nextBall =
          target && prevBall.holderId === id
            ? {
                ...prevBall,
                x: clamp(x + (target.team === 'home' ? 1.8 : -1.8), 1, 99),
                y,
              }
            : prevBall;
        setBaseSnapshot({ players: nextPlayers, ball: nextBall });
        return nextBall;
      });
      return nextPlayers;
    });
  }, []);

  const handleMoveBall = useCallback(
    (x: number, y: number, holderId: string | null) => {
      setIsPlaying(false);
      setAnnotations([]);
      const nextBall = { x, y, holderId };
      setBall(nextBall);
      setBaseSnapshot({ players, ball: nextBall });
    },
    [players]
  );

  const triggerAIScenario = useCallback(
    (scenarioId: TacticalContextId) => {
      setIsPlaying(false);
      setActiveScenario(scenarioId);

      const sim = runAISpatialSimulation(
        scenarioId,
        baseSnapshot.players,
        baseSnapshot.ball,
        format
      );

      setKeyframes(sim.keyframes);
      setAnalysis(sim.analysis);
      setPlayers(sim.keyframes[0].players);
      setBall(sim.keyframes[0].ball);
      setAnnotations(sim.keyframes[0].annotations);

      setTimeout(() => setIsPlaying(true), 40);
    },
    [baseSnapshot, format]
  );

  const triggerTextCommand = useCallback(() => {
    const prompt = commandInput.trim();
    if (!prompt) {
      triggerAIScenario('auto');
      return;
    }

    setIsPlaying(false);
    setActiveScenario(null);
    setQaStartSnapshot({
      players: baseSnapshot.players.map((p) => ({ ...p })),
      ball: { ...baseSnapshot.ball },
    });

    const sim = isQuestionInput(prompt)
      ? simulateWithQuestionPolicy(prompt, baseSnapshot.players, baseSnapshot.ball, format)
      : simulateTacticalCommand(prompt, baseSnapshot.players, baseSnapshot.ball, format, 'auto');

    setKeyframes(sim.keyframes);
    setAnalysis(sim.analysis);
    setPlayers(sim.keyframes[0].players);
    setBall(sim.keyframes[0].ball);
    setAnnotations(sim.keyframes[0].annotations);

    setTimeout(() => setIsPlaying(true), 40);
  }, [baseSnapshot, commandInput, format, triggerAIScenario]);

  const handleTrainFromDemo = useCallback(() => {
    const question = commandInput.trim() || '這種情況該怎麼處理？';
    setIsPlaying(false);

    const stats = trainPolicyFromCoachDemo(
      question,
      qaStartSnapshot.players,
      qaStartSnapshot.ball,
      players,
      ball,
      format
    );

    const rerun = simulateWithQuestionPolicy(
      question,
      qaStartSnapshot.players,
      qaStartSnapshot.ball,
      format
    );

    setKeyframes(rerun.keyframes);
    setAnalysis({
      ...rerun.analysis,
      offBallAttackShift: `已學習教練示範（自訓 ${stats.coachDemoCount} 題，Loss ${stats.loss.toFixed(3)}）：${rerun.analysis.offBallAttackShift}`,
    });
    setPlayers(rerun.keyframes[0].players);
    setBall(rerun.keyframes[0].ball);
    setAnnotations(rerun.keyframes[0].annotations);

    setTimeout(() => setIsPlaying(true), 40);
  }, [ball, commandInput, format, players, qaStartSnapshot]);

  useEffect(() => {
    if (!isPlaying || keyframes.length < 2) return;

    let seg = 0;
    let start = performance.now();

    const tick = (now: number) => {
      const fromKf = keyframes[seg];
      const toKf = keyframes[seg + 1];
      if (!fromKf || !toKf) {
        setIsPlaying(false);
        return;
      }

      const dur = toKf.durationMs || 1250;
      const t = Math.min(1, (now - start) / dur);
      const interp = interpolateKeyframes(fromKf, toKf, t);

      setPlayers(interp.players);
      setBall(interp.ball);
      setAnnotations(toKf.annotations);

      if (t >= 1) {
        if (seg + 1 < keyframes.length - 1) {
          seg += 1;
          start = now;
          rafRef.current = requestAnimationFrame(tick);
        } else {
          setPlayers(toKf.players.map((p) => ({ ...p })));
          setBall({ ...toKf.ball });
          setAnnotations(toKf.annotations.map((a) => ({ ...a })));
          setIsPlaying(false);
        }
      } else {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, keyframes]);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand-group">
          <div className="brand-head">
            <IconFootball width={20} height={20} className="brand-icon" />
            <h1 className="brand-title">AI 足球空間戰術推演板</h1>
          </div>

          <div className="segmented" role="group" aria-label="場地人數">
            <button
              type="button"
              className={`seg-btn ${format === '8v8' ? 'is-active' : ''}`}
              onClick={() => handleChangeFormat('8v8')}
            >
              8人制
            </button>
            <button
              type="button"
              className={`seg-btn ${format === '11v11' ? 'is-active' : ''}`}
              onClick={() => handleChangeFormat('11v11')}
            >
              11人制
            </button>
          </div>

          <button
            type="button"
            className="btn btn-compact"
            onClick={() => {
              setManualOrientation(true);
              setOrientation((prev) => (prev === 'vertical' ? 'horizontal' : 'vertical'));
            }}
            title="切換直向／橫向球場（6吋手機直握建議直向）"
          >
            <IconRotate width={14} height={14} />
            {orientation === 'vertical' ? '直向場' : '橫向場'}
          </button>

          {installPrompt && (
            <button
              type="button"
              className="btn btn-compact"
              onClick={handleInstallApp}
              title="安裝至手機主畫面離線使用"
            >
              <IconInstall width={14} height={14} />
              安裝 App
            </button>
          )}
        </div>

        <div className="top-controls">
          <div className="segmented" role="group" aria-label="AI 空間視覺化">
            <button
              type="button"
              className={`seg-btn ${heatmapLayer === 'obso' ? 'is-active' : ''}`}
              onClick={() => setHeatmapLayer('obso')}
              title="Spearman (2018) 無球跑位得分機會熱區"
            >
              空檔價值熱區
            </button>
            <button
              type="button"
              className={`seg-btn ${heatmapLayer === 'pitch-control' ? 'is-active' : ''}`}
              onClick={() => setHeatmapLayer('pitch-control')}
              title="Fernández & Bornn (2018) 兩隊空間控制權"
            >
              空間控制權
            </button>
            <button
              type="button"
              className={`seg-btn ${heatmapLayer === 'off' ? 'is-active' : ''}`}
              onClick={() => setHeatmapLayer('off')}
            >
              純場地
            </button>
          </div>

          <label className="team-select">
            <span className="dot dot-home" />
            <select
              aria-label="紅隊陣型"
              value={homeFormationId}
              onChange={(e) => {
                setHomeFormationId(e.target.value);
                applyReset(e.target.value, awayFormationId);
              }}
            >
              {availableFormations.map((f) => (
                <option key={f.id} value={f.id}>
                  紅隊 {f.name.split('（')[0]}
                </option>
              ))}
            </select>
          </label>

          <label className="team-select">
            <span className="dot dot-away" />
            <select
              aria-label="藍隊陣型"
              value={awayFormationId}
              onChange={(e) => {
                setAwayFormationId(e.target.value);
                applyReset(homeFormationId, e.target.value);
              }}
            >
              {availableFormations.map((f) => (
                <option key={f.id} value={f.id}>
                  藍隊 {f.name.split('（')[0]}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="btn btn-compact"
            onClick={() => applyReset()}
            title="重置站位"
          >
            <IconReset width={15} height={15} />
            重置
          </button>
        </div>
      </header>

      <main className="main-stage">
        <PitchCanvas
          format={format}
          orientation={orientation}
          players={players}
          ball={ball}
          annotations={annotations}
          heatmapLayer={heatmapLayer}
          onMovePlayer={handleMovePlayer}
          onMoveBall={handleMoveBall}
        />

        <section className="command-dock" aria-label="AI 戰術推演控制列">
          <div className="command-row primary-action-row">
            <button
              type="button"
              className="btn btn-primary btn-main-sim"
              onClick={() => triggerAIScenario('auto')}
            >
              <IconPlay width={13} height={13} />
              依目前球位 AI 推演
            </button>

            {keyframes.length > 1 && (
              <button
                type="button"
                className="btn btn-replay"
                onClick={() => {
                  if (isPlaying) {
                    setIsPlaying(false);
                  } else {
                    setPlayers(keyframes[0].players);
                    setBall(keyframes[0].ball);
                    setAnnotations([]);
                    setTimeout(() => setIsPlaying(true), 30);
                  }
                }}
              >
                {isPlaying ? <IconPause width={13} height={13} /> : <IconPlay width={13} height={13} />}
                {isPlaying ? '暫停' : '重播'}
              </button>
            )}

            <div className="chip-row">
              {AI_SCENARIOS.map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  className={`quick-chip ${activeScenario === sc.id ? 'is-selected' : ''}`}
                  onClick={() => triggerAIScenario(sc.id)}
                >
                  {sc.label}
                </button>
              ))}
            </div>
          </div>

          <div className="command-row input-action-row">
            <input
              type="text"
              className="command-input"
              placeholder="輸入問句推演（例：這種情況該怎麼處理？），拖曳理想站位後點「示範訓練」"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  triggerTextCommand();
                }
              }}
            />
            <div className="input-btns">
              <button
                type="button"
                className="btn btn-flex"
                disabled={!commandInput.trim()}
                onClick={triggerTextCommand}
              >
                <IconSend width={14} height={14} />
                文字推演
              </button>
              <button
                type="button"
                className="btn btn-flex"
                onClick={handleTrainFromDemo}
                title="將目前場上拖曳擺放的位置作為此問句的正確解法，反向傳播更新 AI 策略權重"
              >
                示範訓練
              </button>
            </div>
          </div>

          {analysis && (
            <div className="brief-summary">
              <div className="brief-lines">
                <span>
                  <strong className="tag-atk">進攻跑位</strong> {analysis.offBallAttackShift}
                </span>
                <span>
                  <strong className="tag-def">防守移位</strong> {analysis.defenseShift}
                </span>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
