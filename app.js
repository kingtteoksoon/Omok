const BOARD_SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

const boardElement = document.querySelector("#board");
const statusText = document.querySelector("#statusText");
const newGameButton = document.querySelector("#newGameButton");
const thinkingText = document.querySelector("#thinkingText");
const stoneInputs = [...document.querySelectorAll('input[name="playerStone"]')];

let board = createBoard();
let gameOver = false;
let humanStone = BLACK;
let aiStone = WHITE;
let currentTurn = BLACK;
let lastMove = null;
let aiThinking = false;

function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
}

function opponent(stone) {
  return stone === BLACK ? WHITE : BLACK;
}

function stoneName(stone) {
  return stone === BLACK ? "흑돌" : "백돌";
}

function renderBoard() {
  boardElement.innerHTML = "";
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", `${row + 1}행 ${col + 1}열`);
      cell.dataset.row = row;
      cell.dataset.col = col;
      if (board[row][col] === BLACK) cell.classList.add("black");
      if (board[row][col] === WHITE) cell.classList.add("white");
      if (lastMove?.row === row && lastMove?.col === col) cell.classList.add("last-move");
      cell.disabled = gameOver || aiThinking || board[row][col] !== EMPTY || currentTurn !== humanStone;
      boardElement.append(cell);
    }
  }
}

function updateStatus(message) {
  statusText.textContent = message;
}

function startGame() {
  humanStone = stoneInputs.find((input) => input.checked).value === "black" ? BLACK : WHITE;
  aiStone = opponent(humanStone);
  currentTurn = BLACK;
  board = createBoard();
  gameOver = false;
  lastMove = null;
  aiThinking = false;
  thinkingText.hidden = true;
  renderBoard();

  if (aiStone === BLACK) {
    updateStatus("컴퓨터가 흑돌로 선공합니다.");
    scheduleAiMove();
  } else {
    updateStatus("플레이어 차례입니다. 흑돌을 놓으세요.");
  }
}

function placeStone(row, col, stone) {
  if (!isInside(row, col) || board[row][col] !== EMPTY) return false;
  board[row][col] = stone;
  lastMove = { row, col };
  return true;
}

function handleCellClick(event) {
  const cell = event.target.closest(".cell");
  if (!cell || gameOver || aiThinking || currentTurn !== humanStone) return;

  const row = Number(cell.dataset.row);
  const col = Number(cell.dataset.col);
  if (!placeStone(row, col, humanStone)) return;

  if (finishIfGameEnded(row, col, humanStone)) return;
  currentTurn = aiStone;
  renderBoard();
  scheduleAiMove();
}

function scheduleAiMove() {
  aiThinking = true;
  thinkingText.hidden = false;
  updateStatus("컴퓨터가 살벌하게 수읽기 중입니다…");
  renderBoard();

  window.setTimeout(() => {
    const move = findBestMove();
    if (move && placeStone(move.row, move.col, aiStone)) {
      if (finishIfGameEnded(move.row, move.col, aiStone)) return;
    }
    aiThinking = false;
    thinkingText.hidden = true;
    currentTurn = humanStone;
    updateStatus(`플레이어 차례입니다. ${stoneName(humanStone)}을 놓으세요.`);
    renderBoard();
  }, 180);
}

function finishIfGameEnded(row, col, stone) {
  if (hasFive(row, col, stone)) {
    gameOver = true;
    aiThinking = false;
    thinkingText.hidden = true;
    updateStatus(stone === humanStone ? "승리! AI의 압박을 뚫었습니다." : "패배! 컴퓨터가 오목을 완성했습니다.");
    renderBoard();
    return true;
  }

  if (isBoardFull()) {
    gameOver = true;
    aiThinking = false;
    thinkingText.hidden = true;
    updateStatus("무승부입니다. 판이 모두 찼습니다.");
    renderBoard();
    return true;
  }

  return false;
}

