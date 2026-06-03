/**
 * SelfPlay.js — 자가 대국(AI vs AI) 강화학습 루프.
 *
 * 설계 이유 (요구사항: Self Play, 학습 모드 수천~수만 판, 강화학습):
 *   AlphaZero 계열의 핵심은 "사람 기보 없이 자가대국으로 스스로 강해지는 것"이다.
 *   본 모듈은 두 AI 인스턴스를 빠른 설정(짧은 시간예산)으로 맞붙여 기보를 만들고,
 *   그 결과를 Learner 에 주입하여 오프닝 북과 가치 가중치를 갱신한다. UI 블로킹을
 *   막기 위해 판 사이에 await microtask 양보를 넣어 진행률을 갱신한다.
 *
 * 알고리즘:
 *   for game in N:
 *     b = empty board
 *     while not terminal: m = engine.chooseMove(b, toMove); apply; toMove flip
 *     learner.learnFromGame(moves, winner, aiColor=BLACK)  // 책/가중치 갱신
 *   탐색은 약하게(시간/반복 축소)·탐험 강화(초반 다양화)하여 다양한 국면을 수집.
 *
 * 시간복잡도: O(games × 평균수 × 수당탐색비용). 시간예산 축소로 대량 학습을 현실화.
 */
import { Board } from '../core/Board.js';
import { BLACK, WHITE, opp, rowOf, colOf } from '../core/constants.js';
import { Engine } from '../ai/Engine.js';
import { winnerAt } from '../core/Rules.js';

export class SelfPlay {
  /**
   * @param {Learner} learner 학습 결과를 누적할 대상
   * @param {object} opt {timeMs, maxMoves, explore}
   */
  constructor(learner, opt = {}) {
    this.learner = learner;
    this.timeMs = opt.timeMs ?? 300;        // 자가대국은 빠르게(짧은 예산)
    this.maxMoves = opt.maxMoves ?? 225;
    this.explore = opt.explore ?? true;     // 초반 무작위 분산(다양성)
    this.stop = false;
  }

  /** 한 판을 두고 기보·승자를 반환. */
  playOne() {
    // 매 판 최신 가중치를 반영한 엔진 두 개(흑/백 공용 단일 엔진으로 충분)
    const engine = new Engine({
      weights: this.learner.weights, mode: 'alphabeta',
      timeMs: this.timeMs, learner: this.learner, verbose: false,
    });
    const board = new Board();
    let toMove = BLACK, winner = 0;
    const moves = [];

    for (let ply = 0; ply < this.maxMoves; ply++) {
      let mv;
      // 초반 분산: 다양한 오프닝을 수집하기 위해 첫 4수는 상위 후보 중 무작위 선택
      if (this.explore && ply < 4) {
        const cands = board.candidateCells();
        mv = cands[(Math.random() * cands.length) | 0];
      } else {
        mv = engine.chooseMove(board, toMove).move;
      }
      if (mv == null || mv < 0 || board.cells[mv] !== 0) break;
      const r = rowOf(mv), c = colOf(mv);
      board.place(mv, toMove);
      moves.push([r, c, toMove]);
      if (winnerAt(board.cells, toMove, r, c) === toMove) { winner = toMove; break; }
      toMove = opp(toMove);
    }
    return { moves, winner };
  }

  /**
   * N판 자가대국 실행. onProgress(i, N, stats) 콜백으로 UI 갱신.
   * 판마다 microtask 양보로 UI 응답성 유지.
   */
  async run(games, onProgress) {
    this.stop = false;
    for (let g = 0; g < games; g++) {
      if (this.stop) break;
      const { moves, winner } = this.playOne();
      // 자가대국에선 흑을 'AI'로 보고 학습(대칭이므로 통계상 균형 유지).
      this.learner.learnFromGame(moves, winner, BLACK, WHITE);
      if (onProgress) onProgress(g + 1, games, this.learner.stats);
      // UI 양보 (이벤트 루프 비우기)
      await new Promise((res) => setTimeout(res, 0));
    }
    await this.learner.save();
    return this.learner.stats;
  }

  cancel() { this.stop = true; }
}
