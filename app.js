/*
 * 개미친 어려움 오목 AI
 * ------------------------------------------------------------
 * 이 파일은 서버 없이 브라우저에서 바로 실행되는 전체 게임 엔진입니다.
 * 수정하기 쉽게 아래 순서로 구성했습니다.
 * 1) 상수/설정값
 * 2) DOM 연결 및 게임 상태
 * 3) 렌더링/입력/게임 진행
 * 4) AI 탐색: 전술 수 확인 -> 반복 심화 -> 알파-베타 미니맥스
 * 5) 보드 평가/로그 유틸리티
 */

// ===== 1. 기본 상수와 AI 튜닝 값 =====
const BOARD_SIZE = 15;
const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;

// 오목 판정에 필요한 4개 축입니다. 반대 방향은 함수 안에서 같이 검사합니다.
const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

// AI 세기와 속도를 조정하고 싶으면 이 객체의 값만 먼저 바꿔보세요.
const AI_CONFIG = {
  MAX_DEPTH: 4, // 최대 몇 수 앞까지 읽을지. 높이면 강해지지만 느려집니다.
  TIME_LIMIT_MS: 1400, // 한 번 착수할 때 사용할 최대 사고 시간입니다.
  ROOT_CANDIDATE_LIMIT: 14, // 루트에서 비교할 후보 수입니다.
  BRANCH_CANDIDATE_LIMIT: 9, // 미니맥스 내부에서 펼칠 후보 수입니다.
  QUIET_BRANCH_LIMIT: 7, // 얕은 깊이에서 펼칠 후보 수입니다.
  NEIGHBOR_RADIUS: 2, // 기존 돌 주변 몇 칸까지 후보로 볼지입니다.
  MAX_UI_LOGS: 180, // 화면 로그가 너무 길어지는 것을 막는 최대 줄 수입니다.
};

// 평가 점수는 “AI에게 좋은 정도”입니다. 큰 양수면 AI 유리, 큰 음수면 플레이어 유리입니다.
const SCORE = {
  WIN: 100_000_000,
  OPEN_FOUR: 3_000_000,
  CLOSED_FOUR: 450_000,
  OPEN_THREE: 90_000,
  CLOSED_THREE: 12_000,
  OPEN_TWO: 2_400,
  CLOSED_TWO: 320,
};

// ===== 2. DOM 연결 및 전역 게임 상태 =====
const boardElement = document.querySelector("#board");
const statusText = document.querySelector("#statusText");
const newGameButton = document.querySelector("#newGameButton");
const thinkingText = document.querySelector("#thinkingText");
const logList = document.querySelector("#logList");
const clearLogButton = document.querySelector("#clearLogButton");
const stoneInputs = [...document.querySelectorAll('input[name="playerStone"]')];

let board = createBoard();
let gameOver = false;
let humanStone = BLACK;
let aiStone = WHITE;
let currentTurn = BLACK;
let lastMove = null;
let aiThinking = false;
let logSequence = 0;

function createBoard() {
  return Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));
}

function opponent(stone) {
  return stone === BLACK ? WHITE : BLACK;
}

function stoneName(stone) {
  return stone === BLACK ? "흑돌" : "백돌";
}

function coordinateName(move) {
  if (!move) return "없음";
  return `${move.row + 1}행 ${move.col + 1}열`;
}

// ===== 3. 화면 렌더링, 사용자 입력, 게임 진행 =====
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

      // AI 사고 중이거나 내 차례가 아니면 실수 입력을 막습니다.
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

  clearLogs();
  logAi("게임", `새 게임 시작: 플레이어=${stoneName(humanStone)}, AI=${stoneName(aiStone)}`);
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
  logAi("착수", `${stoneName(stone)} -> ${coordinateName(lastMove)}`);
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
  updateStatus("컴퓨터가 여러 수 앞을 예측하는 중입니다…");
  renderBoard();

  // 렌더링이 먼저 반영되도록 짧게 양보한 뒤 무거운 탐색을 시작합니다.
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
  }, 120);
}

function finishIfGameEnded(row, col, stone) {
  if (hasFive(row, col, stone)) {
    gameOver = true;
    aiThinking = false;
    thinkingText.hidden = true;
    const message = stone === humanStone ? "승리! AI의 예측을 뚫었습니다." : "패배! 컴퓨터가 오목을 완성했습니다.";
    updateStatus(message);
    logAi("종료", message, "success");
    renderBoard();
    return true;
  }

  if (isBoardFull()) {
    gameOver = true;
    aiThinking = false;
    thinkingText.hidden = true;
    updateStatus("무승부입니다. 판이 모두 찼습니다.");
    logAi("종료", "무승부", "success");
    renderBoard();
    return true;
  }

  return false;
}

