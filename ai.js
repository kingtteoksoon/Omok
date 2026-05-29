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

  const SIZE = 15;
  const EMPTY = 0;

  // 4축 (가로, 세로, 두 대각선)
  const LINES = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

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

  // 탐색 도중 시간 초과 시 깔끔하게 빠져나오기 위한 신호
  const ABORT = { abort: true };

  let nodeCount = 0;
  let deadline = Infinity;

  function inBounds(x, y) {
    return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
  }

  function opponent(player) {
    return player === 1 ? 2 : 1;
  }

  // (x,y)에 player 돌이 있다고 보고 한 축의 패턴 가치 평가
  function evalDirection(board, x, y, dx, dy, player) {
    let count = 1;
    let openEnds = 0;

    let i = 1;
    while (true) {
      const nx = x + dx * i, ny = y + dy * i;
      if (!inBounds(nx, ny)) break;
      const v = board[ny][nx];
      if (v === player) { count++; i++; }
      else if (v === EMPTY) { openEnds++; break; }
      else break;
    }
    i = 1;
    while (true) {
      const nx = x - dx * i, ny = y - dy * i;
      if (!inBounds(nx, ny)) break;
      const v = board[ny][nx];
      if (v === player) { count++; i++; }
      else if (v === EMPTY) { openEnds++; break; }
      else break;
    }

    if (count >= 5) return SCORE.FIVE;
    if (count === 4) return openEnds === 2 ? SCORE.OPEN_FOUR : openEnds === 1 ? SCORE.FOUR : 0;
    if (count === 3) return openEnds === 2 ? SCORE.OPEN_THREE : openEnds === 1 ? SCORE.THREE : 0;
    if (count === 2) return openEnds === 2 ? SCORE.OPEN_TWO : openEnds === 1 ? SCORE.TWO : 0;
    if (count === 1) return openEnds === 2 ? SCORE.ONE : 0;
    return 0;
  }

  // (x,y)에 player가 둘 때의 가치 (4축 합)
  function pointScore(board, x, y, player) {
    let total = 0;
    for (const [dx, dy] of LINES) total += evalDirection(board, x, y, dx, dy, player);
    return total;
  }

  // 줄 시작점에서 연속 길이/열림으로 점수 산정
  function lineScore(board, x, y, dx, dy, v) {
    let count = 0, cx = x, cy = y;
    while (inBounds(cx, cy) && board[cy][cx] === v) { count++; cx += dx; cy += dy; }
    const beforeOpen = inBounds(x - dx, y - dy) && board[y - dy][x - dx] === EMPTY;
    const afterOpen = inBounds(cx, cy) && board[cy][cx] === EMPTY;
    const openEnds = (beforeOpen ? 1 : 0) + (afterOpen ? 1 : 0);

    if (count >= 5) return SCORE.FIVE;
    if (count === 4) return openEnds === 2 ? SCORE.OPEN_FOUR : openEnds === 1 ? SCORE.FOUR : 0;
    if (count === 3) return openEnds === 2 ? SCORE.OPEN_THREE : openEnds === 1 ? SCORE.THREE : 0;
    if (count === 2) return openEnds === 2 ? SCORE.OPEN_TWO : openEnds === 1 ? SCORE.TWO : 0;
    if (count === 1) return openEnds === 2 ? SCORE.ONE : 0;
    return 0;
  }

  // 보드 전체를 aiPlayer 관점에서 평가
  function evaluateBoard(board, aiPlayer) {
    let score = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const v = board[y][x];
        if (v === EMPTY) continue;
        for (const [dx, dy] of LINES) {
          // 줄 시작점에서만 평가해 중복 방지
          if (inBounds(x - dx, y - dy) && board[y - dy][x - dx] === v) continue;
          const s = lineScore(board, x, y, dx, dy, v);
          score += v === aiPlayer ? s : -s;
        }
      }
    }
    return score;
  }

  // (x,y)에 player가 두면 5목이 되는지
  function isWinningMove(board, x, y, player) {
    for (const [dx, dy] of LINES) {
      let count = 1, i = 1;
      while (inBounds(x + dx * i, y + dy * i) && board[y + dy * i][x + dx * i] === player) { count++; i++; }
      i = 1;
      while (inBounds(x - dx * i, y - dy * i) && board[y - dy * i][x - dx * i] === player) { count++; i++; }
      if (count >= 5) return true;
    }
    return false;
  }

  // 기존 돌 주변 빈칸 후보 생성
  function generateMoves(board, radius) {
    radius = radius || 2;
    const seen = new Set();
    const moves = [];
    let hasStone = false;
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
    if (!hasStone) {
      const c = Math.floor(SIZE / 2);
      return [[c, c]];
    }
    return moves;
  }

  // 공격+방어 가치로 정렬한 상위 후보
  function orderedMoves(board, player, limit) {
    const opp = opponent(player);
    const moves = generateMoves(board, 2);
    const scored = moves.map(([x, y]) => {
      const atk = pointScore(board, x, y, player);
      const def = pointScore(board, x, y, opp);
      return { x, y, score: atk + def * 0.9 };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = limit ? scored.slice(0, limit) : scored;
    return top.map((m) => [m.x, m.y]);
  }

  const INNER_LIMIT = 10; // 내부 노드 분기 제한

  // 알파-베타 미니맥스 (PV 라인 반환)
  function minimax(board, depth, alpha, beta, maximizing, aiPlayer) {
    nodeCount++;
    if ((nodeCount & 1023) === 0 && Date.now() > deadline) throw ABORT;

    if (depth === 0) {
      return { score: evaluateBoard(board, aiPlayer), line: [] };
    }

    const human = opponent(aiPlayer);
    const current = maximizing ? aiPlayer : human;
    const moves = orderedMoves(board, current, INNER_LIMIT);
    if (moves.length === 0) {
      return { score: evaluateBoard(board, aiPlayer), line: [] };
    }

    let bestLine = [];

    if (maximizing) {
      let best = -Infinity;
      for (const [x, y] of moves) {
        board[y][x] = aiPlayer;
        if (isWinningMove(board, x, y, aiPlayer)) {
          board[y][x] = EMPTY;
          return { score: SCORE.FIVE + depth, line: [[x, y]] };
        }
        const r = minimax(board, depth - 1, alpha, beta, false, aiPlayer);
        board[y][x] = EMPTY;
        if (r.score > best) {
          best = r.score;
          bestLine = [[x, y], ...r.line];
        }
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return { score: best, line: bestLine };
    } else {
      let best = Infinity;
      for (const [x, y] of moves) {
        board[y][x] = human;
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
        if (beta <= alpha) break;
      }
      return { score: best, line: bestLine };
    }
  }

  const ROOT_LIMIT = 16; // 루트 분기 제한

  // 루트 탐색: 모든 후보의 점수와 PV를 수집 (로그용)
  function searchRoot(board, depth, aiPlayer) {
    const moves = orderedMoves(board, aiPlayer, ROOT_LIMIT);
    let alpha = -Infinity;
    const beta = Infinity;
    let best = -Infinity;
    let bestMove = moves[0];
    let bestLine = [moves[0]];
    const scored = [];

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

    scored.sort((a, b) => b.score - a.score);
    return { move: bestMove, score: best, line: bestLine, scored };
  }

  // 라인([[x,y],...])을 플레이어 정보가 붙은 PV로 변환
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

    // 첫 수: 중앙
    if (candidates.length === 1) {
      analysis.reason = 'opening';
      analysis.timeMs = Date.now() - t0;
      analysis.pv = lineToPV([candidates[0]], aiPlayer);
      return { x: candidates[0][0], y: candidates[0][1], analysis };
    }

    // 1) 즉시 승리
    for (const [x, y] of candidates) {
      board[y][x] = aiPlayer;
      const win = isWinningMove(board, x, y, aiPlayer);
      board[y][x] = EMPTY;
      if (win) {
        analysis.reason = 'immediate_win';
        analysis.score = SCORE.FIVE;
        analysis.timeMs = Date.now() - t0;
        analysis.pv = lineToPV([[x, y]], aiPlayer);
        return { x, y, analysis };
      }
    }

    // 2) 상대 즉시 승리 방어
    for (const [x, y] of candidates) {
      board[y][x] = human;
      const win = isWinningMove(board, x, y, human);
      board[y][x] = EMPTY;
      if (win) {
        analysis.reason = 'block';
        analysis.timeMs = Date.now() - t0;
        analysis.pv = lineToPV([[x, y]], aiPlayer);
        // 방어 후 평가도 기록
        board[y][x] = aiPlayer;
        analysis.score = evaluateBoard(board, aiPlayer);
        board[y][x] = EMPTY;
        return { x, y, analysis };
      }
    }

    // 3) 반복 심화 탐색
    deadline = t0 + timeLimit;
    let bestResult = null;

    for (let depth = 2; depth <= maxDepth; depth++) {
      nodeCount = 0;
      let result;
      try {
        result = searchRoot(board, depth, aiPlayer);
      } catch (e) {
        if (e === ABORT) break; // 시간 초과: 직전 깊이 결과 유지
        throw e;
      }

      bestResult = result;
      const elapsed = Date.now() - t0;
      analysis.perDepth.push({
        depth,
        score: result.score,
        nodes: nodeCount,
        ms: elapsed,
        pv: lineToPV(result.line, aiPlayer),
      });
      analysis.nodes += nodeCount;
      analysis.depth = depth;

      // 강제 승리/패배 확정 시 조기 종료
      if (Math.abs(result.score) >= SCORE.FIVE) break;
      // 시간 예산 초과 예상 시 종료
      if (elapsed > timeLimit) break;
    }

    if (!bestResult) {
      // 폴백: 한 수 평가
      const ordered = orderedMoves(board, aiPlayer, 1);
      analysis.timeMs = Date.now() - t0;
      analysis.pv = lineToPV([ordered[0]], aiPlayer);
      return { x: ordered[0][0], y: ordered[0][1], analysis };
    }

    analysis.score = bestResult.score;
    analysis.timeMs = Date.now() - t0;
    analysis.pv = lineToPV(bestResult.line, aiPlayer);
    analysis.topMoves = bestResult.scored.slice(0, 6).map((m) => ({
      x: m.x, y: m.y, score: m.score,
    }));

    return { x: bestResult.move[0], y: bestResult.move[1], analysis };
  }

  global.OmokAI = {
    SIZE,
    EMPTY,
    SCORE,
    bestMove,
    isWinningMove,
    evaluateBoard,
    opponent,
  };
})(typeof window !== 'undefined' ? window : globalThis);
