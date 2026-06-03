/**
 * Board.js — 오목 보드 상태 표현.
 *
 * 설계 이유:
 *   탐색(MCTS/알파베타)은 같은 보드를 수십만 번 복제·되돌린다. 따라서 보드는
 *   "가볍고 빠르게 복제/되돌리기"가 가능해야 한다. Int8Array(361) 한 개로 셀을
 *   저장하고, place/undo를 O(1)로 제공한다. 추가로 (a) 착수 이력 스택과
 *   (b) "근방 후보 셀 캐시"를 유지하여 후보 수 생성을 빠르게 한다.
 *
 * 알고리즘:
 *   - place(i,p): 셀 설정 + 이력 push + 근방 카운터 갱신.  O(1) (근방 갱신은 상수 25칸).
 *   - undo():     마지막 착수 역연산.                       O(1).
 *   - 직렬화(serialize): book 키 생성을 위해 361자 문자열로 변환.  O(CELLS).
 *
 * 시간복잡도: 핵심 연산 모두 O(1)~O(상수). 복제(clone)는 O(CELLS).
 */
import { SIZE, CELLS, EMPTY, idx, rowOf, colOf, inBounds } from './constants.js';

export class Board {
  constructor() {
    this.cells = new Int8Array(CELLS);   // 0 EMPTY / 1 BLACK / 2 WHITE
    this.history = [];                   // [{i, p}] 착수 이력 (undo 및 기보 저장용)
    // neighborCount[i] = i 주변(반경2) 에 놓인 돌 수. >0 이면 후보 근방.
    this.neighborCount = new Uint8Array(CELLS);
  }

  /** 깊은 복제 (탐색용). cells/neighborCount만 복사하면 충분. */
  clone() {
    const b = new Board();
    b.cells.set(this.cells);
    b.neighborCount.set(this.neighborCount);
    b.history = this.history.slice();
    return b;
  }

  get moveCount() { return this.history.length; }
  isEmpty(i) { return this.cells[i] === EMPTY; }
  get(i) { return this.cells[i]; }

  /** 근방 카운터를 delta(+1/-1)만큼 갱신한다 (반경 2의 5x5 블록). */
  _bumpNeighbors(i, delta) {
    const r = rowOf(i), c = colOf(i);
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr, cc = c + dc;
        if (inBounds(rr, cc)) this.neighborCount[idx(rr, cc)] += delta;
      }
    }
  }

  /** (i)에 색 p 착수. */
  place(i, p) {
    this.cells[i] = p;
    this.history.push({ i, p });
    this._bumpNeighbors(i, 1);
    return this;
  }

  /** 마지막 착수 되돌리기. */
  undo() {
    const last = this.history.pop();
    if (!last) return null;
    this.cells[last.i] = EMPTY;
    this._bumpNeighbors(last.i, -1);
    return last;
  }

  /** 마지막 착수 (없으면 null). */
  get last() { return this.history.length ? this.history[this.history.length - 1] : null; }

  /**
   * 착수 후보가 될 만한 근방 빈칸 인덱스 목록.
   * 보드가 비어있으면 중앙만 반환한다.
   * O(CELLS) 스캔이지만 후보는 항상 소수다.
   */
  candidateCells() {
    if (this.moveCount === 0) return [idx((SIZE / 2) | 0, (SIZE / 2) | 0)]; // 중앙(9,9)
    const out = [];
    for (let i = 0; i < CELLS; i++) {
      if (this.cells[i] === EMPTY && this.neighborCount[i] > 0) out.push(i);
    }
    return out;
  }

  /** 361자 문자열로 직렬화 (오프닝 북 키 생성용). */
  serialize() {
    let s = '';
    for (let i = 0; i < CELLS; i++) s += this.cells[i];
    return s;
  }

  /** 보드가 가득 찼는지(무승부 후보). */
  isFull() { return this.history.length >= CELLS; }
}
