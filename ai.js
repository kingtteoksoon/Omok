/*
 * 오목 AI 엔진 — 난이도 "개미친 어려움" (심화 탐색 버전)
 *
 * 전략:
 *  1. 즉시 이길 수 있으면 둔다.
 *  2. 상대가 다음 수에 이기면 막는다.
 *  3. 반복 심화(Iterative Deepening) + 알파-베타 가지치기 미니맥스로
 *     시간 예산 안에서 최대한 깊게 탐색한다.
 *  4. 주 변화수순(PV)을 추출해 "내 수 → 상대 예측 수 → 내 수 …"를 보고한다.
 *
 * 보드 표현: 0 = 빈칸, 1 = 흑, 2 = 백
 */
(function (global) {
  'use strict';

  const SIZE = 15; // 오목판 한 변 칸 수
  const EMPTY = 0; // 빈칸 표현값 (1 = 흑, 2 = 백)

  // 패턴을 검사할 4개의 축 방향.
  // 8방향이 아니라 4축만 보는 이유: (1,0)과 (-1,0)은 같은 '가로줄'이므로,
  // 한 축에서 양쪽(정/역방향)을 함께 세면 8방향을 모두 커버한다.
  const LINES = [
    [1, 0], // 가로 —
    [0, 1], // 세로 |
    [1, 1], // 대각 ＼
    [1, -1], // 대각 ／
  ];

  // 패턴별 가치 점수표. 값의 자릿수 차이가 곧 우선순위다.
  //  - FIVE       : 5목 완성 (승리)
  //  - OPEN_FOUR  : 열린 4 (양끝 모두 빈칸) → 막아도 다음 수에 5목, 사실상 승리
  //  - FOUR       : 닫힌 4 (한쪽만 열림) → 반드시 막아야 하는 강한 위협
  //  - OPEN_THREE : 열린 3 → 방치하면 열린 4가 되는 위협
  //  - THREE      : 닫힌 3
  //  - OPEN_TWO/TWO/ONE : 발전 가능성이 있는 약한 모양
  const SCORE = {
    FIVE: 10000000,
    OPEN_FOUR: 1000000,
    FOUR: 100000,
    OPEN_THREE: 50000,
    THREE: 1000,
    OPEN_TWO: 500,
    TWO: 100,
    ONE: 10,
  };

  // 학습(강화학습)으로 조정되는 '가중치'.
  //  - 5목/열린4/4 같은 전술적 모양은 거의 절대적이라 학습 대상에서 제외하고,
  //    포지셔널 모양(열린3·3·열린2·2·1)과 방어 계수만 곱셈 가중치로 학습한다.
  //  - 기본값 1.0(방어는 0.9) → 학습 전에는 기존과 동일하게 동작.
  //  - learning.js가 setWeights()로 갱신하고 localStorage에 저장한다.
  const W = {
    OPEN_THREE: 1,
    THREE: 1,
    OPEN_TWO: 1,
    TWO: 1,
    ONE: 1,
    defense: 0.9, // 후보 정렬 시 방어 가치에 곱하는 계수
  };

  // 연속 길이(count)와 열린 끝 수(openEnds)로 모양의 점수를 계산한다.
  // evalDirection / lineScore가 공통으로 쓰는 매핑. 학습 가중치(W)를 반영한다.
  function shapeScore(count, openEnds) {
    if (count >= 5) return SCORE.FIVE;
    if (count === 4) return openEnds === 2 ? SCORE.OPEN_FOUR : openEnds === 1 ? SCORE.FOUR : 0;
    if (count === 3) return openEnds === 2 ? SCORE.OPEN_THREE * W.OPEN_THREE : openEnds === 1 ? SCORE.THREE * W.THREE : 0;
    if (count === 2) return openEnds === 2 ? SCORE.OPEN_TWO * W.OPEN_TWO : openEnds === 1 ? SCORE.TWO * W.TWO : 0;
    if (count === 1) return openEnds === 2 ? SCORE.ONE * W.ONE : 0;
    return 0;
  }

  // 학습된 가중치를 적용/조회한다.
  function setWeights(partial) {
    if (partial) for (const k in W) if (k in partial && typeof partial[k] === 'number') W[k] = partial[k];
  }
  function getWeights() {
    return Object.assign({}, W);
  }

  // 탐색 도중 시간 예산을 초과했을 때, 깊은 재귀에서 한 번에 빠져나오기 위해
  // throw하는 신호 객체. (정상 반환값과 구분되도록 고유 객체를 사용)
  const ABORT = { abort: true };

  // 모듈 전역 탐색 상태:
  //  - nodeCount: 현재 깊이 탐색에서 방문한 노드 수 (성능 로그용)
  //  - deadline : 탐색을 멈춰야 하는 절대 시각(ms). Date.now()와 비교한다.
  let nodeCount = 0;
  let deadline = Infinity;

  function inBounds(x, y) {
    return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
  }

  function opponent(player) {
    return player === 1 ? 2 : 1;
  }

  // (x,y)에 player 돌을 놓는다고 가정하고, (dx,dy) 축에서 만들어지는 모양의
  // 가치를 평가한다. 그 자리 기준으로 정방향·역방향으로 같은 색이 몇 개
  // 연속되는지(count)와, 양 끝이 빈칸으로 열려 있는지(openEnds)를 센다.
  // → 후보 수의 '공격/방어 가치'를 빠르게 어림하는 데 쓴다(정렬·즉시판단용).
  function evalDirection(board, x, y, dx, dy, player) {
    let count = 1; // 놓을 돌 자신을 포함해 시작
    let openEnds = 0; // 열린 끝(빈칸으로 막힌) 개수

    // 정방향(+)으로 같은 색 연속 세기. 빈칸을 만나면 그쪽 끝은 '열림'.
    let i = 1;
    while (true) {
      const nx = x + dx * i, ny = y + dy * i;
      if (!inBounds(nx, ny)) break;
      const v = board[ny][nx];
      if (v === player) { count++; i++; }
      else if (v === EMPTY) { openEnds++; break; }
      else break; // 상대 돌 → 그쪽 끝은 막힘
    }
    // 역방향(-)으로도 동일하게 센다.
    i = 1;
    while (true) {
      const nx = x - dx * i, ny = y - dy * i;
      if (!inBounds(nx, ny)) break;
      const v = board[ny][nx];
      if (v === player) { count++; i++; }
      else if (v === EMPTY) { openEnds++; break; }
      else break;
    }

    // 연속 길이와 열림 정도를 (학습 가중치가 반영된) 점수로 매핑.
    // (열림이 0이면 양끝이 다 막혀 발전 불가 → 0점)
    return shapeScore(count, openEnds);
  }

  // (x,y)에 player가 둘 때의 한 점 가치 = 4축 평가의 합.
  // 후보 수 정렬과 즉시 위협 판단의 휴리스틱으로 사용.
  function pointScore(board, x, y, player) {
    let total = 0;
    for (const [dx, dy] of LINES) total += evalDirection(board, x, y, dx, dy, player);
    return total;
  }

  // 이미 놓인 돌들로 이루어진 '한 줄'을 그 줄의 시작점(x,y)에서부터 평가한다.
  // evalDirection이 '놓을 후보 한 점'을 보는 것과 달리, 이쪽은 보드 전체를
  // 훑는 evaluateBoard에서 실제 모양의 점수를 매기는 데 쓴다.
  function lineScore(board, x, y, dx, dy, v) {
    // 시작점에서 같은 색(v)이 이어지는 길이를 센다.
    let count = 0, cx = x, cy = y;
    while (inBounds(cx, cy) && board[cy][cx] === v) { count++; cx += dx; cy += dy; }
    // 줄의 앞쪽(시작점 직전)과 뒤쪽(연속이 끝난 칸)이 빈칸인지로 열림 판정.
    const beforeOpen = inBounds(x - dx, y - dy) && board[y - dy][x - dx] === EMPTY;
    const afterOpen = inBounds(cx, cy) && board[cy][cx] === EMPTY;
    const openEnds = (beforeOpen ? 1 : 0) + (afterOpen ? 1 : 0);

    return shapeScore(count, openEnds);
  }

  // 보드 전체를 aiPlayer 관점에서 정적 평가한다(미니맥스의 잎 노드 평가 함수).
  // 내 돌이 만든 모양은 +, 상대 모양은 - 로 합산한다.
  // 값이 클수록 AI에게 유리한 국면.
  function evaluateBoard(board, aiPlayer) {
    let score = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const v = board[y][x];
        if (v === EMPTY) continue;
        for (const [dx, dy] of LINES) {
          // 한 줄을 그 줄의 '시작점'에서 한 번만 평가한다.
          // 바로 앞 칸이 같은 색이면 이 칸은 시작점이 아니므로 건너뛴다
          // → 같은 줄을 여러 번 세는 중복 계산 방지.
          if (inBounds(x - dx, y - dy) && board[y - dy][x - dx] === v) continue;
          const s = lineScore(board, x, y, dx, dy, v);
          score += v === aiPlayer ? s : -s;
        }
      }
    }
    return score;
  }

  // (x,y)에 player가 (이미 놓았다고 가정하고) 5목 이상이 만들어지는지 검사.
  // 4축 각각에 대해 양방향 연속 길이를 합쳐 5 이상이면 승리.
  function isWinningMove(board, x, y, player) {
    for (const [dx, dy] of LINES) {
      let count = 1, i = 1;
      // 정방향 연속
      while (inBounds(x + dx * i, y + dy * i) && board[y + dy * i][x + dx * i] === player) { count++; i++; }
      i = 1;
      // 역방향 연속
      while (inBounds(x - dx * i, y - dy * i) && board[y - dy * i][x - dx * i] === player) { count++; i++; }
      if (count >= 5) return true;
    }
    return false;
  }

  /* --------------------------------------------------------------------------
   *  금지수(3-3, 쌍삼) 판정
   * --------------------------------------------------------------------------
   *  3-3(쌍삼): 한 수로 '열린 3(활삼)'을 동시에 둘 개 이상 만드는 수.
   *  본 게임에서는 흑·백 모두에게 금지한다. (단, 그 수로 5목이 완성되면
   *  승리가 우선이므로 금지가 아니다.)
   *
   *  '열린 3(활삼)' 판정: 한 축의 라인을 문자열로 만들어(나=1, 빈칸=0, 벽/상대=2)
   *  아래 패턴이 들어 있으면 활삼으로 본다. 패턴은 모두 양옆이 비어 있어
   *  '열린 4'로 발전 가능한 모양만 골랐다.
   *    001110 / 011100 : 한쪽에 두 칸 여유가 있는 연속 3   (.XXX. 류)
   *    010110 / 011010 : 한 칸 띈 3(뚫린 삼)               (.X.XX. / .XX.X.)
   * ------------------------------------------------------------------------ */
  const OPEN_THREE_PATTERNS = ['001110', '011100', '010110', '011010'];

  // (x,y)에 player 돌이 이미 있다고 보고, (dx,dy) 축에 활삼이 있는지 검사.
  // 착수점을 중심(-5..+5)으로 한 길이 11 문자열을 만들어 패턴을 찾는다.
  // (길이 6 패턴은 이 윈도우에서 반드시 중심(착수점)을 포함하므로,
  //  '이 수로 새로 생긴 3'만 잡힌다.)
  function hasOpenThreeOnAxis(board, x, y, dx, dy, player) {
    let s = '';
    for (let k = -5; k <= 5; k++) {
      const nx = x + dx * k, ny = y + dy * k;
      if (!inBounds(nx, ny)) { s += '2'; continue; } // 판 밖 = 벽
      const v = board[ny][nx];
      s += v === player ? '1' : v === EMPTY ? '0' : '2';
    }
    for (const p of OPEN_THREE_PATTERNS) if (s.indexOf(p) !== -1) return true;
    return false;
  }

  // (x,y)가 빈칸일 때 player가 두면 활삼이 몇 개 생기는지(축 단위로 count).
  function countOpenThrees(board, x, y, player) {
    board[y][x] = player; // 가상 착수
    let cnt = 0;
    for (const [dx, dy] of LINES) {
      if (hasOpenThreeOnAxis(board, x, y, dx, dy, player)) cnt++;
    }
    board[y][x] = EMPTY; // 원복
    return cnt;
  }

  // (x,y)가 player에게 3-3 금지수인지. 5목 완성 수는 예외(승리 우선).
  function isForbidden(board, x, y, player) {
    if (!inBounds(x, y) || board[y][x] !== EMPTY) return false;
    board[y][x] = player;
    const win = isWinningMove(board, x, y, player);
    board[y][x] = EMPTY;
    if (win) return false; // 5목이면 금지 아님
    return countOpenThrees(board, x, y, player) >= 2;
  }

  // 평가 점수(AI 관점, 클수록 유리)를 AI 승률(%)로 변환한다.
  // 로지스틱 함수로 0~100% 사이에 매끄럽게 매핑한다.
  //  점수 0 → 50%, 활삼(5만) → 약 62%, 4(10만) → 약 73%,
  //  열린4(100만)·5목(1천만) → 거의 100%.
  function scoreToWinRate(score) {
    const p = 1 / (1 + Math.exp(-score / 100000));
    return Math.round(p * 100);
  }

  // 탐색 후보(둘 만한 빈칸)를 생성한다.
  // 15x15 = 225칸을 모두 탐색하면 너무 느리므로, '이미 놓인 돌의 주변
  // radius칸 이내'의 빈칸만 후보로 삼는다(오목은 기존 돌 근처에서 수가 난다).
  function generateMoves(board, radius) {
    radius = radius || 2;
    const seen = new Set(); // 중복 후보 제거용
    const moves = [];
    let hasStone = false; // 판에 돌이 하나라도 있는지
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (board[y][x] === EMPTY) continue;
        hasStone = true;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx, ny = y + dy;
            if (!inBounds(nx, ny) || board[ny][nx] !== EMPTY) continue;
            const key = ny * SIZE + nx;
            if (seen.has(key)) continue;
            seen.add(key);
            moves.push([nx, ny]);
          }
        }
      }
    }
    // 판이 비었으면 정석대로 천원(중앙)에 첫 수를 둔다.
    if (!hasStone) {
      const c = Math.floor(SIZE / 2);
      return [[c, c]];
    }
    return moves;
  }

  // 후보 수를 '공격 가치 + 방어 가치'로 점수 매겨 내림차순 정렬하고
  // 상위 limit개만 돌려준다.
  //  - 좋은 수를 먼저 탐색할수록 알파-베타 가지치기가 잘 일어나 탐색이 빨라진다.
  //  - 방어 가치(상대가 그 자리에 뒀을 때의 가치)에 0.9를 곱해, 동등하면
  //    공격을 약간 우선한다.
  //  - 3-3 금지수는 후보에서 제외한다(흑·백 모두). 단, 모든 후보가 금지수인
  //    드문 경우에는 금지를 무시하고 전체를 후보로 돌려준다.
  function orderedMoves(board, player, limit) {
    const opp = opponent(player);
    const raw = generateMoves(board, 2);

    const scored = [];
    for (const [x, y] of raw) {
      if (isForbidden(board, x, y, player)) continue; // 금지수 제외
      const atk = pointScore(board, x, y, player); // 내가 두면 얼마나 좋은가
      const def = pointScore(board, x, y, opp); // 상대가 두면 얼마나 위험한가
      scored.push({ x, y, score: atk + def * W.defense });
    }
    // 둘 곳이 전부 금지수면 어쩔 수 없이 금지 무시
    if (scored.length === 0) {
      for (const [x, y] of raw) {
        const atk = pointScore(board, x, y, player);
        const def = pointScore(board, x, y, opp);
        scored.push({ x, y, score: atk + def * W.defense });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const top = limit ? scored.slice(0, limit) : scored;
    return top.map((m) => [m.x, m.y]);
  }

  const INNER_LIMIT = 10; // 내부(루트가 아닌) 노드에서 살펴볼 최대 후보 수

  // 알파-베타 가지치기 미니맥스.
  //  - maximizing=true  : AI 차례(점수를 최대화)
  //  - maximizing=false : 상대 차례(점수를 최소화)
  //  - alpha: 지금까지 'AI가 최소한 확보한' 점수 하한
  //  - beta : 지금까지 '상대가 허용하는' 점수 상한
  //    → beta <= alpha 가 되면 더 봐도 결과가 안 바뀌므로 가지를 친다(break).
  // 반환: { score, line } — line은 이 노드에서 이어지는 최선의 수순(PV) 일부.
  //
  // 주의: 이 함수는 board를 직접 수정했다가 되돌린다. 호출부(bestMove)는
  //       반드시 '복사본'을 넘겨 원본 보드가 오염되지 않도록 한다.
  function minimax(board, depth, alpha, beta, maximizing, aiPlayer) {
    nodeCount++;
    // 1024노드마다 한 번씩만 시계를 확인(Date.now 비용 절감). 예산 초과 시 탈출.
    if ((nodeCount & 1023) === 0 && Date.now() > deadline) throw ABORT;

    // 잎 노드: 더 내려가지 않고 현재 국면을 정적 평가.
    if (depth === 0) {
      return { score: evaluateBoard(board, aiPlayer), line: [] };
    }

    const human = opponent(aiPlayer);
    const current = maximizing ? aiPlayer : human; // 이 노드에서 둘 사람
    const moves = orderedMoves(board, current, INNER_LIMIT);
    if (moves.length === 0) {
      return { score: evaluateBoard(board, aiPlayer), line: [] };
    }

    let bestLine = [];

    if (maximizing) {
      // --- AI 차례: 점수를 최대화 ---
      let best = -Infinity;
      for (const [x, y] of moves) {
        board[y][x] = aiPlayer; // 가상으로 둬본다
        // 이 수로 바로 이기면 더 깊이 볼 필요 없음.
        // 점수에 depth를 더해 '더 빨리(얕은 깊이에서) 이기는' 수를 선호.
        if (isWinningMove(board, x, y, aiPlayer)) {
          board[y][x] = EMPTY;
          return { score: SCORE.FIVE + depth, line: [[x, y]] };
        }
        const r = minimax(board, depth - 1, alpha, beta, false, aiPlayer);
        board[y][x] = EMPTY; // 되돌리기 (백트래킹)
        if (r.score > best) {
          best = r.score;
          bestLine = [[x, y], ...r.line]; // 이 수 + 이후 최선 수순
        }
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break; // 베타 컷오프
      }
      return { score: best, line: bestLine };
    } else {
      // --- 상대 차례: 점수를 최소화 ---
      let best = Infinity;
      for (const [x, y] of moves) {
        board[y][x] = human;
        // 상대가 바로 이기면 AI에겐 최악. 빨리 지는 경우일수록 더 나쁘게 본다.
        if (isWinningMove(board, x, y, human)) {
          board[y][x] = EMPTY;
          return { score: -SCORE.FIVE - depth, line: [[x, y]] };
        }
        const r = minimax(board, depth - 1, alpha, beta, true, aiPlayer);
        board[y][x] = EMPTY;
        if (r.score < best) {
          best = r.score;
          bestLine = [[x, y], ...r.line];
        }
        beta = Math.min(beta, best);
        if (beta <= alpha) break; // 알파 컷오프
      }
      return { score: best, line: bestLine };
    }
  }

  const ROOT_LIMIT = 16; // 루트에서 살펴볼 최대 후보 수 (내부보다 넓게)

  // 루트(최상위) 탐색.
  // minimax와 같은 일을 하되, '모든 후보 수의 점수와 PV'를 함께 모은다.
  // → 로그 패널에서 "후보 평가"와 "예측 수순"을 보여주기 위함.
  function searchRoot(board, depth, aiPlayer) {
    const moves = orderedMoves(board, aiPlayer, ROOT_LIMIT);
    let alpha = -Infinity;
    const beta = Infinity;
    let best = -Infinity;
    let bestMove = moves[0]; // 최선의 한 수
    let bestLine = [moves[0]]; // 그 수로 시작하는 최선 수순
    const scored = []; // 후보별 {x, y, score, line}

    for (const [x, y] of moves) {
      board[y][x] = aiPlayer;
      let val, line;
      if (isWinningMove(board, x, y, aiPlayer)) {
        val = SCORE.FIVE + depth;
        line = [];
      } else {
        const r = minimax(board, depth - 1, alpha, beta, false, aiPlayer);
        val = r.score;
        line = r.line;
      }
      board[y][x] = EMPTY;

      const fullLine = [[x, y], ...line];
      scored.push({ x, y, score: val, line: fullLine });
      if (val > best) {
        best = val;
        bestMove = [x, y];
        bestLine = fullLine;
      }
      alpha = Math.max(alpha, best);
    }

    scored.sort((a, b) => b.score - a.score); // 좋은 후보 순으로 정렬(로그용)
    return { move: bestMove, score: best, line: bestLine, scored };
  }

  // 좌표 배열 line([[x,y], ...])에 둘 사람 정보를 입힌 PV로 변환한다.
  // 수순은 firstPlayer(보통 AI)부터 한 수씩 번갈아 두므로, 짝수 인덱스는
  // firstPlayer, 홀수 인덱스는 상대 차례다.
  function lineToPV(line, firstPlayer) {
    return line.map(([x, y], idx) => ({
      x, y,
      player: idx % 2 === 0 ? firstPlayer : opponent(firstPlayer),
    }));
  }

  /**
   * 최선의 수를 계산하고 상세 분석을 반환한다.
   * @param {number[][]} board
   * @param {number} aiPlayer 1(흑)|2(백)
   * @param {object|number} options { maxDepth, timeLimit } 또는 깊이(숫자, 하위호환)
   * @returns {{x:number,y:number,analysis:object}}
   */
  function bestMove(board, aiPlayer, options) {
    if (typeof options === 'number') options = { maxDepth: options };
    options = options || {};
    const maxDepth = options.maxDepth || 10;
    const timeLimit = options.timeLimit || 1500;

    // 중요: 탐색은 복사본에서만 수행한다.
    // 미니맥스는 보드를 직접 수정하며, 시간 초과 시 예외가 복원 코드를
    // 건너뛸 수 있다. 원본 보드를 넘기면 가상으로 둔 돌이 실제로 남아버린다.
    // 복사본을 쓰면 원본은 절대 변경되지 않으므로 AI는 "생각만" 한다.
    board = board.map((row) => row.slice());

    const human = opponent(aiPlayer);
    const t0 = Date.now();
    const analysis = {
      reason: 'search',
      depth: 0,
      nodes: 0,
      timeMs: 0,
      score: 0,
      pv: [],
      topMoves: [],
      perDepth: [],
    };

    const candidates = generateMoves(board, 2);

    // --- 우선순위 0: 첫 수면 중앙(천원)에 둔다 ---
    // generateMoves는 빈 판일 때 중앙 한 점만 반환한다.
    if (candidates.length === 1) {
      analysis.reason = 'opening';
      analysis.timeMs = Date.now() - t0;
      analysis.pv = lineToPV([candidates[0]], aiPlayer);
      analysis.winRate = scoreToWinRate(analysis.score);
      return { x: candidates[0][0], y: candidates[0][1], analysis };
    }

    // --- 우선순위 1: 한 수로 바로 이길 수 있으면 즉시 둔다 ---
    for (const [x, y] of candidates) {
      board[y][x] = aiPlayer;
      const win = isWinningMove(board, x, y, aiPlayer);
      board[y][x] = EMPTY;
      if (win) {
        analysis.reason = 'immediate_win';
        analysis.score = SCORE.FIVE;
        analysis.timeMs = Date.now() - t0;
        analysis.pv = lineToPV([[x, y]], aiPlayer);
        analysis.winRate = 100;
        return { x, y, analysis };
      }
    }

    // --- 우선순위 2: 상대가 다음 수에 이기는 자리면 막는다 ---
    // (그 자리에 상대 돌을 가정해 5목이 되면, 같은 자리에 내가 둬서 차단)
    for (const [x, y] of candidates) {
      board[y][x] = human;
      const win = isWinningMove(board, x, y, human);
      board[y][x] = EMPTY;
      if (win) {
        analysis.reason = 'block';
        analysis.timeMs = Date.now() - t0;
        analysis.pv = lineToPV([[x, y]], aiPlayer);
        // 막은 뒤의 국면도 평가해 점수로 기록(로그용)
        board[y][x] = aiPlayer;
        analysis.score = evaluateBoard(board, aiPlayer);
        board[y][x] = EMPTY;
        analysis.winRate = scoreToWinRate(analysis.score);
        return { x, y, analysis };
      }
    }

    // --- 우선순위 3: 반복 심화(Iterative Deepening) 탐색 ---
    // 깊이 2부터 1씩 늘려가며 매번 처음부터 다시 탐색한다.
    // 언뜻 낭비 같지만: (1) 시간 예산이 끝나면 '마지막으로 완료한 깊이'의
    // 결과를 그대로 쓸 수 있고, (2) 얕은 탐색의 결과가 깊은 탐색의 수 정렬을
    // 도와 알파-베타 효율을 높인다.
    deadline = t0 + timeLimit; // 이 시각을 넘기면 minimax가 ABORT를 던진다
    let bestResult = null; // 마지막으로 '완료한' 깊이의 결과

    for (let depth = 2; depth <= maxDepth; depth++) {
      nodeCount = 0;
      let result;
      try {
        result = searchRoot(board, depth, aiPlayer);
      } catch (e) {
        // 시간 초과로 중단됐다면 이 깊이는 미완성 → 버리고 직전 결과 사용
        if (e === ABORT) break;
        throw e;
      }

      bestResult = result; // 이 깊이를 끝까지 완료했으니 채택
      const elapsed = Date.now() - t0;
      // 깊이별 진행 상황을 로그용으로 기록
      analysis.perDepth.push({
        depth,
        score: result.score,
        nodes: nodeCount,
        ms: elapsed,
        pv: lineToPV(result.line, aiPlayer),
      });
      analysis.nodes += nodeCount;
      analysis.depth = depth;

      // 승리/패배가 확정된 수순을 찾았으면 더 깊이 볼 필요 없음
      if (Math.abs(result.score) >= SCORE.FIVE) break;
      // 시간 예산을 이미 넘겼으면 다음(더 무거운) 깊이는 시작하지 않음
      if (elapsed > timeLimit) break;
    }

    if (!bestResult) {
      // 만일 깊이 2조차 완료 못 했다면(극단적 시간 부족) 한 수 휴리스틱으로 폴백
      const ordered = orderedMoves(board, aiPlayer, 1);
      analysis.timeMs = Date.now() - t0;
      analysis.pv = lineToPV([ordered[0]], aiPlayer);
      analysis.winRate = scoreToWinRate(analysis.score);
      return { x: ordered[0][0], y: ordered[0][1], analysis };
    }

    // 경험 메모리(학습된 오프닝 북) 반영:
    //  options.bookBonus(x, y)가 주어지면, 후보들의 탐색 점수에 '과거 이 수가
    //  승리로 이어진 정도'를 더해 다시 최선 수를 고른다. (이긴 수 선호/진 수 회피)
    //  보너스 크기는 전술 점수보다 작게 설계되어, 비등한 후보들 사이의 '취향'만
    //  바꾸고 명백한 전술적 수는 뒤집지 않는다(learning.js의 BOOK_SCALE 참고).
    let chosen = bestResult.scored[0] || { x: bestResult.move[0], y: bestResult.move[1], score: bestResult.score, line: bestResult.line };
    if (typeof options.bookBonus === 'function' && bestResult.scored.length) {
      let bestVal = -Infinity;
      for (const m of bestResult.scored) {
        const v = m.score + (options.bookBonus(m.x, m.y) || 0);
        m.adjScore = v;
        if (v > bestVal) { bestVal = v; chosen = m; }
      }
    } else {
      // 보너스가 없으면 탐색이 고른 최선 수를 그대로 사용
      chosen = { x: bestResult.move[0], y: bestResult.move[1], score: bestResult.score, line: bestResult.line };
    }

    // 최종 분석 정보 채우기
    analysis.score = chosen.score;
    analysis.timeMs = Date.now() - t0;
    analysis.pv = lineToPV(chosen.line || [[chosen.x, chosen.y]], aiPlayer); // 예측 수순
    analysis.winRate = scoreToWinRate(chosen.score); // AI 승률(%)
    analysis.topMoves = bestResult.scored.slice(0, 6).map((m) => ({
      x: m.x, y: m.y, score: m.score, // 상위 6개 후보와 점수
    }));

    return { x: chosen.x, y: chosen.y, analysis };
  }

  // 외부(game.js)로 공개하는 API
  // - bestMove: 다음 수 + 분석 반환 (탐색은 복사본에서, 원본 보드 불변)
  // - isForbidden: 3-3 금지수 여부 (사람 착수 제한에 사용)
  // - scoreToWinRate: 평가 점수 → 승률(%) 변환
  // - isWinningMove / evaluateBoard / opponent: 보조 유틸

  global.OmokAI = {
    SIZE,
    EMPTY,
    SCORE,
    bestMove,
    isForbidden,
    scoreToWinRate,
    isWinningMove,
    evaluateBoard,
    opponent,
    setWeights, // 학습된 평가 가중치 적용
    getWeights, // 현재 가중치 조회
  };
})(typeof window !== 'undefined' ? window : globalThis);
