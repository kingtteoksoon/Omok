/**
 * MCTS.js — 몬테카를로 트리 탐색 (1순위 엔진, 자가대국 학습용).
 *
 * 설계 이유 (요구사항: MCTS 1순위 + Self-Play + 강화학습):
 *   MCTS는 가치/정책을 명시적으로 알지 못해도 시뮬레이션 통계로 좋은 수를 찾아내며,
 *   자가대국(self-play) 강화학습의 표준 골격이다. 본 구현은 *휴리스틱 프라이어가
 *   주입된 MCTS*다: 무작위 롤아웃 대신 평가/모양 휴리스틱으로 (1) 확장 시 후보를
 *   가지치기하고 (2) 롤아웃을 그리디·근사하여 분산을 낮춘다(AlphaGo의 prior 아이디어를
 *   경량화). 이로써 오목처럼 전술이 날카로운 게임에서도 실용적 강함을 얻는다.
 *
 * 알고리즘 (4단계 반복):
 *   1) Selection : 루트에서 UCT 최대 자식을 따라 내려간다. UCT=Q+c·P·√N/(1+n).
 *   2) Expansion : 미전개 노드에서 휴리스틱 상위 후보들을 자식으로 추가.
 *   3) Simulation: 즉승/즉방어를 우선하는 그리디 근사 롤아웃으로 승패 추정.
 *   4) Backprop  : 경로의 방문수·승수를 갱신.
 *   시간/시뮬레이션 예산 소진 시 방문수 최대 수를 선택(robust child).
 *
 * 시간복잡도: O(iterations × (트리깊이 + 롤아웃길이)). 예산으로 상한 통제.
 */
import { EMPTY, BLACK, WHITE, opp, rowOf, colOf } from '../core/constants.js';
import { analyzePoint, isWinningMove } from '../core/Patterns.js';
import { winnerAt, blackForbidden } from '../core/Rules.js';

class Node {
  constructor(move, parent, toMove, prior) {
    this.move = move;        // 이 노드로 오게 한 착수 인덱스
    this.parent = parent;
    this.toMove = toMove;    // 이 노드에서 둘 색
    this.prior = prior;      // 휴리스틱 사전확률 P
    this.children = [];
    this.n = 0;              // 방문수
    this.w = 0;              // toMove의 부모 입장에서의 누적 승수
    this.expanded = false;
  }
}

export class MCTS {
  /**
   * @param {Evaluator} evaluator
   * @param {object} opt {iterations, timeMs, c, expandWidth, rolloutLen}
   */
  constructor(evaluator, opt = {}) {
    this.ev = evaluator;
    this.iterations = opt.iterations ?? 4000;
    this.timeMs = opt.timeMs ?? 1200;
    this.c = opt.c ?? 1.4;             // 탐험 상수
    this.expandWidth = opt.expandWidth ?? 10;
    this.rolloutLen = opt.rolloutLen ?? 12;
  }

  /** 휴리스틱: 한 수의 사전확률 산정용 점수. */
  _moveScore(cells, p, i) {
    const a = analyzePoint(cells, p, rowOf(i), colOf(i));
    if (a.hasFive) return 1e9;
    const c = a.counts;
    return 1 + c.OPEN_FOUR * 100000 + c.FOUR * 10000 + c.OPEN_THREE * 1000 +
           c.THREE * 300 + c.OPEN_TWO * 120 + c.TWO * 30 + c.ONE * 5;
  }

  /** 합법 후보 + 사전확률(softmax 유사 정규화) 상위 width개. */
  _priorChildren(board, p) {
    const cells = board.cells;
    const you = opp(p);
    const scored = [];
    for (const i of board.candidateCells()) {
      const r = rowOf(i), c = colOf(i);
      if (p === BLACK && blackForbidden(cells, r, c).forbidden) continue;
      const s = this._moveScore(cells, p, i) + 0.8 * this._moveScore(cells, you, i);
      scored.push({ i, s });
    }
    scored.sort((a, b) => b.s - a.s);
    const top = scored.slice(0, this.expandWidth);
    const sum = top.reduce((acc, x) => acc + x.s, 0) || 1;
    return top.map((x) => ({ i: x.i, p: x.s / sum }));
  }

