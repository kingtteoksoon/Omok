/*
 * 오목 AI 엔진 — 난이도 "개미친 어려움"
 *
 * 전략:
 *  1. 즉시 이길 수 있으면 둔다.
 *  2. 상대가 다음 수에 이기면 막는다.
 *  3. 그 외에는 패턴 기반 위협 평가 + 알파-베타 가지치기 미니맥스로 최적 수 탐색.
 *
 * 보드 표현: 0 = 빈칸, 1 = 흑, 2 = 백
 */
(function (global) {
  'use strict';

  const SIZE = 15;
  const EMPTY = 0;

  // 8방향이 아닌 4축(가로, 세로, 두 대각선)
  const LINES = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

  // 패턴 점수 (한쪽 기준 평가에 사용)
  const SCORE = {
    FIVE: 10000000, // 5목 (승리)
    OPEN_FOUR: 1000000, // 열린 4 (양쪽 열림) — 사실상 승리
    FOUR: 100000, // 막힌 4 / 4목 위협
    OPEN_THREE: 50000, // 열린 3
    THREE: 1000, // 막힌 3
    OPEN_TWO: 500, // 열린 2
    TWO: 100, // 막힌 2
    ONE: 10,
  };

  function inBounds(x, y) {
    return x >= 0 && x < SIZE && y >= 0 && y < SIZE;
  }

  function opponent(player) {
    return player === 1 ? 2 : 1;
  }

  // (x,y)에서 한 점을 기준으로 한 줄(축)의 패턴을 평가해 점수 반환
  function evalDirection(board, x, y, dx, dy, player) {
    // player 돌이 (x,y)에 있다고 가정하고 그 줄에서 연속/열림 상태를 분석
    let count = 1; // 자신 포함
    let openEnds = 0;
    let blockedEnds = 0;

    // 정방향
    let i = 1;
    while (true) {
      const nx = x + dx * i;
      const ny = y + dy * i;
      if (!inBounds(nx, ny)) {
        blockedEnds++;
        break;
      }
      const v = board[ny][nx];
      if (v === player) {
        count++;
        i++;
      } else if (v === EMPTY) {
        openEnds++;
        break;
      } else {
        blockedEnds++;
        break;
      }
    }

    // 역방향
    i = 1;
    while (true) {
      const nx = x - dx * i;
      const ny = y - dy * i;
      if (!inBounds(nx, ny)) {
        blockedEnds++;
        break;
      }
      const v = board[ny][nx];
      if (v === player) {
        count++;
        i++;
      } else if (v === EMPTY) {
        openEnds++;
        break;
      } else {
        blockedEnds++;
        break;
      }
    }

    if (count >= 5) return SCORE.FIVE;

    if (count === 4) {
      if (openEnds === 2) return SCORE.OPEN_FOUR;
      if (openEnds === 1) return SCORE.FOUR;
      return 0;
    }
    if (count === 3) {
      if (openEnds === 2) return SCORE.OPEN_THREE;
      if (openEnds === 1) return SCORE.THREE;
      return 0;
    }
    if (count === 2) {
      if (openEnds === 2) return SCORE.OPEN_TWO;
      if (openEnds === 1) return SCORE.TWO;
      return 0;
    }
    if (count === 1) {
      if (openEnds === 2) return SCORE.ONE;
      return 0;
    }
    return 0;
  }

  // (x,y)에 player가 둘 때의 공격 가치 (4방향 합)
  function pointScore(board, x, y, player) {
    let total = 0;
    for (const [dx, dy] of LINES) {
      total += evalDirection(board, x, y, dx, dy, player);
    }
    return total;
  }

  // 보드 전체를 player 관점에서 평가
  function evaluateBoard(board, player) {
    const opp = opponent(player);
    let score = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const v = board[y][x];
        if (v === EMPTY) continue;
        // 각 축마다 "줄의 시작점"에서만 평가해 중복 계산 방지
        for (const [dx, dy] of LINES) {
          const px = x - dx;
          const py = y - dy;
          if (inBounds(px, py) && board[py][px] === v) continue; // 줄 시작점 아님
          const s = lineScore(board, x, y, dx, dy, v);
          if (v === player) score += s;
          else score -= s;
        }
      }
    }
    return score;
  }

  // 줄 시작점(x,y)에서 같은 색 연속 길이/열림 상태로 점수 산정
  function lineScore(board, x, y, dx, dy, v) {
    let count = 0;
    let cx = x;
    let cy = y;
    while (inBounds(cx, cy) && board[cy][cx] === v) {
      count++;
      cx += dx;
      cy += dy;
    }
    // 양 끝 열림 판정
    const beforeX = x - dx;
    const beforeY = y - dy;
    const afterX = cx;
    const afterY = cy;
    const beforeOpen = inBounds(beforeX, beforeY) && board[beforeY][beforeX] === EMPTY;
    const afterOpen = inBounds(afterX, afterY) && board[afterY][afterX] === EMPTY;
    const openEnds = (beforeOpen ? 1 : 0) + (afterOpen ? 1 : 0);

    if (count >= 5) return SCORE.FIVE;
    if (count === 4) return openEnds === 2 ? SCORE.OPEN_FOUR : openEnds === 1 ? SCORE.FOUR : 0;
    if (count === 3) return openEnds === 2 ? SCORE.OPEN_THREE : openEnds === 1 ? SCORE.THREE : 0;
    if (count === 2) return openEnds === 2 ? SCORE.OPEN_TWO : openEnds === 1 ? SCORE.TWO : 0;
    if (count === 1) return openEnds === 2 ? SCORE.ONE : 0;
    return 0;
  }

  // (x,y)에 player가 두면 5목이 완성되는지
  function isWinningMove(board, x, y, player) {
    for (const [dx, dy] of LINES) {
      let count = 1;
      let i = 1;
      while (inBounds(x + dx * i, y + dy * i) && board[y + dy * i][x + dx * i] === player) {
        count++;
        i++;
      }
      i = 1;
      while (inBounds(x - dx * i, y - dy * i) && board[y - dy * i][x - dx * i] === player) {
        count++;
        i++;
      }
      if (count >= 5) return true;
    }
    return false;
  }

  // 후보 수 생성: 기존 돌 주변 2칸 이내 빈칸만
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
            const nx = x + dx;
            const ny = y + dy;
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

  // 후보 수를 휴리스틱(공격+방어 가치)으로 정렬해 상위 N개만 반환 → 가지치기 효율↑
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

  // 알파-베타 미니맥스
  function minimax(board, depth, alpha, beta, maximizing, aiPlayer) {
    const human = opponent(aiPlayer);

    if (depth === 0) {
      return { score: evaluateBoard(board, aiPlayer), move: null };
    }

    const current = maximizing ? aiPlayer : human;
    const moves = orderedMoves(board, current, 12);

    if (moves.length === 0) {
      return { score: evaluateBoard(board, aiPlayer), move: null };
    }

    let bestMove = moves[0];

    if (maximizing) {
      let best = -Infinity;
      for (const [x, y] of moves) {
        board[y][x] = aiPlayer;
        if (isWinningMove(board, x, y, aiPlayer)) {
          board[y][x] = EMPTY;
          return { score: SCORE.FIVE + depth, move: [x, y] };
        }
        const { score } = minimax(board, depth - 1, alpha, beta, false, aiPlayer);
        board[y][x] = EMPTY;
        if (score > best) {
          best = score;
          bestMove = [x, y];
        }
        alpha = Math.max(alpha, best);
        if (beta <= alpha) break;
      }
      return { score: best, move: bestMove };
    } else {
      let best = Infinity;
      for (const [x, y] of moves) {
        board[y][x] = human;
        if (isWinningMove(board, x, y, human)) {
          board[y][x] = EMPTY;
          return { score: -SCORE.FIVE - depth, move: [x, y] };
        }
        const { score } = minimax(board, depth - 1, alpha, beta, true, aiPlayer);
        board[y][x] = EMPTY;
        if (score < best) {
          best = score;
          bestMove = [x, y];
        }
        beta = Math.min(beta, best);
        if (beta <= alpha) break;
      }
      return { score: best, move: bestMove };
    }
  }

  /**
   * 최선의 수를 계산한다.
   * @param {number[][]} board 15x15 보드
   * @param {number} aiPlayer 1(흑) 또는 2(백)
   * @param {number} depth 탐색 깊이 (기본 4)
   * @returns {{x:number, y:number}}
   */
  function bestMove(board, aiPlayer, depth) {
    depth = depth || 4;
    const human = opponent(aiPlayer);
    const candidates = generateMoves(board, 2);

    // 첫 수: 중앙
    if (candidates.length === 1) {
      return { x: candidates[0][0], y: candidates[0][1] };
    }

    // 1) 즉시 승리
    for (const [x, y] of candidates) {
      board[y][x] = aiPlayer;
      const win = isWinningMove(board, x, y, aiPlayer);
      board[y][x] = EMPTY;
      if (win) return { x, y };
    }

    // 2) 상대 즉시 승리 방어
    for (const [x, y] of candidates) {
      board[y][x] = human;
      const win = isWinningMove(board, x, y, human);
      board[y][x] = EMPTY;
      if (win) return { x, y };
    }

    // 3) 미니맥스 탐색
    const result = minimax(board, depth, -Infinity, Infinity, true, aiPlayer);
    if (result.move) {
      return { x: result.move[0], y: result.move[1] };
    }

    // 폴백: 가장 가치 높은 후보
    const ordered = orderedMoves(board, aiPlayer, 1);
    return { x: ordered[0][0], y: ordered[0][1] };
  }

  global.OmokAI = {
    SIZE,
    EMPTY,
    bestMove,
    isWinningMove,
    evaluateBoard,
    opponent,
  };
})(typeof window !== 'undefined' ? window : globalThis);
