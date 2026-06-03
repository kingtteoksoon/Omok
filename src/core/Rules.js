/**
 * Rules.js — 오목 규칙 엔진 (승리 판정 + 흑 금수).
 *
 * 설계 이유:
 *   규칙은 게임 정합성의 근간이며 AI 탐색에서도 매 수 호출되므로 정확하고 빨라야 한다.
 *   요구사항의 커스텀 렌주 규칙을 정확히 구현한다:
 *     - 흑(선공): 3-3 금수, 장목(6목 이상) 금수.  4-4 허용, 띈4 허용.
 *     - 백(후공): 금수 없음 (5목 이상이면 승리).
 *   금수 판정은 "그 수를 두었을 때 생기는 모양"을 기준으로 하므로 analyzePoint를 활용한다.
 *
 * 알고리즘:
 *   - winnerAt(): 마지막 착수점의 연속 길이로 승리 판정. O(1).
 *   - isForbidden(): 흑 한정. (a)5목 완성이면 합법, (b)장목이면 금수,
 *                    (c)열린3이 2개 이상이면 3-3 금수.  O(1).
 *
 * 시간복잡도: 모든 판정 O(1) (상수 방향 스캔).
 */
import { BLACK, WHITE, EMPTY } from './constants.js';
import { analyzePoint, analyzePointRun } from './Patterns.js';

/**
 * 방금 (r,c)에 p가 둔 결과 승자가 결정됐는지.
 * 흑: 정확히 5목.  백: 5목 이상.
 * @returns p(승자) 또는 0(미결정)
 */
export function winnerAt(cells, p, r, c) {
  const { max } = analyzePointRun(cells, p, r, c);
  if (p === BLACK) return max === 5 ? BLACK : 0;     // 흑 장목은 승리 아님
  return max >= 5 ? WHITE : 0;                        // 백은 5 이상 승리
}

/**
 * 흑이 (r,c)에 두는 것이 금수인가?
 * 전제: cells[idx]는 비어있어야 하며 색은 BLACK.
 * @returns {forbidden:boolean, reason:string}
 */
export function blackForbidden(cells, r, c) {
  const a = analyzePoint(cells, BLACK, r, c);

  // (a) 5목을 완성하는 수는 항상 합법(승리). 장목과 동시에 5가 나도 승리 우선.
  if (a.hasFive) return { forbidden: false, reason: '' };

  // (b) 장목(6목 이상) 금수.
  if (a.overline) return { forbidden: true, reason: 'overline(장목)' };

  // (c) 3-3 금수: 열린3이 2개 이상.
  if (a.counts.OPEN_THREE >= 2) return { forbidden: true, reason: 'double-three(3-3)' };

  // 4-4, 띈4 는 허용(요구사항). 따라서 별도 금수 없음.
  return { forbidden: false, reason: '' };
}

/** 편의 래퍼: 색을 받아 금수 여부만 boolean으로. (백은 항상 false) */
export function isForbidden(cells, p, r, c) {
  if (p !== BLACK) return false;
  return blackForbidden(cells, r, c).forbidden;
}

/**
 * 합법수 여부: 빈칸이고 (흑이면) 금수가 아니어야 한다.
 */
export function isLegal(board, p, i) {
  if (board.cells[i] !== EMPTY) return false;
  if (p === BLACK) {
    const r = (i / 19) | 0, c = i % 19;
    return !blackForbidden(board.cells, r, c).forbidden;
  }
  return true;
}
