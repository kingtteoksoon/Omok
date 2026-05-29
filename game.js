/* 오목 게임 — UI 및 게임 흐름 제어 */
(function () {
  'use strict';

  const SIZE = OmokAI.SIZE; // 15
  const EMPTY = OmokAI.EMPTY; // 0
  const BLACK = 1;
  const WHITE = 2;
  const AI_DEPTH = 4; // "개미친 어려움" 탐색 깊이

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');
  const thinkingEl = document.getElementById('thinking');
  const moveCountEl = document.getElementById('moveCount');
  const newGameBtn = document.getElementById('newGameBtn');
  const undoBtn = document.getElementById('undoBtn');
  const stoneSelect = document.getElementById('stoneSelect');

  // 보드 픽셀 계산
  const PADDING = 30;
  const CELL = (canvas.width - PADDING * 2) / (SIZE - 1);

  let board = [];
  let history = []; // {x, y, player}
  let humanColor = BLACK; // 사람이 잡은 색
  let aiColor = WHITE;
  let currentPlayer = BLACK; // 흑 선공
  let gameOver = false;
  let busy = false; // AI 사고 중 입력 잠금
  let started = false;
  let lastMove = null;

  function createBoard() {
    const b = [];
    for (let y = 0; y < SIZE; y++) {
      b.push(new Array(SIZE).fill(EMPTY));
    }
    return b;
  }

  function resetGame() {
    board = createBoard();
    history = [];
    currentPlayer = BLACK;
    gameOver = false;
    busy = false;
    started = true;
    lastMove = null;
    updateMoveCount();
    draw();

    if (aiColor === BLACK) {
      // AI(흑)가 선공 → 중앙에 둠
      setStatus('컴퓨터(흑)가 먼저 둡니다…');
      scheduleAI();
    } else {
      setStatus('당신(흑) 차례입니다. 돌을 놓으세요.');
    }
  }

  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  function updateMoveCount() {
    moveCountEl.textContent = '수: ' + history.length;
  }

  function colorName(p) {
    return p === BLACK ? '흑' : '백';
  }

  // ---- 그리기 ----
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 배경
    ctx.fillStyle = '#e3b96b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 격자
    ctx.strokeStyle = '#5a3d1a';
    ctx.lineWidth = 1;
    for (let i = 0; i < SIZE; i++) {
      const p = PADDING + i * CELL;
      ctx.beginPath();
      ctx.moveTo(PADDING, p);
      ctx.lineTo(canvas.width - PADDING, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, PADDING);
      ctx.lineTo(p, canvas.height - PADDING);
      ctx.stroke();
    }

    // 화점 (천원 + 4귀)
    const dots = [3, 7, 11];
    ctx.fillStyle = '#5a3d1a';
    for (const gy of dots) {
      for (const gx of dots) {
        ctx.beginPath();
        ctx.arc(PADDING + gx * CELL, PADDING + gy * CELL, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 돌
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (board[y][x] !== EMPTY) {
          drawStone(x, y, board[y][x]);
        }
      }
    }

    // 마지막 수 표시
    if (lastMove) {
      const cx = PADDING + lastMove.x * CELL;
      const cy = PADDING + lastMove.y * CELL;
      ctx.strokeStyle = '#e23b3b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * 0.32, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawStone(x, y, player) {
    const cx = PADDING + x * CELL;
    const cy = PADDING + y * CELL;
    const r = CELL * 0.42;

    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    if (player === BLACK) {
      grad.addColorStop(0, '#555');
      grad.addColorStop(1, '#000');
    } else {
      grad.addColorStop(0, '#fff');
      grad.addColorStop(1, '#cfcfcf');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // ---- 좌표 변환 ----
  function pixelToCell(px, py) {
    const x = Math.round((px - PADDING) / CELL);
    const y = Math.round((py - PADDING) / CELL);
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return null;
    return { x, y };
  }

  // ---- 수 놓기 ----
  function placeStone(x, y, player) {
    board[y][x] = player;
    history.push({ x, y, player });
    lastMove = { x, y };
    updateMoveCount();
    draw();
  }

  function checkWinAt(x, y, player) {
    return OmokAI.isWinningMove(board, x, y, player);
  }

  function isBoardFull() {
    return history.length >= SIZE * SIZE;
  }

  function handleHumanMove(x, y) {
    if (!started || gameOver || busy) return;
    if (currentPlayer !== humanColor) return;
    if (board[y][x] !== EMPTY) return;

    placeStone(x, y, humanColor);

    if (checkWinAt(x, y, humanColor)) {
      gameOver = true;
      setStatus('🎉 당신(' + colorName(humanColor) + ')이 이겼습니다! 새 게임을 눌러 다시 도전하세요.');
      return;
    }
    if (isBoardFull()) {
      gameOver = true;
      setStatus('무승부입니다.');
      return;
    }

    currentPlayer = aiColor;
    scheduleAI();
  }

  function scheduleAI() {
    busy = true;
    thinkingEl.hidden = false;
    setStatus('컴퓨터가 생각 중…');
    // 렌더 후 비동기 계산 (UI 멈춤 방지)
    setTimeout(runAI, 30);
  }

  function runAI() {
    const move = OmokAI.bestMove(board, aiColor, AI_DEPTH);
    thinkingEl.hidden = true;

    if (!move || board[move.y][move.x] !== EMPTY) {
      // 둘 곳 없음
      gameOver = true;
      busy = false;
      setStatus('무승부입니다.');
      return;
    }

    placeStone(move.x, move.y, aiColor);

    if (checkWinAt(move.x, move.y, aiColor)) {
      gameOver = true;
      busy = false;
      setStatus('💻 컴퓨터(' + colorName(aiColor) + ')가 이겼습니다. 다시 도전해 보세요!');
      return;
    }
    if (isBoardFull()) {
      gameOver = true;
      busy = false;
      setStatus('무승부입니다.');
      return;
    }

    currentPlayer = humanColor;
    busy = false;
    setStatus('당신(' + colorName(humanColor) + ') 차례입니다.');
  }

  function undo() {
    if (!started || busy) return;
    if (history.length === 0) return;

    // 사람 차례에 무르기 → 마지막 두 수(사람+AI) 되돌림
    // AI 선공 상황 등도 안전하게 처리
    const removeOne = () => {
      const last = history.pop();
      if (last) {
        board[last.y][last.x] = EMPTY;
      }
    };

    // 게임이 끝났으면 마지막 한 수만 되돌려도 되지만,
    // 사람이 다시 둘 수 있도록 사람 차례가 되게 맞춘다.
    removeOne();
    if (history.length > 0 && currentPlayer === humanColor && !gameOver) {
      // 방금 되돌린 게 AI 수였다면 사람 수도 하나 더 되돌림
      removeOne();
    } else if (gameOver) {
      // 끝난 게임에서 한 번 더 되돌려 사람 차례 복구
      if (history.length > 0) {
        const top = history[history.length - 1];
        if (top.player === humanColor) removeOne();
      }
    }

    gameOver = false;
    currentPlayer = humanColor;
    lastMove = history.length ? { x: history[history.length - 1].x, y: history[history.length - 1].y } : null;
    updateMoveCount();
    draw();
    setStatus('무르기 완료. 당신(' + colorName(humanColor) + ') 차례입니다.');
  }

  // ---- 이벤트 ----
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const cell = pixelToCell(px, py);
    if (cell) handleHumanMove(cell.x, cell.y);
  });

  newGameBtn.addEventListener('click', resetGame);
  undoBtn.addEventListener('click', undo);

  stoneSelect.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const stone = btn.dataset.stone;
    [...stoneSelect.querySelectorAll('.seg-btn')].forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    if (stone === 'black') {
      humanColor = BLACK;
      aiColor = WHITE;
      setStatus('흑돌을 선택했습니다(선공). 새 게임을 눌러 시작하세요.');
    } else {
      humanColor = WHITE;
      aiColor = BLACK;
      setStatus('백돌을 선택했습니다(후공). 새 게임을 눌러 시작하세요.');
    }
  });

  // 초기 화면
  draw();
})();
