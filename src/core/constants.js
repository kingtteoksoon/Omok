/**
 * constants.js — 전역 상수 및 보드 기하 헬퍼.
 *
 * 설계 이유: 보드 크기, 돌 색, 방향 벡터 등 여러 모듈이 공유하는 값을 한 곳에서
 *   정의하여 매직 넘버를 제거하고 유지보수성을 높인다. 보드는 1차원 Int8Array로
 *   표현하므로(캐시 친화적·복제 저렴) (row,col)↔index 변환 헬퍼를 함께 제공한다.
 */

export const SIZE = 19;                 // 19x19 바둑판 (요구사항 고정)
export const CELLS = SIZE * SIZE;       // 361

// 돌 색 (보드 셀 값)
export const EMPTY = 0;
export const BLACK = 1;                 // 흑 = 선공
export const WHITE = 2;                 // 백 = 후공

/** 상대 색 반환. */
export const opp = (p) => (p === BLACK ? WHITE : BLACK);

// 라인 탐색용 4방향: 가로, 세로, ↘대각, ↗대각. (4방향만으로 8방향을 모두 커버)
export const DIRS = [
  [0, 1],   // →
  [1, 0],   // ↓
  [1, 1],   // ↘
  [1, -1],  // ↗
];

/** (row,col) → 1차원 인덱스. */
export const idx = (r, c) => r * SIZE + c;
/** 인덱스 → row. */
export const rowOf = (i) => (i / SIZE) | 0;
/** 인덱스 → col. */
export const colOf = (i) => i % SIZE;
/** 보드 범위 내 좌표인지. */
export const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

// 패턴 카테고리 (평가/위협 분석 공용 어휘)
export const PAT = {
  NONE: 'NONE',
  ONE: 'ONE',
  TWO: 'TWO',
  OPEN_TWO: 'OPEN_TWO',
  THREE: 'THREE',
  OPEN_THREE: 'OPEN_THREE',
  FOUR: 'FOUR',
  OPEN_FOUR: 'OPEN_FOUR',
  FIVE: 'FIVE',
};