// ===== 4. AI 탐색 엔진 =====
function findBestMove() {
  const startedAt = performance.now();
  const deadline = startedAt + AI_CONFIG.TIME_LIMIT_MS;
  const occupied = countStones();
  const firstMove = occupied === 0 ? { row: 7, col: 7 } : null;

  logAi("AI 시작", `현재 돌 수=${occupied}, 제한시간=${AI_CONFIG.TIME_LIMIT_MS}ms, 최대깊이=${AI_CONFIG.MAX_DEPTH}`);
  if (firstMove) {
    logAi("AI 결정", `첫 수는 중앙 장악: ${coordinateName(firstMove)}`, "success");
    return firstMove;
  }

  // 1단계: 당장 이기거나 당장 막아야 하는 전술 수는 깊은 탐색보다 우선합니다.
  const tacticalMove = findTacticalMove();
  if (tacticalMove) {
    logAi("AI 결정", `전술 우선 수 선택: ${coordinateName(tacticalMove)}`, "success");
    return tacticalMove;
  }

  // 2단계: 후보를 점수순으로 줄인 뒤 반복 심화로 더 깊은 예측을 수행합니다.
  const rootCandidates = getCandidateMoves(AI_CONFIG.ROOT_CANDIDATE_LIMIT, aiStone);
  logCandidateSummary("루트 후보", rootCandidates);

  let bestCompleted = rootCandidates[0] ?? { row: 7, col: 7, score: 0 };
  let bestLine = [bestCompleted];
  let bestScore = -Infinity;

  for (let depth = 1; depth <= AI_CONFIG.MAX_DEPTH; depth += 1) {
    const search = searchRoot(rootCandidates, depth, deadline);

    if (search.timedOut) {
      logAi("시간 초과", `${depth}수 탐색 중 제한시간 도달. 직전 완료 결과를 사용합니다.`, "warn");
      break;
    }

    bestCompleted = search.bestMove;
    bestLine = search.bestLine;
    bestScore = search.bestScore;

    // 각 깊이마다 AI가 예측한 플레이어 응수까지 출력합니다.
    logAi(
      "깊이 완료",
      `depth=${depth}, 점수=${Math.round(bestScore)}, 노드=${search.nodes}, 가지치기=${search.prunes}, 예상=${formatLine(bestLine)}`,
      "success",
    );
  }

  const elapsed = Math.round(performance.now() - startedAt);
  logAi("AI 결정", `${coordinateName(bestCompleted)} 선택 / 최종점수=${Math.round(bestScore)} / 소요=${elapsed}ms / 예상라인=${formatLine(bestLine)}`, "success");
  return bestCompleted;
}

function searchRoot(candidates, depth, deadline) {
  let bestMove = candidates[0];
  let bestScore = -Infinity;
  let bestLine = [bestMove];
  let alpha = -Infinity;
  let nodes = 0;
  let prunes = 0;
  let timedOut = false;

  for (const move of candidates) {
    if (performance.now() > deadline) {
      timedOut = true;
      break;
    }

    board[move.row][move.col] = aiStone;
    const result = minimax({
      depth: depth - 1,
      turn: humanStone,
      alpha,
      beta: Infinity,
      lastMove: move,
      deadline,
      ply: 1,
    });
    board[move.row][move.col] = EMPTY;

    nodes += result.nodes;
    prunes += result.prunes;
    if (result.timedOut) {
      timedOut = true;
      break;
    }

    const score = result.score;
    logAi("후보 평가", `depth=${depth}, 후보=${coordinateName(move)}, 점수=${Math.round(score)}, 이후예상=${formatLine([move, ...result.line])}`);

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
      bestLine = [move, ...result.line];
    }
    alpha = Math.max(alpha, bestScore);
  }

  return { bestMove, bestScore, bestLine, nodes, prunes, timedOut };
}