  /** UCT 최대 자식 선택. */
  _selectChild(node) {
    let best = null, bestVal = -Infinity;
    const sqrtN = Math.sqrt(node.n + 1);
    for (const ch of node.children) {
      const q = ch.n ? ch.w / ch.n : 0.5;          // 평균 승률
      const u = this.c * ch.prior * sqrtN / (1 + ch.n); // 탐험항
      const val = q + u;
      if (val > bestVal) { bestVal = val; best = ch; }
    }
    return best;
  }

  /** 그리디 근사 롤아웃: 즉승→즉방어→휴리스틱 최선. 승자 색 또는 0(무) 반환. */
  _rollout(board, toMove) {
    let p = toMove;
    for (let step = 0; step < this.rolloutLen; step++) {
      const cells = board.cells;
      const you = opp(p);
      // 1) 즉승
      let mv = -1;
      for (const i of board.candidateCells()) {
        const r = rowOf(i), c = colOf(i);
        if (p === BLACK && blackForbidden(cells, r, c).forbidden) continue;
        if (isWinningMove(cells, p, r, c)) { mv = i; break; }
      }
      // 2) 상대 즉승 방어
      if (mv === -1) {
        for (const i of board.candidateCells()) {
          if (isWinningMove(cells, you, rowOf(i), colOf(i))) {
            const r = rowOf(i), c = colOf(i);
            if (!(p === BLACK && blackForbidden(cells, r, c).forbidden)) { mv = i; break; }
          }
        }
      }
      // 3) 휴리스틱 최선
      if (mv === -1) {
        let bs = -Infinity;
        for (const i of board.candidateCells()) {
          const r = rowOf(i), c = colOf(i);
          if (p === BLACK && blackForbidden(cells, r, c).forbidden) continue;
          const s = this._moveScore(cells, p, i) + 0.8 * this._moveScore(cells, you, i);
          if (s > bs) { bs = s; mv = i; }
        }
      }
      if (mv === -1) return 0; // 둘 곳 없음
      const r = rowOf(mv), c = colOf(mv);
      board.place(mv, p);
      if (winnerAt(board.cells, p, r, c) === p) { board.undo(); return p; }
      board.undo();
      // 실제로 진행 (가벼운 시뮬레이션이므로 place 후 진행, 마지막에 일괄 undo)
      board.place(mv, p);
      p = you;
    }
    // 롤아웃 종료: 정적 평가 부호로 추정 승자
    const e = this.ev.evaluate(board.cells, toMove);
    return e >= 0 ? toMove : opp(toMove);
  }

  /**
   * 탐색 실행. @returns {move, root, visits:[{i,n,w}]}
   */
  search(board, p) {
    const root = new Node(-1, null, p, 1);
    const deadline = performance.now() + this.timeMs;

    for (let it = 0; it < this.iterations; it++) {
      if ((it & 63) === 0 && performance.now() > deadline) break;
      const path = [root];
      const sim = board.clone();
      let node = root;

      // 1) Selection
      while (node.expanded && node.children.length) {
        node = this._selectChild(node);
        sim.place(node.move, opp(node.toMove)); // node.move는 직전 색이 둔 수
        path.push(node);
        const last = sim.last;
        if (winnerAt(sim.cells, last.p, rowOf(last.i), colOf(last.i)) === last.p) {
          this._backprop(path, last.p);
          node = null; break;
        }
      }
      if (node === null) continue;

      // 2) Expansion
      if (!node.expanded) {
        const priors = this._priorChildren(sim, node.toMove);
        for (const pr of priors) node.children.push(new Node(pr.i, node, opp(node.toMove), pr.p));
        node.expanded = true;
      }

      // 3) Simulation
      const winner = this._rollout(sim, node.toMove);

      // 4) Backprop
      this._backprop(path, winner);
    }

    // robust child: 방문수 최대
    let best = -1, bestN = -1, visits = [];
    for (const ch of root.children) {
      visits.push({ i: ch.move, n: ch.n, w: ch.w });
      if (ch.n > bestN) { bestN = ch.n; best = ch.move; }
    }
    visits.sort((a, b) => b.n - a.n);
    return { move: best, root, visits };
  }

  /** 경로를 따라 방문수/승수 갱신. winner 색 기준. */
  _backprop(path, winner) {
    for (const node of path) {
      node.n++;
      // node.toMove가 둘 차례인 노드: 그 부모가 둔 수의 가치 = (부모색이 이겼는가)
      const moverColor = opp(node.toMove);
      if (winner === moverColor) node.w++;
      else if (winner === 0) node.w += 0.5;
    }
  }
}
