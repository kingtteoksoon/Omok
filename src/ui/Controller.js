/**
 * Controller.js — 게임 흐름 제어 (모드/턴/입력/AI 호출/종료/학습 연동).
 *
 * 설계 이유 (요구사항: AI vs Player, Player vs Player, 실시간 갱신, 학습 연동):
 *   View(Renderer/Panel)와 Model(Board/Rules)·AI(Engine)·학습(Learner) 사이의 조율자.
 *   사용자 입력 → 규칙 검증 → 착수 → 승부/승률 갱신 → (AI 모드면) AI 응수 순서를
 *   비동기로 관리한다. AI 연산 직전 렌더 양보(setTimeout 0)로 "생각 중" UI가 보이게 한다.
 *
 * 알고리즘: 이벤트 구동 상태기계(状態機). 무거운 AI 연산은 다음 틱으로 미뤄 UI를 막지 않음.
 */
import { Board } from '../core/Board.js';
import { BLACK, WHITE, opp, rowOf, colOf } from '../core/constants.js';
import { winnerAt, blackForbidden } from '../core/Rules.js';

export class Controller {
  /**
   * @param {object} deps {renderer, panel, engine, learner}
   */
  constructor({ renderer, panel, engine, learner }) {
    this.renderer = renderer;
    this.panel = panel;
    this.engine = engine;
    this.learner = learner;

    this.board = new Board();
    this.mode = 'ai';            // 'ai' | 'pvp'
    this.humanColor = BLACK;     // AI 모드에서 사람 색
    this.aiColor = WHITE;
    this.toMove = BLACK;
    this.over = false;
    this.busy = false;           // AI 사고 중 입력 잠금
    this.moves = [];             // 기보 [[r,c,p]]
  }

  /** 새 게임 시작. opt {mode, humanColor} */
  newGame(opt = {}) {
    this.board = new Board();
    this.mode = opt.mode ?? this.mode;
    this.humanColor = opt.humanColor ?? this.humanColor;
    this.aiColor = opp(this.humanColor);
    this.toMove = BLACK;
    this.over = false;
    this.busy = false;
    this.moves = [];
    this.renderer.setOverlay([]);
    this.engine.syncWeights();
    this._renderAll();
    this.panel.setStatus(this.mode === 'pvp' ? 'PvP: 흑 차례' : (this.toMove === this.humanColor ? '당신(흑) 차례' : 'AI 차례'));
    // AI 선공이면 즉시 AI 착수
    if (this.mode === 'ai' && this.toMove === this.aiColor) this._aiMoveSoon();
  }

  /** 사용자 클릭 처리(좌표 px). */
  onClick(px, py) {
    if (this.over || this.busy) return;
    const i = this.renderer.pickCell(px, py);
    if (i == null || this.board.cells[i] !== 0) return;
    // PvP/AI 공통: 현재 둘 색이 사람인지 확인
    if (this.mode === 'ai' && this.toMove !== this.humanColor) return;

    const r = rowOf(i), c = colOf(i);
    // 흑 금수 검증
    if (this.toMove === BLACK && blackForbidden(this.board.cells, r, c).forbidden) {
      this.panel.setStatus('금수입니다 (3-3 또는 장목)', '#e35');
      return;
    }
    this._applyMove(i, this.toMove);
    if (this.over) return;

    if (this.mode === 'ai') this._aiMoveSoon();
    else this.panel.setStatus(`PvP: ${this.toMove === BLACK ? '흑' : '백'} 차례`);
  }

  /** 한 수 착수 + 승부/승률 갱신 + 턴 전환. */
  _applyMove(i, color) {
    const r = rowOf(i), c = colOf(i);
    this.board.place(i, color);
    this.moves.push([r, c, color]);
    const w = winnerAt(this.board.cells, color, r, c);
    this._renderAll();

    if (w === color) { this._endGame(color); return; }
    if (this.board.isFull()) { this._endGame(0); return; }

    this.toMove = opp(color);
    // 사람 차례면 현재 국면 승률 갱신(분석)
    if (!(this.mode === 'ai' && this.toMove === this.aiColor)) {
      const a = this.engine.analyze(this.board, this.toMove);
      this.panel.setWinRate(a.winrate, this.aiColor);
    }
  }

  /** 다음 틱에 AI 착수(렌더 양보). */
  _aiMoveSoon() {
    this.busy = true;
    this.panel.setStatus('AI 분석 중…', '#4ea1ff');
    setTimeout(() => this._aiMove(), 30);
  }

  _aiMove() {
    if (this.over) { this.busy = false; return; }
    const color = this.toMove;
    const result = this.engine.chooseMove(this.board, color);
    // 시각화 오버레이 갱신
    this.renderer.setOverlay(result.candidates);
    // 패널 갱신
    this.panel.setWinRate(result.winrate, this.aiColor);
    this.panel.setAnalysis({ ...result.analysis, engine: result.engine, elapsedMs: result.elapsedMs });
    // 착수
    this.busy = false;
    this._applyMove(result.move, color);
    if (!this.over) this.panel.setStatus(this.mode === 'ai' ? '당신 차례' : `${this.toMove === BLACK ? '흑' : '백'} 차례`);
  }

  /** 게임 종료 처리 + 학습. */
  _endGame(winner) {
    this.over = true;
    this.busy = false;
    let msg;
    if (winner === 0) msg = '무승부';
    else if (this.mode === 'pvp') msg = `${winner === BLACK ? '흑' : '백'} 승리!`;
    else msg = winner === this.aiColor ? 'AI 승리' : '당신 승리! 🎉';
    this.panel.setStatus(msg, winner === this.aiColor ? '#e35' : '#39d353');

    // 학습: 기보로 북/가중치/상대성향 갱신 후 저장
    const humanColor = this.mode === 'ai' ? this.humanColor : null;
    this.learner.learnFromGame(this.moves, winner, this.aiColor, humanColor);
    this.engine.syncWeights();
    this.panel.setStats(this.learner.stats, this.learner.opponent);
    this.learner.save();
  }

  /** 무르기(사람+AI 두 수 되돌리기). */
  undo() {
    if (this.busy || this.over) {
      // 종료 후에도 복기 위해 일부 허용
    }
    const steps = this.mode === 'ai' ? 2 : 1;
    for (let k = 0; k < steps && this.board.moveCount > 0; k++) {
      this.board.undo();
      this.moves.pop();
    }
    this.over = false;
    this.toMove = this.board.moveCount % 2 === 0 ? BLACK : WHITE;
    this.renderer.setOverlay([]);
    this._renderAll();
    const a = this.engine.analyze(this.board, this.toMove);
    this.panel.setWinRate(a.winrate, this.aiColor);
    this.panel.setStatus('무르기 완료');
  }

  _renderAll() {
    const last = this.board.last ? this.board.last.i : -1;
    this.renderer.render(this.board, last, this.toMove);
  }
}