function minimax({ depth, turn, alpha, beta, lastMove, deadline, ply }) {
  const previousStone = opponent(turn);

  // 제한시간을 넘으면 현재까지의 안전한 결과만 사용하도록 상위 호출에 알립니다.
  if (performance.now() > deadline) {
    return { score: evaluateBoard(), line: [], nodes: 1, prunes: 0, timedOut: true };
  }

  // 직전 수로 승리가 났다면 현재 차례와 무관하게 즉시 종료합니다.
  if (lastMove && hasFive(lastMove.row, lastMove.col, previousStone)) {
    const sign = previousStone === aiStone ? 1 : -1;
    return { score: sign * (SCORE.WIN - ply), line: [], nodes: 1, prunes: 0, timedOut: false };
  }

  if (depth === 0 || isBoardFull()) {
    return { score: evaluateBoard(), line: [], nodes: 1, prunes: 0, timedOut: false };
  }

  const maximizing = turn === aiStone;
  const candidates = getCandidateMoves(depth >= 2 ? AI_CONFIG.BRANCH_CANDIDATE_LIMIT : AI_CONFIG.QUIET_BRANCH_LIMIT, turn);
  let bestScore = maximizing ? -Infinity : Infinity;
  let bestLine = [];
  let nodes = 1;
  let prunes = 0;

  for (const move of candidates) {
    board[move.row][move.col] = turn;
    const child = minimax({
      depth: depth - 1,
      turn: opponent(turn),
      alpha,
      beta,
      lastMove: move,
      deadline,
      ply: ply + 1,
    });
    board[move.row][move.col] = EMPTY;

    nodes += child.nodes;
    prunes += child.prunes;
    if (child.timedOut) return { score: bestScore, line: bestLine, nodes, prunes, timedOut: true };

    if (maximizing && child.score > bestScore) {
      bestScore = child.score;
      bestLine = [move, ...child.line];
    }
    if (!maximizing && child.score < bestScore) {
      bestScore = child.score;
      bestLine = [move, ...child.line];
    }

    // 알파-베타 가지치기: 상대가 절대 허용하지 않을 가지는 더 보지 않습니다.
    if (maximizing) alpha = Math.max(alpha, bestScore);
    else beta = Math.min(beta, bestScore);

    if (beta <= alpha) {
      prunes += 1;
      break;
    }
  }

  return { score: bestScore, line: bestLine, nodes, prunes, timedOut: false };
}

function findTacticalMove() {
  const candidates = getCandidateMoves(24, aiStone);
  logCandidateSummary("전술 후보", candidates);

  // A. AI가 바로 오목을 만들 수 있으면 무조건 둡니다.
  for (const move of candidates) {
    board[move.row][move.col] = aiStone;
    const wins = hasFive(move.row, move.col, aiStone);
    board[move.row][move.col] = EMPTY;
    if (wins) {
      logAi("전술", `AI 즉시 승리 수 발견: ${coordinateName(move)}`, "success");
      return move;
    }
  }

  // B. 플레이어가 다음에 오목을 만들 수 있으면 반드시 막습니다.
  for (const move of candidates) {
    board[move.row][move.col] = humanStone;
    const blocksWin = hasFive(move.row, move.col, humanStone);
    board[move.row][move.col] = EMPTY;
    if (blocksWin) {
      logAi("전술", `플레이어 즉시승리 차단: ${coordinateName(move)}`, "warn");
      return move;
    }
  }

  // C. 열린 4 또는 복합 위협처럼 상대가 대응하기 어려운 수를 우선합니다.
  const aiForce = candidates.find((move) => classifyMove(move, aiStone).forcing);
  if (aiForce) {
    logAi("전술", `AI 강제 위협 생성: ${coordinateName(aiForce)}`, "success");
    return aiForce;
  }

  const humanForce = candidates.find((move) => classifyMove(move, humanStone).forcing);
  if (humanForce) {
    logAi("전술", `플레이어 강제 위협 선제 차단: ${coordinateName(humanForce)}`, "warn");
    return humanForce;
  }

  return null;
}

// ===== 5. 후보 생성과 보드 평가 =====
function getCandidateMoves(limit, turnForOrdering) {
  const moves = [];
  const hasAnyStone = countStones() > 0;
  if (!hasAnyStone) return [{ row: 7, col: 7, score: 0 }];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] !== EMPTY || !hasNeighbor(row, col, AI_CONFIG.NEIGHBOR_RADIUS)) continue;

      const attack = moveThreatScore({ row, col }, turnForOrdering);
      const defense = moveThreatScore({ row, col }, opponent(turnForOrdering));
      const globalBias = centerBias(row, col) + adjacencyBias(row, col);
      const score = attack * 1.08 + defense + globalBias;
      moves.push({ row, col, score });
    }
  }

  return moves.sort((a, b) => b.score - a.score).slice(0, limit);
}

