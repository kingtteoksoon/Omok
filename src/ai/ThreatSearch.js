/**
 * ThreatSearch.js — 강제수 계산 (VCF: Victory by Continuous Fours).
 *
 * 설계 이유 (수읽기·강제수·승리 루트 탐색 요구사항):
 *   프로 수준 오목의 핵심은 "강제수 연속으로 이기는 길(VCF/VCT)"을 끝까지 읽는 것이다.
 *   일반 알파베타는 깊이 한계로 20수짜리 강제승을 놓칠 수 있다. 그래서 *4(사)와 5만
 *   고려하는 좁은 강제수 탐색*을 분리 구현한다. 4를 만들면 상대는 반드시 그 5목 자리를
 *   막아야 하므로(강제), 분기수가 1로 줄어 매우 깊게(>15수) 읽을 수 있다.
 *
 * 알고리즘 (DFS, 선택적 분기):
 *   findVCF(board, p): p가 4(또는 즉승)를 만드는 모든 수를 시도.
 *     - 즉시 5목 가능 → 승리.
 *     - 4를 만드는 수 m: 상대는 그 4의 완성점(유일)에 강제로 막음 → 재귀.
 *     - 열린4(양쪽) / 4-4 → 막을 수 없음 → 승리.
 *   깊이/노드 예산으로 제한하여 시간(<3s)을 보장한다.
 *
 * 시간복잡도: 최악 O(b^d)지만 b(4를 만드는 수)는 보통 1~5로 매우 작아 실전적으로 빠르다.
 */
import { CELLS, EMPTY, BLACK, opp, idx, rowOf, colOf } from '../core/constants.js';
import { analyzePoint, isWinningMove } from '../core/Patterns.js';
import { blackForbidden, winnerAt } from '../core/Rules.js';

/** p가 (r,c)에 두는 것이 합법인가 (흑 금수 고려). */
function legalFor(cells, p, r, c) {
  if (p === BLACK) return !blackForbidden(cells, r, c).forbidden;
  return true;
}

/**
 * 보드에서 색 p의 "즉시 승리 수"들을 찾는다 (한 수로 5목).
 * @returns number[] 인덱스 목록
 */
export function findWinningMoves(board, p) {
  const cells = board.cells;
  const res = [];
  for (const i of board.candidateCells()) {
    const r = rowOf(i), c = colOf(i);
    if (!legalFor(cells, p, r, c)) continue;
    if (isWinningMove(cells, p, r, c)) res.push(i);
  }
  return res;
}

/**
 * p가 4 이상(또는 즉승)을 만드는 "공격수" 후보와, 각 수가 만드는 모양 정보.
 * 열린4/4-4는 막을 수 없는 강제승 신호로 표시한다.
 */
function fourMoves(cells, p, candidates) {
  const out = [];
  for (const i of candidates) {
    const r = rowOf(i), c = colOf(i);
    if (cells[i] !== EMPTY) continue;
    if (!legalFor(cells, p, r, c)) continue;
    const a = analyzePoint(cells, p, r, c);
    if (a.hasFive) { out.push({ i, r, c, immediateWin: true }); continue; }
    const fours = a.counts.FOUR + a.counts.OPEN_FOUR;
    if (fours >= 1) {
      const unstoppable = a.counts.OPEN_FOUR >= 1 || fours >= 2; // 열린4 또는 4-4
      out.push({ i, r, c, immediateWin: false, unstoppable });
    }
  }
  return out;
}

/** 상대가 p의 4를 막아야 하는 유일한 점(5목 완성점)을 찾는다. */
function findBlockPoint(cells, p, r, c) {
  // (r,c)에 p를 가정 착수한 뒤, 5목을 만드는 빈칸을 찾는다.
  cells[idx(r, c)] = p;
  let block = -1;
  // 근방만 검사하면 충분: (r,c) 주변 라인의 빈칸들
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    for (let k = -4; k <= 4; k++) {
      const rr = r + dr * k, cc = c + dc * k;
      if (rr < 0 || rr >= 19 || cc < 0 || cc >= 19) continue;
      const j = idx(rr, cc);
      if (cells[j] !== EMPTY) continue;
      if (isWinningMove(cells, p, rr, cc)) { block = j; break; }
    }
    if (block !== -1) break;
  }
  cells[idx(r, c)] = EMPTY;
  return block;
}

