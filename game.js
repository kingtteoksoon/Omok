/*
 * ============================================================================
 *  오목 게임 — UI 및 게임 흐름 제어 (game.js)
 * ----------------------------------------------------------------------------
 *  역할:
 *   - 캔버스에 오목판과 돌을 그린다.
 *   - 사람의 클릭을 받아 착수 처리하고, AI(ai.js)에게 다음 수를 요청한다.
 *   - 승패/무승부를 판정하고 상태 메시지와 AI 사고 로그를 화면에 표시한다.
 *
 *  보드 데이터 표현:
 *   - board[y][x] 형태의 2차원 배열 (행 y, 열 x, 각 0~14)
 *   - 값: 0 = 빈칸(EMPTY), 1 = 흑(BLACK), 2 = 백(WHITE)
 *
 *  좌표계 주의:
 *   - 내부 로직은 (x, y) = (열, 행) 순서를 쓴다.
 *   - 배열 접근은 board[y][x] (행이 먼저)임에 유의.
 * ============================================================================
 */
(function () {
  'use strict';

  // ----- 상수 -----
  const SIZE = OmokAI.SIZE; // 오목판 한 변 칸 수 (15)
  const EMPTY = OmokAI.EMPTY; // 빈칸 값 (0)
  const BLACK = 1; // 흑돌 (선공)
  const WHITE = 2; // 백돌 (후공)

  // "개미친 어려움" 난이도 설정:
  //  - maxDepth: 미니맥스 최대 탐색 깊이(수읽기 깊이)
  //  - timeLimit: 한 수당 사고 시간 예산(ms). 이 시간 안에서 반복 심화로
  //    가능한 깊이까지 탐색한다. (ai.js의 bestMove가 사용)
  const AI_OPTIONS = { maxDepth: 10, timeLimit: 1500 };

  // ----- DOM 요소 캐싱 -----
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status'); // 상태 메시지 영역
  const thinkingEl = document.getElementById('thinking'); // "생각 중…" 표시
  const moveCountEl = document.getElementById('moveCount'); // 둔 수 카운터
  const newGameBtn = document.getElementById('newGameBtn');
  const stoneSelect = document.getElementById('stoneSelect'); // 흑/백 선택 버튼 묶음
  const logEl = document.getElementById('log'); // AI 사고 로그 패널
  const clearLogBtn = document.getElementById('clearLogBtn');

  // ----- 보드 화면 좌표 계산 -----
  // 캔버스 가장자리 여백(px). 격자선이 잘리지 않도록 안쪽으로 들여 그린다.
  const PADDING = 30;
  // 격자 한 칸의 픽셀 간격. (전체 너비 - 양쪽 여백) / (칸 수 - 1)
  const CELL = (canvas.width - PADDING * 2) / (SIZE - 1);

  // ----- 게임 상태 변수 -----
  let board = []; // 현재 판 상태 board[y][x]
  let history = []; // 착수 기록 [{x, y, player}, ...] — 수 카운트/순서 용도
  let humanColor = BLACK; // 사람이 잡은 색 (기본: 흑)
  let aiColor = WHITE; // 컴퓨터가 잡은 색
  let currentPlayer = BLACK; // 현재 둘 차례 (오목은 항상 흑이 선공)
  let gameOver = false; // 게임 종료 여부
  let busy = false; // AI가 사고 중일 때 사람 입력을 막는 잠금 플래그
  let started = false; // "새 게임"을 눌러 대국이 시작됐는지
  let lastMove = null; // 마지막 착수 위치 {x, y} — 강조 표시용

  // 빈 보드(2차원 배열)를 새로 만들어 반환한다.
  function createBoard() {
    const b = [];
    for (let y = 0; y < SIZE; y++) {
      b.push(new Array(SIZE).fill(EMPTY));
    }
    return b;
  }

  // 새 게임 시작: 모든 상태를 초기화하고 첫 차례를 세팅한다.
  function resetGame() {
    board = createBoard();
    history = [];
    currentPlayer = BLACK; // 흑 선공 규칙
    gameOver = false;
    busy = false;
    started = true;
    lastMove = null;
    clearLog();
    updateMoveCount();
    draw();

    // 사람이 백을 골랐다면 컴퓨터가 흑(선공)이므로 AI가 먼저 둔다.
    if (aiColor === BLACK) {
      setStatus('컴퓨터(흑)가 먼저 둡니다…');
      scheduleAI();
    } else {
      setStatus('당신(흑) 차례입니다. 돌을 놓으세요.');
    }
  }

  // 상태 메시지 텍스트를 갱신한다.
  function setStatus(msg) {
    statusEl.textContent = msg;
  }

  // 둔 수 카운터를 갱신한다.
  function updateMoveCount() {
    moveCountEl.textContent = '수: ' + history.length;
  }

  // 플레이어 번호(1/2)를 사람이 읽는 색 이름으로 변환한다.
  function colorName(p) {
    return p === BLACK ? '흑' : '백';
  }

  /* ==========================================================================
   *  AI 사고 로그
   *  - ai.js가 돌려준 분석(analysis)을 화면 패널과 콘솔에 출력한다.
   *  - 좌표 표기: 열 A~O, 행 1~15.  예) 내부 (x=7, y=7) → 화면 "H8"
   * ======================================================================== */

  // 내부 (x, y) 좌표를 사람이 읽는 표기("H8" 등)로 변환한다.
  function coord(x, y) {
    return String.fromCharCode(65 + x) + (y + 1); // 65 = 'A'
  }

  // 예측 수순(PV: Principal Variation)을 "흑H8 → 백I9 → …" 문자열로 변환한다.
  // PV는 AI가 머릿속으로 그려본 가상의 진행일 뿐, 실제 보드에는 두지 않는다.
  function pvToText(pv) {
    if (!pv || pv.length === 0) return '(없음)';
    return pv.map((p) => colorName(p.player) + coord(p.x, p.y)).join(' → ');
  }

  // AI가 그 수를 둔 판단 근거 코드를 한국어 설명으로 변환한다.
  function reasonText(reason) {
    switch (reason) {
      case 'opening': return '포석(중앙 선점)';
      case 'immediate_win': return '즉시 5목 완성 — 승리!';
      case 'block': return '상대 5목 임박 — 방어';
      default: return '심화 탐색';
    }
  }

  // 로그 패널 내용을 비운다.
  function clearLog() {
    logEl.innerHTML = '';
  }

  // AI의 한 수에 대한 분석 결과를 화면 패널(요약) + 콘솔(상세)에 기록한다.
  //  turnNo   : 이 수가 전체 몇 번째 수인지
  //  move     : 실제 착수 {x, y}
  //  analysis : ai.js가 채워준 분석 객체
  //             { reason, depth, nodes, timeMs, score, pv, topMoves, perDepth }
  function logAIMove(turnNo, move, analysis) {
    const a = analysis;
    const picked = coord(move.x, move.y);

    // ----- 1) 화면 패널: 한눈에 보는 요약 -----
    const entry = document.createElement('div');
    entry.className = 'log-entry';

    // 후보 평가: 루트에서 검토한 상위 후보들의 "위치(점수)" 나열
    const topText = a.topMoves && a.topMoves.length
      ? a.topMoves.map((m) => coord(m.x, m.y) + '(' + m.score.toLocaleString() + ')').join(', ')
      : '—';
    // 깊이별 진행: 각 탐색 깊이의 소요 시간과 노드 수
    const depthText = a.perDepth && a.perDepth.length
      ? a.perDepth.map((d) => 'd' + d.depth + ':' + d.ms + 'ms/' + d.nodes.toLocaleString() + 'n').join('  ')
      : '—';

    entry.innerHTML =
      '<div class="turn">▶ ' + turnNo + '수 — 컴퓨터(' + colorName(aiColor) + ') 착수: <span class="pick">' + picked + '</span></div>' +
      '<div class="meta">판단: ' + reasonText(a.reason) +
        ' · 탐색깊이 ' + a.depth + '수 · 평가 ' + a.score.toLocaleString() +
        ' · 노드 ' + (a.nodes || 0).toLocaleString() + ' · ' + a.timeMs + 'ms</div>' +
      '<div class="pv">예측 수순(PV): ' + pvToText(a.pv) + '</div>' +
      '<div class="meta">후보 평가: ' + topText + '</div>' +
      '<div class="depths">깊이별: ' + depthText + '</div>';

    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight; // 최신 로그가 보이도록 자동 스크롤

    // ----- 2) 콘솔: 표 형태의 상세 출력 (F12 개발자 도구) -----
    console.group('%c[오목 AI] ' + turnNo + '수 — 착수 ' + picked, 'color:#3ebd93;font-weight:bold;');
    console.log('판단 근거:', reasonText(a.reason));
    console.log('탐색 깊이:', a.depth + '수', '| 평가 점수:', a.score, '| 탐색 노드:', a.nodes, '| 소요:', a.timeMs + 'ms');
    console.log('예측 수순(PV):', pvToText(a.pv));
    if (a.topMoves && a.topMoves.length) {
      console.table(a.topMoves.map((m) => ({ 위치: coord(m.x, m.y), 점수: m.score })));
    }
    if (a.perDepth && a.perDepth.length) {
      console.log('깊이별 진행:');
      console.table(a.perDepth.map((d) => ({
        깊이: d.depth, 평가: d.score, 노드: d.nodes, 누적시간_ms: d.ms, 예측수순: pvToText(d.pv),
      })));
    }
    console.groupEnd();
  }

  /* ==========================================================================
   *  그리기 (Canvas 렌더링)
   * ======================================================================== */

  // 보드 전체를 다시 그린다. (격자 → 화점 → 돌 → 마지막 수 강조 순)
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 나무색 배경
    ctx.fillStyle = '#e3b96b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 격자선 (가로 SIZE줄 + 세로 SIZE줄)
    ctx.strokeStyle = '#5a3d1a';
    ctx.lineWidth = 1;
    for (let i = 0; i < SIZE; i++) {
      const p = PADDING + i * CELL;
      // 가로선
      ctx.beginPath();
      ctx.moveTo(PADDING, p);
      ctx.lineTo(canvas.width - PADDING, p);
      ctx.stroke();
      // 세로선
      ctx.beginPath();
      ctx.moveTo(p, PADDING);
      ctx.lineTo(p, canvas.height - PADDING);
      ctx.stroke();
    }

    // 화점(천원 + 네 귀) — 격자 좌표 3, 7, 11 의 교차점에 작은 점
    const dots = [3, 7, 11];
    ctx.fillStyle = '#5a3d1a';
    for (const gy of dots) {
      for (const gx of dots) {
        ctx.beginPath();
        ctx.arc(PADDING + gx * CELL, PADDING + gy * CELL, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 놓인 돌들
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (board[y][x] !== EMPTY) {
          drawStone(x, y, board[y][x]);
        }
      }
    }

    // 마지막 착수 위치를 빨간 원으로 강조
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

  // (x, y) 격자점에 player 색의 돌 하나를 입체감 있게 그린다.
  function drawStone(x, y, player) {
    const cx = PADDING + x * CELL; // 돌 중심 픽셀 x
    const cy = PADDING + y * CELL; // 돌 중심 픽셀 y
    const r = CELL * 0.42; // 돌 반지름

    // 방사형 그라데이션으로 광택/입체감 표현
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

    // 가장자리 얇은 테두리
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* ==========================================================================
   *  입력 처리 및 게임 진행
   * ======================================================================== */

  // 캔버스 픽셀 좌표(px, py)를 가장 가까운 격자점 (x, y)으로 변환한다.
  // 판 밖이면 null.
  function pixelToCell(px, py) {
    const x = Math.round((px - PADDING) / CELL);
    const y = Math.round((py - PADDING) / CELL);
    if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return null;
    return { x, y };
  }

  // (x, y)에 player 돌을 실제로 놓고 기록/화면을 갱신한다.
  function placeStone(x, y, player) {
    board[y][x] = player;
    history.push({ x, y, player });
    lastMove = { x, y };
    updateMoveCount();
    draw();
  }

  // (x, y)에 player가 둔 결과로 5목이 완성됐는지 (승리 판정). ai.js 로직 재사용.
  function checkWinAt(x, y, player) {
    return OmokAI.isWinningMove(board, x, y, player);
  }

  // 판이 가득 찼는지 (무승부 판정용).
  function isBoardFull() {
    return history.length >= SIZE * SIZE;
  }

  // 사람이 (x, y)를 클릭했을 때의 처리.
  function handleHumanMove(x, y) {
    // 시작 전, 게임 종료, AI 사고 중에는 무시
    if (!started || gameOver || busy) return;
    // 지금이 사람 차례가 아니면 무시
    if (currentPlayer !== humanColor) return;
    // 이미 돌이 있는 자리면 무시
    if (board[y][x] !== EMPTY) return;

    placeStone(x, y, humanColor);

    // 사람의 이번 수로 승리?
    if (checkWinAt(x, y, humanColor)) {
      gameOver = true;
      setStatus('🎉 당신(' + colorName(humanColor) + ')이 이겼습니다! 새 게임을 눌러 다시 도전하세요.');
      return;
    }
    // 판이 다 찼으면 무승부
    if (isBoardFull()) {
      gameOver = true;
      setStatus('무승부입니다.');
      return;
    }

    // 차례를 AI에게 넘긴다.
    currentPlayer = aiColor;
    scheduleAI();
  }

  // AI 사고를 예약한다. "생각 중" 표시를 먼저 렌더한 뒤 실제 계산을 시작한다.
  function scheduleAI() {
    busy = true;
    thinkingEl.hidden = false;
    setStatus('컴퓨터가 생각 중…');
    // setTimeout으로 한 프레임 양보 → "생각 중" UI가 먼저 그려진 뒤 계산 시작.
    // (탐색은 동기로 수행되어 그동안 잠시 멈출 수 있다.)
    setTimeout(runAI, 30);
  }

  // AI에게 다음 수를 계산시키고 그 결과를 실제로 둔다.
  function runAI() {
    // 주의: bestMove는 보드 "복사본"에서만 수읽기를 한다.
    // 따라서 예측 수순(PV)은 실제 board에 반영되지 않고, AI는 단 한 수만 둔다.
    const move = OmokAI.bestMove(board, aiColor, AI_OPTIONS);
    thinkingEl.hidden = true;

    // 둘 곳이 없으면(이론상 가득 참) 무승부 처리
    if (!move || board[move.y][move.x] !== EMPTY) {
      gameOver = true;
      busy = false;
      setStatus('무승부입니다.');
      return;
    }

    // 먼저 사고 과정을 로그로 남기고, 그 다음 실제로 한 수만 둔다.
    logAIMove(history.length + 1, move, move.analysis);
    placeStone(move.x, move.y, aiColor);

    // AI의 이번 수로 승리?
    if (checkWinAt(move.x, move.y, aiColor)) {
      gameOver = true;
      busy = false;
      setStatus('💻 컴퓨터(' + colorName(aiColor) + ')가 이겼습니다. 다시 도전해 보세요!');
      return;
    }
    // 판이 다 찼으면 무승부
    if (isBoardFull()) {
      gameOver = true;
      busy = false;
      setStatus('무승부입니다.');
      return;
    }

    // 차례를 사람에게 넘긴다.
    currentPlayer = humanColor;
    busy = false;
    setStatus('당신(' + colorName(humanColor) + ') 차례입니다.');
  }

  /* ==========================================================================
   *  이벤트 바인딩
   * ======================================================================== */

  // 보드 클릭 → 픽셀을 격자점으로 변환해 사람 착수 처리.
  // 캔버스는 CSS로 늘어날 수 있으므로 실제 해상도와의 배율을 보정한다.
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
  clearLogBtn.addEventListener('click', clearLog);

  // 흑/백 선택 토글. 선택만 해두고 실제 적용은 "새 게임"을 눌렀을 때.
  stoneSelect.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    const stone = btn.dataset.stone;

    // 활성 표시 토글
    [...stoneSelect.querySelectorAll('.seg-btn')].forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    if (stone === 'black') {
      // 사람=흑(선공), 컴퓨터=백(후공)
      humanColor = BLACK;
      aiColor = WHITE;
      setStatus('흑돌을 선택했습니다(선공). 새 게임을 눌러 시작하세요.');
    } else {
      // 사람=백(후공), 컴퓨터=흑(선공) → 새 게임 시 AI가 먼저 둔다.
      humanColor = WHITE;
      aiColor = BLACK;
      setStatus('백돌을 선택했습니다(후공). 새 게임을 눌러 시작하세요.');
    }
  });

  // 페이지 로드 직후 빈 판을 한 번 그려둔다. (대국은 "새 게임"부터)
  draw();
})();