function classifyMove(move, stone) {
  board[move.row][move.col] = stone;
  const patterns = DIRECTIONS.map(([dr, dc]) => getLinePattern(move.row, move.col, dr, dc, stone));
  board[move.row][move.col] = EMPTY;

  const openFours = patterns.filter((pattern) => pattern.length === 4 && pattern.openEnds === 2).length;
  const closedFours = patterns.filter((pattern) => pattern.length === 4 && pattern.openEnds === 1).length;
  const openThrees = patterns.filter((pattern) => pattern.length === 3 && pattern.openEnds === 2).length;

  // 열린 4, 닫힌 4 두 개 이상, 열린 3 두 개 이상은 다음 응수를 강제하는 위협으로 봅니다.
  return {
    openFours,
    closedFours,
    openThrees,
    forcing: openFours > 0 || closedFours >= 2 || openThrees >= 2 || (closedFours >= 1 && openThrees >= 1),
  };
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

  // 방어를 약간 더 크게 보정해서 상대의 다음 위협 예측을 더 민감하게 만듭니다.
  return aiScore - humanScore * 1.12;
}

function evaluateStoneAt(row, col, stone) {
  let total = 0;

  for (const [dr, dc] of DIRECTIONS) {
    const pattern = getLinePattern(row, col, dr, dc, stone);
    total += patternScore(pattern.length, pattern.openEnds);
  }

  return total;
}

function getLinePattern(row, col, dr, dc, stone) {
  const forward = scanLine(row, col, dr, dc, stone);
  const backward = scanLine(row, col, -dr, -dc, stone);

  return {
    length: 1 + forward.count + backward.count,
    openEnds: Number(forward.open) + Number(backward.open),
  };
}

function patternScore(length, openEnds) {
  if (length >= 5) return SCORE.WIN;
  if (length === 4 && openEnds === 2) return SCORE.OPEN_FOUR;
  if (length === 4 && openEnds === 1) return SCORE.CLOSED_FOUR;
  if (length === 3 && openEnds === 2) return SCORE.OPEN_THREE;
  if (length === 3 && openEnds === 1) return SCORE.CLOSED_THREE;
  if (length === 2 && openEnds === 2) return SCORE.OPEN_TWO;
  if (length === 2 && openEnds === 1) return SCORE.CLOSED_TWO;
  if (length === 1 && openEnds === 2) return 28;
  return 1;
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

// ===== 6. 보드/로그 유틸리티 =====
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
  return Math.max(0, 32 - distance * 3);
}

function adjacencyBias(row, col) {
  let neighbors = 0;
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const nextRow = row + dr;
      const nextCol = col + dc;
      if (isInside(nextRow, nextCol) && board[nextRow][nextCol] !== EMPTY) neighbors += 1;
    }
  }
  return neighbors * 18;
}

function countStones() {
  return board.reduce((total, row) => total + row.filter((cell) => cell !== EMPTY).length, 0);
}

function formatLine(line) {
  if (!line || line.length === 0) return "없음";
  return line.map((move, index) => `${index + 1}.${coordinateName(move)}`).join(" → ");
}

function logCandidateSummary(title, candidates) {
  const summary = candidates
    .slice(0, 8)
    .map((move) => `${coordinateName(move)}(${Math.round(move.score)})`)
    .join(", ");
  logAi(title, summary || "후보 없음");
}

function logAi(scope, message, type = "normal") {
  logSequence += 1;
  const line = `[${String(logSequence).padStart(3, "0")}] ${scope}: ${message}`;

  // 개발자가 콘솔에서도 전체 사고 과정을 볼 수 있게 항상 출력합니다.
  if (type === "warn") console.warn(line);
  else console.log(line);

  const item = document.createElement("li");
  item.textContent = line;
  if (type === "warn") item.classList.add("log-warn");
  if (type === "success") item.classList.add("log-success");
  logList.append(item);

  while (logList.children.length > AI_CONFIG.MAX_UI_LOGS) {
    logList.firstElementChild.remove();
  }
  logList.scrollTop = logList.scrollHeight;
}

function clearLogs() {
  logSequence = 0;
  logList.innerHTML = "";
}

boardElement.addEventListener("click", handleCellClick);
newGameButton.addEventListener("click", startGame);
clearLogButton.addEventListener("click", clearLogs);
stoneInputs.forEach((input) => input.addEventListener("change", startGame));

startGame();
