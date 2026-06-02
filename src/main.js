/**
 * main.js — 애플리케이션 부트스트랩 (의존성 조립 + 이벤트 바인딩).
 *
 * 설계 이유:
 *   모든 모듈을 조립하는 단일 진입점. 관심사 분리 원칙에 따라 각 모듈은 자기 책임만
 *   지고, 여기서 와이어링(생성·주입·이벤트 연결)만 담당한다. 시작 시 학습 데이터를
 *   로드해 가중치/북/통계를 복원하고, UI 컨트롤을 컨트롤러에 연결한다.
 */
import { Board } from './core/Board.js';
import { BLACK, WHITE } from './core/constants.js';
import { Engine } from './ai/Engine.js';
import { Learner } from './learning/Learner.js';
import { SelfPlay } from './learning/SelfPlay.js';
import { Renderer } from './ui/Renderer.js';
import { Panel } from './ui/Panel.js';
import { Controller } from './ui/Controller.js';

async function boot() {
  // ── 학습 시스템 로드 ──
  const learner = new Learner();
  const src = await learner.load();
  console.log(`%c[Learner] loaded from ${src}.`, 'color:#9a7', learner.weights);

  // ── AI 엔진 ──
  const engine = new Engine({
    weights: learner.weights,
    mode: 'hybrid',
    timeMs: 3000,
    learner,
    verbose: true,
  });

  // ── UI ──
  const canvas = document.getElementById('board');
  const renderer = new Renderer(canvas);
  const panel = new Panel();
  const controller = new Controller({ renderer, panel, engine, learner });

  panel.setStats(learner.stats, learner.opponent);

  // ── 입력: 캔버스 클릭 ──
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    controller.onClick(e.clientX - rect.left, e.clientY - rect.top);
  });

  // ── 컨트롤 패널 버튼 ──
  const $ = (id) => document.getElementById(id);

  $('btn-new-ai-black').onclick = () => controller.newGame({ mode: 'ai', humanColor: BLACK });
  $('btn-new-ai-white').onclick = () => controller.newGame({ mode: 'ai', humanColor: WHITE });
  $('btn-new-pvp').onclick = () => controller.newGame({ mode: 'pvp', humanColor: BLACK });
  $('btn-undo').onclick = () => controller.undo();

  // 난이도(시간 예산) 선택
  $('difficulty').onchange = (e) => {
    const ms = +e.target.value;
    engine.setTime(ms);
    console.log(`[Engine] think time set to ${ms}ms`);
  };

  // 탐색 엔진 모드
  $('engine-mode').onchange = (e) => { engine.setMode(e.target.value); console.log(`[Engine] mode=${e.target.value}`); };

  // 시각화 토글
  $('toggle-overlay').onchange = (e) => { renderer.showOverlay = e.target.checked; controller._renderAll(); };
  $('toggle-forbidden').onchange = (e) => { renderer.showForbidden = e.target.checked; controller._renderAll(); };

  // ── 자가대국(Self-Play) 학습 ──
  let selfplay = null;
  $('btn-selfplay').onclick = async () => {
    const n = +$('selfplay-count').value || 50;
    if (selfplay) { selfplay.cancel(); selfplay = null; $('btn-selfplay').textContent = 'Self-Play 학습'; return; }
    selfplay = new SelfPlay(learner, { timeMs: 300 });
    $('btn-selfplay').textContent = '중지';
    console.log(`%c[Self-Play] training ${n} games…`, 'color:#fc6;font-weight:bold');
    await selfplay.run(n, (done, total, stats) => {
      panel.setProgress(done, total);
      panel.setStats(stats, learner.opponent);
    });
    panel.setProgress(0, 0);
    panel.setStats(learner.stats, learner.opponent);
    engine.syncWeights();
    console.log('%c[Self-Play] done. weights=', 'color:#fc6', learner.weights);
    $('btn-selfplay').textContent = 'Self-Play 학습';
    selfplay = null;
  };

  // 학습 데이터 내보내기(JSON 다운로드)
  $('btn-export').onclick = () => {
    const blob = new Blob([JSON.stringify(learner.toJSON(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `omok-learning-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  // 반응형: 창 크기 변경 시 캔버스 재계산
  window.addEventListener('resize', () => { renderer.resize(); controller._renderAll(); });

  // ── 첫 게임 시작 ──
  controller.newGame({ mode: 'ai', humanColor: BLACK });
  console.log('%c♟ Gomoku Pro AI ready. 콘솔에서 AI 사고과정을 확인하세요.', 'color:#4ea1ff;font-weight:bold');
}

boot();
