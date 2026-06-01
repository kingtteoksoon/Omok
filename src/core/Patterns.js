/**
 * Patterns.js — 오목 모양(패턴) 인식 엔진.
 *
 * 설계 이유:
 *   오목 AI의 강함은 "모양 인식 정확도"에서 나온다. 본 모듈은 두 가지 인식기를
 *   제공한다.
 *     (1) analyzePoint(): 어떤 빈칸에 p가 두었을 때 "그 수가 만드는 모양"을
 *         4방향 각각에 대해 분류한다. → 후보 생성/정렬, 승리·금수·위협 판정에 사용.
 *     (2) tallyBoard(): 보드 전체의 모양 개수를 색깔별로 집계한다.
 *         → 정적 평가 함수와 승률 계산에 사용.
 *
 * 알고리즘 (문자열 윈도우 + 패턴 매칭):
 *   한 방향의 라인을 중심(착수점) 기준 반경 5 (길이 11) 윈도우 문자열로 만든다.
 *   문자: '1'=자기돌, '0'=빈칸, '2'=상대돌/벽. 그런 다음 강도순(FIVE→...→ONE)
 *   패턴 사전을 훑어 "중심을 지나는" 가장 강한 모양을 반환한다.
 *   장목(overline)은 연속 길이로 별도 판정한다(흑 금수 판정에 필요).
 *
 * 시간복잡도:
 *   analyzePoint: 4방향 × (윈도우 생성 11 + 사전 매칭 상수) = O(1).
 *   tallyBoard:   모든 라인(약 4·19개 라인, 총 셀 4·CELLS) 1패스 = O(CELLS).
 */
import { SIZE, CELLS, EMPTY, DIRS, idx, rowOf, colOf, inBounds, opp, PAT } from './constants.js';

// 강도순 패턴 사전. 각 항목은 [카테고리, [문자열 패턴…]].
// 자기='1', 빈='0', 막힘(상대/벽)='2'. 순서가 중요(강한 것부터 매칭).
const TIERS = [
  [PAT.FIVE,       ['11111']],
  [PAT.OPEN_FOUR,  ['011110']],
  // 4 (한 수면 5): 직사·간접(틈) 4 모두. 열린4 다음에 검사되므로 단4로 분류됨.
  [PAT.FOUR,       ['11110', '01111', '11011', '10111', '11101']],
  // 열린3 (한 수면 열린4): 직3 + 틈3.
  [PAT.OPEN_THREE, ['011100', '001110', '011010', '010110', '0011100']],
  // 막힌3 / 끝쪽3 (한 수면 4지만 한쪽이 막힘).
  [PAT.THREE,      ['211100', '001112', '211010', '010112', '210110', '011012',
                    '10110', '01101', '2011100', '0011102']],
  // 열린2.
  [PAT.OPEN_TWO,   ['001100', '011000', '000110', '010100', '001010', '010010']],
  // 막힌2.
  [PAT.TWO,        ['211000', '000112', '21100', '00112', '210100', '001012']],
  [PAT.ONE,        ['01100', '00110', '010']],
];

const CENTER = 5; // 길이 11 윈도우에서 착수점의 인덱스

/** 패턴 pat 이 문자열 s 안에서 center 인덱스를 지나며 등장하는가? */
function hitsCenter(s, pat, center) {
  let i = s.indexOf(pat);
  while (i !== -1) {
    if (i <= center && center < i + pat.length) return true;
    i = s.indexOf(pat, i + 1);
  }
  return false;
}

/**
 * 한 방향(dr,dc) 라인의 윈도우 문자열을 만든다. 중심(착수점)은 강제로 '1'.
 * cells 는 Int8Array, (r,c)는 착수점, p는 두는 색.
 */
function lineWindow(cells, p, r, c, dr, dc) {
  let s = '';
  for (let k = -5; k <= 5; k++) {
    if (k === 0) { s += '1'; continue; }   // 착수점은 자기돌로 가정
    const rr = r + dr * k, cc = c + dc * k;
    if (!inBounds(rr, cc)) { s += '2'; continue; }   // 벽 = 막힘
    const v = cells[idx(rr, cc)];
    s += v === EMPTY ? '0' : v === p ? '1' : '2';
  }
  return s;
}

/** 착수점 중심 연속 동색 길이(장목 판정용). */
function runLength(cells, p, r, c, dr, dc) {
  let len = 1;
  for (let s = 1; s >= -1; s -= 2) {
    let rr = r + dr * s, cc = c + dc * s;
    while (inBounds(rr, cc) && cells[idx(rr, cc)] === p) { len++; rr += dr * s; cc += dc * s; }
  }
  return len;
}

/**
 * analyzePoint — 빈칸 (r,c)에 p가 두었을 때 만들어지는 모양을 분석.
 * 반환: {
 *   win:boolean,        // 정확히 5목 완성(흑) / 5목 이상(백)
 *   overline:boolean,   // 6목 이상(흑 장목)
 *   dirs:[cat×4],       // 방향별 최강 모양 카테고리
 *   counts:{FOUR,OPEN_FOUR,OPEN_THREE,THREE,OPEN_TWO,TWO,ONE}
 * }
 * 주의: cells[idx(r,c)] 는 EMPTY 여야 한다(가정 착수).
 */
