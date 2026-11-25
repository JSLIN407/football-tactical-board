import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { PitchCanvas } from './components/PitchCanvas';
import { createInitialBall, instantiateTeam } from './data/formations';

describe('AI Spatial Tactical Board Mobile & Desktop UI', () => {
  it('renders clean board with 8v8/11v11, orientation toggle, AI spatial toggles, and zero voice controls', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('AI 足球空間戰術推演板');
    expect(html).toContain('8人制');
    expect(html).toContain('11人制');
    expect(html).toContain('橫向場');
    expect(html).toContain('空檔價值熱區');
    expect(html).toContain('空間控制權');
    expect(html).toContain('依目前球位 AI 推演');
    expect(html).toContain('示範訓練');
    expect(html).not.toContain('語音');
    expect(html).not.toContain('聆聽');
  });

  it('renders both horizontal and 6-inch vertical mobile pitch SVGs with OBSO heatmap', () => {
    const players = [
      ...instantiateTeam('8v8-2-3-2', 'home'),
      ...instantiateTeam('8v8-3-2-2', 'away'),
    ];
    const ball = createInitialBall(players);
    const verticalHtml = renderToStaticMarkup(
      <PitchCanvas
        format="8v8"
        orientation="vertical"
        players={players}
        ball={ball}
        annotations={[]}
        heatmapLayer="obso"
        onMovePlayer={() => {}}
        onMoveBall={() => {}}
      />
    );
    expect(verticalHtml).toContain('8人制場地戰術板');
    expect(verticalHtml).toContain('is-vertical');
    expect(verticalHtml).toContain('heat-blur');
  });
});