/**
 * findVCF — p가 강제수(4 연속)로 이길 수 있는지 DFS.
 * @returns {win:boolean, move:number} 최초 착수(있으면)
 */
export function findVCF(board, p, opt = {}) {
  const maxDepth = opt.maxDepth ?? 16;     // 강제수 시퀀스 최대 길이
  const budget = { nodes: opt.maxNodes ?? 20000 };
  const move = vcfSearch(board, p, p, maxDepth, budget);
  return { win: move !== -1, move };
}

/**
 * @param attacker 항상 같은 공격자 색
 * @param toMove   현재 둘 색
 * @returns 공격자가 이기는 첫 수 인덱스 또는 -1
 */
function vcfSearch(board, attacker, toMove, depth, budget) {
  if (depth <= 0 || budget.nodes <= 0) return -1;
  budget.nodes--;
  const cells = board.cells;

  if (toMove === attacker) {
    // 공격자 차례: 즉승 우선, 없으면 4를 만드는 강제수 탐색.
    const wins = findWinningMoves(board, attacker);
    if (wins.length) return wins[0];

    const attacks = fourMoves(cells, attacker, board.candidateCells());
    // 막을 수 없는 4(열린4/4-4)가 있으면 그 수로 승리 확정.
    for (const m of attacks) if (m.unstoppable) return m.i;

    for (const m of attacks) {
      board.place(m.i, attacker);
      // 상대 강제 응수 후 재귀
      const r = vcfSearch(board, attacker, opp(attacker), depth - 1, budget);
      board.undo();
      if (r !== -1) return m.i;
      if (budget.nodes <= 0) break;
    }
    return -1;
  } else {
    // 수비자 차례: 공격자의 4를 막는 유일점에 강제 응수. 막을 곳 없으면 공격자 승.
    // 직전 수가 공격자의 4였다고 가정하고 그 차단점을 찾는다.
    const last = board.last;
    if (!last) return -1;
    const block = findBlockPoint(cells, attacker, rowOf(last.i), colOf(last.i));
    if (block === -1) return -1; // 4가 아니었음 → VCF 경로 실패
    // 수비자가 막은 뒤에도 공격자가 또 4를 이어가는지 재귀.
    // 수비 착수가 합법인지(상대 색) — 수비자가 흑이면 금수일 수 있으나
    // 그 경우 수비 불가 → 공격자 승으로 간주.
    const dr = rowOf(block), dc = colOf(block);
    if (toMove === BLACK && blackForbidden(cells, dr, dc).forbidden) {
      return board.last.i; // 수비 불가 → 직전 공격수가 승리수
    }
    board.place(block, toMove);
    const r = vcfSearch(board, attacker, attacker, depth - 1, budget);
    board.undo();
    return r === -1 ? -1 : r;
  }
}

/**
 * 상대(opp)의 즉시 위협(열린4/4) 차단점들을 모은다 — 방어 후보.
 * @returns Set<number> 막아야 할 인덱스들
 */
export function findDefensivePoints(board, me) {
  const you = opp(me);
  const cells = board.cells;
  const blocks = new Set();
  // 상대의 즉승 자리 = 반드시 막아야 함
  for (const i of findWinningMoves(board, you)) blocks.add(i);
  // 상대가 4를 만드는 자리의 완성점도 위험 → 그 자리 자체를 두어 무력화 후보
  const attacks = fourMoves(cells, you, board.candidateCells());
  for (const m of attacks) blocks.add(m.i);
  return blocks;
}