function isInside(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function isBoardFull() {
  return board.every((row) => row.every((cell) => cell !== EMPTY));
}

function hasFive(row, col, stone) {
  return DIRECTIONS.some(([dr, dc]) => 1 + countDirection(row, col, dr, dc, stone) + countDirection(row, col, -dr, -dc, stone) >= 5);
}

function countDirection(row, col, dr, dc, stone) {
  let count = 0;
  let nextRow = row + dr;
  let nextCol = col + dc;
  while (isInside(nextRow, nextCol) && board[nextRow][nextCol] === stone) {
    count += 1;
    nextRow += dr;
    nextCol += dc;
  }
  return count;
}

function findBestMove() {
  const tacticalMove = findTacticalMove();
  if (tacticalMove) return tacticalMove;

  const candidates = getCandidateMoves(10);
  if (candidates.length === 0) return { row: 7, col: 7 };

  let bestMove = candidates[0];
  let bestScore = -Infinity;
  let alpha = -Infinity;
  const depth = candidates.length > 18 ? 2 : 3;

  for (const move of candidates) {
    board[move.row][move.col] = aiStone;
    const score = minimax(depth - 1, false, alpha, Infinity);
    board[move.row][move.col] = EMPTY;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
    alpha = Math.max(alpha, bestScore);
  }

  return bestMove;
}

function findTacticalMove() {
  const candidates = getCandidateMoves(18);

  for (const move of candidates) {
    board[move.row][move.col] = aiStone;
    const wins = hasFive(move.row, move.col, aiStone);
    board[move.row][move.col] = EMPTY;
    if (wins) return move;
  }

  for (const move of candidates) {
    board[move.row][move.col] = humanStone;
    const blocksWin = hasFive(move.row, move.col, humanStone);
    board[move.row][move.col] = EMPTY;
    if (blocksWin) return move;
  }

  const forcing = candidates.find((move) => moveThreatScore(move, aiStone) >= 900_000);
  if (forcing) return forcing;

  const emergencyBlock = candidates.find((move) => moveThreatScore(move, humanStone) >= 900_000);
  if (emergencyBlock) return emergencyBlock;

  return null;
}

function minimax(depth, isMaximizing, alpha, beta) {
  const evaluation = evaluateBoard();
  if (depth === 0 || Math.abs(evaluation) >= 9_000_000) return evaluation;

  const candidates = getCandidateMoves(depth >= 2 ? 8 : 6);
  if (candidates.length === 0) return evaluation;

  if (isMaximizing) {
    let bestScore = -Infinity;
    for (const move of candidates) {
      board[move.row][move.col] = aiStone;
      if (hasFive(move.row, move.col, aiStone)) {
        board[move.row][move.col] = EMPTY;
        return 10_000_000 + depth;
      }
      bestScore = Math.max(bestScore, minimax(depth - 1, false, alpha, beta));
      board[move.row][move.col] = EMPTY;
      alpha = Math.max(alpha, bestScore);
      if (beta <= alpha) break;
    }
    return bestScore;
  }

  let bestScore = Infinity;
  for (const move of candidates) {
    board[move.row][move.col] = humanStone;
    if (hasFive(move.row, move.col, humanStone)) {
      board[move.row][move.col] = EMPTY;
      return -10_000_000 - depth;
    }
    bestScore = Math.min(bestScore, minimax(depth - 1, true, alpha, beta));
    board[move.row][move.col] = EMPTY;
    beta = Math.min(beta, bestScore);
    if (beta <= alpha) break;
  }
  return bestScore;
}

function getCandidateMoves(limit = 12) {
  const moves = [];
  const hasAnyStone = board.some((row) => row.some((cell) => cell !== EMPTY));
  if (!hasAnyStone) return [{ row: 7, col: 7, score: 0 }];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] !== EMPTY || !hasNeighbor(row, col, 2)) continue;
      const score = moveThreatScore({ row, col }, aiStone) + moveThreatScore({ row, col }, humanStone) * 0.92 + centerBias(row, col);
      moves.push({ row, col, score });
    }
  }

  return moves.sort((a, b) => b.score - a.score).slice(0, limit);
}

function hasNeighbor(row, col, radius) {
  for (let dr = -radius; dr <= radius; dr += 1) {
    for (let dc = -radius; dc <= radius; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (isInside(nextRow, nextCol) && board[nextRow][nextCol] !== EMPTY) return true;
    }
  }
  return false;
}

function centerBias(row, col) {
  const distance = Math.abs(row - 7) + Math.abs(col - 7);
  return Math.max(0, 24 - distance * 2);
}

function moveThreatScore(move, stone) {
  board[move.row][move.col] = stone;
  const score = evaluateStoneAt(move.row, move.col, stone);
  board[move.row][move.col] = EMPTY;
  return score;
}

function evaluateBoard() {
  let aiScore = 0;
  let humanScore = 0;

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] === aiStone) aiScore += evaluateStoneAt(row, col, aiStone) + centerBias(row, col);
      if (board[row][col] === humanStone) humanScore += evaluateStoneAt(row, col, humanStone) + centerBias(row, col);
    }
  }

  return aiScore - humanScore * 1.08;
}

function evaluateStoneAt(row, col, stone) {
  let total = 0;
  for (const [dr, dc] of DIRECTIONS) {
    const forward = scanLine(row, col, dr, dc, stone);
    const backward = scanLine(row, col, -dr, -dc, stone);
    const length = 1 + forward.count + backward.count;
    const openEnds = Number(forward.open) + Number(backward.open);
    total += patternScore(length, openEnds);
  }
  return total;
}

function scanLine(row, col, dr, dc, stone) {
  let count = 0;
  let nextRow = row + dr;
  let nextCol = col + dc;
  while (isInside(nextRow, nextCol) && board[nextRow][nextCol] === stone) {
    count += 1;
    nextRow += dr;
    nextCol += dc;
  }
  return {
    count,
    open: isInside(nextRow, nextCol) && board[nextRow][nextCol] === EMPTY,
  };
}

function patternScore(length, openEnds) {
  if (length >= 5) return 10_000_000;
  if (length === 4 && openEnds === 2) return 1_200_000;
  if (length === 4 && openEnds === 1) return 180_000;
  if (length === 3 && openEnds === 2) return 42_000;
  if (length === 3 && openEnds === 1) return 7_000;
  if (length === 2 && openEnds === 2) return 1_600;
  if (length === 2 && openEnds === 1) return 220;
  if (length === 1 && openEnds === 2) return 24;
  return 1;
}

boardElement.addEventListener("click", handleCellClick);
newGameButton.addEventListener("click", startGame);
stoneInputs.forEach((input) => input.addEventListener("change", startGame));

startGame();