export function analyzePoint(cells, p, r, c) {
  const counts = { FOUR: 0, OPEN_FOUR: 0, OPEN_THREE: 0, THREE: 0, OPEN_TWO: 0, TWO: 0, ONE: 0 };
  const dirs = [];
  let hasFive = false, overline = false;

  for (const [dr, dc] of DIRS) {
    const run = runLength(cells, p, r, c, dr, dc);
    if (run >= 6) overline = true;
    if (run === 5) hasFive = true;

    const s = lineWindow(cells, p, r, c, dr, dc);
    let cat = PAT.NONE;
    for (const [name, pats] of TIERS) {
      let matched = false;
      for (const pat of pats) if (hitsCenter(s, pat, CENTER)) { matched = true; break; }
      if (matched) { cat = name; break; }
    }
    dirs.push(cat);
    if (cat !== PAT.NONE && cat !== PAT.FIVE && counts[cat] !== undefined) counts[cat]++;
  }

  // 백: 5목 이상이면 승리. 흑: 정확히 5목만 승리(장목은 승리 아님).
  // p 색은 호출자가 판단; 여기서는 hasFive(정확히5)와 overline(6+)을 분리 제공.
  const win = hasFive; // 흑/백 공통으로 "정확히 5"는 승리. 백의 6+승리는 아래 helper에서 처리.
  return { win, hasFive, overline, dirs, counts };
}

/**
 * 보드 전체 라인을 스캔하여 색 p 의 모양 개수를 집계한다.
 * 정적 평가/승률용. 라인 문자열에서 카테고리별 등장 횟수를 센다.
 * (중복 카운트를 줄이기 위해 강한 패턴부터 마스킹하며 카운트한다.)
 */
export function tallyBoard(cells, p) {
  const t = { FIVE: 0, OPEN_FOUR: 0, FOUR: 0, OPEN_THREE: 0, THREE: 0, OPEN_TWO: 0, TWO: 0 };

  // 모든 라인을 생성: 4방향 각각, 라인 시작점은 보드 가장자리.
  const lines = [];
  // 가로
  for (let r = 0; r < SIZE; r++) lines.push(buildLine(cells, p, r, 0, 0, 1));
  // 세로
  for (let c = 0; c < SIZE; c++) lines.push(buildLine(cells, p, 0, c, 1, 0));
  // ↘ 대각 (두 변에서 출발)
  for (let r = 0; r < SIZE; r++) lines.push(buildLine(cells, p, r, 0, 1, 1));
  for (let c = 1; c < SIZE; c++) lines.push(buildLine(cells, p, 0, c, 1, 1));
  // ↗ 대각
  for (let r = 0; r < SIZE; r++) lines.push(buildLine(cells, p, r, 0, 1, -1));
  for (let c = 1; c < SIZE; c++) lines.push(buildLine(cells, p, SIZE - 1, c, -1, 1));

  for (const line of lines) countInLine(line, t);
  return t;
}

/** (r,c)에서 (dr,dc)방향으로 보드 끝까지의 라인 문자열을 만든다. 벽 패딩 '2' 포함. */
function buildLine(cells, p, r, c, dr, dc) {
  let s = '2'; // 시작 벽
  let rr = r, cc = c;
  while (inBounds(rr, cc)) {
    const v = cells[idx(rr, cc)];
    s += v === EMPTY ? '0' : v === p ? '1' : '2';
    rr += dr; cc += dc;
  }
  return s + '2'; // 끝 벽
}

// 전체 라인 카운트용 패턴 (경계 포함, 강→약 순서로 마스킹).
const LINE_PATTERNS = [
  ['FIVE', ['11111']],
  ['OPEN_FOUR', ['011110']],
  ['FOUR', ['211110', '011112', '11011', '10111', '11101']],
  ['OPEN_THREE', ['0011100', '011010', '010110', '0011100']],
  ['THREE', ['2011100', '0011102', '211100', '001112']],
  ['OPEN_TWO', ['001100', '011000', '000110']],
  ['TWO', ['211000', '000112']],
];

/** 라인 문자열에서 패턴별 등장 횟수를 누적한다(겹침 마스킹). */
function countInLine(line, t) {
  let s = line;
  for (const [cat, pats] of LINE_PATTERNS) {
    for (const pat of pats) {
      let i = s.indexOf(pat);
      while (i !== -1) {
        t[cat]++;
        // 매칭 구간의 자기돌('1')을 'x'로 마스킹하여 하위 패턴 중복 카운트 방지
        s = s.slice(0, i) + s.slice(i, i + pat.length).replace(/1/g, 'x') + s.slice(i + pat.length);
        i = s.indexOf(pat, i + 1);
      }
    }
  }
}

/**
 * 헬퍼: (r,c)에 p가 두면 즉시 승리(5목, 백은 5목 이상)인가?
 * 흑: 정확히 5 (장목 제외).  백: 5 이상.
 */
export function isWinningMove(cells, p, r, c) {
  const a = analyzePointRun(cells, p, r, c);
  if (p === 1) return a.max === 5;          // 흑은 정확히 5
  return a.max >= 5;                        // 백은 5 이상
}

/** 4방향 최대 연속 길이만 빠르게 구한다(승리 판정 경량 버전). */
export function analyzePointRun(cells, p, r, c) {
  let max = 1;
  for (const [dr, dc] of DIRS) {
    const len = runLength(cells, p, r, c, dr, dc);
    if (len > max) max = len;
  }
  return { max };
}

export { runLength };
