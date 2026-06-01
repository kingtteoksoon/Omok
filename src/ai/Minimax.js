/**
 * Minimax.js — 알파-베타 가지치기 탐색 (2순위 엔진).
 *
 * 설계 이유:
 *   전술적 강제수(ThreatSearch)로 해결되지 않는 "전략적 국면"에서는 깊이 탐색이 필요하다.
 *   알파-베타는 미니맥스의 안전한 가지치기로, 좋은 수 정렬(move ordering)과 결합하면
 *   동일 결과를 훨씬 적은 노드로 얻는다. 후보를 근방 + 평가 상위 N개로 제한하여
 *   분기수를 통제하고, 반복심화(iterative deepening)로 시간 예산(<3s)을 지킨다.
 *
 * 알고리즘:
 *   - 후보 생성: 근방 빈칸 → analyzePoint 기반 (공격+방어) 휴리스틱으로 정렬, 상위 width.
 *   - negamax(α,β): 색 관점 평가의 부호 반전 미니맥스. 승리/패배는 즉시 큰 값 반환.
 *   - 반복심화: depth 2,4,6… 시간 초과 전까지. 이전 깊이의 최선수를 먼저 시도(정렬 강화).
 *
 * 시간복잡도:
 *   최선 정렬 시 O(b^(d/2)) (b=width, d=depth). width≈12, d≈6 이면 실전 1초 내.
 */
import { EMPTY, BLACK, opp, rowOf, colOf } from '../core/constants.js';
import { analyzePoint } from '../core/Patterns.js';
import { winnerAt, blackForbidden } from '../core/Rules.js';

const WIN_SCORE = 5_000_000;

export class Minimax {
  /**
   * @param {Evaluator} evaluator 정적 평가기
   * @param {object} opt {width, maxDepth, timeMs}
   */
  constructor(evaluator, opt = {}) {
    this.ev = evaluator;
    this.width = opt.width ?? 12;        // 노드당 후보 폭
    this.maxDepth = opt.maxDepth ?? 6;   // 최대 깊이
    this.timeMs = opt.timeMs ?? 1500;    // 시간 예산
    this.nodes = 0;
  }

  /** 후보 수를 휴리스틱 점수와 함께 생성·정렬(내림차순). */
  orderedCandidates(board, p) {
    const cells = board.cells;
    const you = opp(p);
    const scored = [];
    for (const i of board.candidateCells()) {
      const r = rowOf(i), c = colOf(i);
      if (p === BLACK && blackForbidden(cells, r, c).forbidden) continue; // 금수 제외
      const mine = analyzePoint(cells, p, r, c);
      const theirs = analyzePoint(cells, you, r, c); // 같은 칸에 상대가 두면(방어가치)
      const s = this._moveHeuristic(mine) + 0.9 * this._moveHeuristic(theirs);
      scored.push({ i, s });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored;
  }

  /** 한 수가 만드는 모양의 휴리스틱 가치(정렬용). */
  _moveHeuristic(a) {
    if (a.hasFive) return 1e9;
    const c = a.counts;
    return c.OPEN_FOUR * 100000 + c.FOUR * 10000 + c.OPEN_THREE * 1000 +
           c.THREE * 300 + c.OPEN_TWO * 120 + c.TWO * 30 + c.ONE * 5;
  }

  /**
   * 루트 탐색. 반복심화로 최선수와 점수를 반환.
   * @returns {move:number, score:number, depth:number, pv:number[]}
   */
  search(board, p) {
    this.nodes = 0;
    this.deadline = performance.now() + this.timeMs;
    let best = { move: -1, score: -Infinity, depth: 0, pv: [] };
    let firstGuess = -1;

    for (let depth = 2; depth <= this.maxDepth; depth += 2) {
      const res = this._rootSearch(board, p, depth, firstGuess);
      if (res === null) break;               // 시간 초과 → 직전 결과 사용
      best = res;
      firstGuess = res.move;                  // 다음 깊이에서 먼저 시도
      if (Math.abs(res.score) >= WIN_SCORE) break; // 승부 확정이면 종료
      if (performance.now() > this.deadline) break;
    }
    return best;
  }

  _rootSearch(board, p, depth, firstGuess) {
    let cands = this.orderedCandidates(board, p);
    if (firstGuess !== -1) {
      // 이전 최선수를 맨 앞으로 (정렬 강화 → 가지치기 향상)
      cands = cands.slice().sort((a, b) => (b.i === firstGuess) - (a.i === firstGuess));
    }
    cands = cands.slice(0, this.width);
    if (!cands.length) return { move: -1, score: 0, depth, pv: [] };

    let alpha = -Infinity, bestMove = cands[0].i, bestPv = [];
    for (const { i } of cands) {
      const r = rowOf(i), c = colOf(i);
      board.place(i, p);
      const w = winnerAt(board.cells, p, r, c);
      let score, childPv = [];
      if (w === p) score = WIN_SCORE;
      else { const rr = this._negamax(board, opp(p), depth - 1, -Infinity, -alpha, p, childPv); if (rr === null) { board.undo(); return null; } score = -rr; }
      board.undo();
      if (score > alpha) { alpha = score; bestMove = i; bestPv = [i, ...childPv]; }
      if (performance.now() > this.deadline) break;
    }
    return { move: bestMove, score: alpha, depth, pv: bestPv };
  }

  /** negamax + 알파베타. rootP는 평가 부호 기준 색. */
  _negamax(board, p, depth, alpha, beta, rootP, pv) {
    this.nodes++;
    if ((this.nodes & 1023) === 0 && performance.now() > this.deadline) return null;

    if (depth <= 0) {
      // 리프: rootP 관점 평가를 현재 색(p) 관점으로 변환
      const e = this.ev.evaluate(board.cells, p);
      return e;
    }

    const cands = this.orderedCandidates(board, p).slice(0, this.width);
    if (!cands.length) return this.ev.evaluate(board.cells, p);

    let best = -Infinity;
    for (const { i } of cands) {
      const r = rowOf(i), c = colOf(i);
      board.place(i, p);
      const w = winnerAt(board.cells, p, r, c);
      let score, childPv = [];
      if (w === p) score = WIN_SCORE - (this.maxDepth - depth); // 빠른 승리 선호
      else {
        const rr = this._negamax(board, opp(p), depth - 1, -beta, -alpha, rootP, childPv);
        if (rr === null) { board.undo(); return null; }
        score = -rr;
      }
      board.undo();
      if (score > best) { best = score; pv.length = 0; pv.push(i, ...childPv); }
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;   // 베타 컷오프
    }
    return best;
  }
}
