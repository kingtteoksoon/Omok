/*
 * ============================================================================
 *  오목 학습 모듈 — 강화학습 + 로그/학습데이터 저장 (learning.js)
 * ----------------------------------------------------------------------------
 *  두 가지 학습을 함께 제공한다.
 *
 *  (1) 자가대국 가중치 학습 (진화형 강화학습 / hill-climbing)
 *      - 현재 '챔피언' 가중치에 약간의 변이를 준 '챌린저'를 만든다.
 *      - 둘을 빠른(얕은) 탐색으로 여러 판 자가대국시킨다.
 *      - 챌린저가 더 많이 이기면 챔피언을 교체한다 → 반복할수록 강해진다.
 *      - 학습 대상: ai.js의 포지셔널 가중치(열린3·3·열린2·2·1, 방어계수).
 *
 *  (2) 경험 메모리 (오프닝 북)
 *      - 실제 대국(사람 vs AI)의 (국면 → 둔 수 → 최종 승패)를 누적 기록한다.
 *      - 실제 플레이에서 AI가 수를 고를 때, '과거에 이겼던 수'에 가산점을
 *        '졌던 수'에 감점을 줘서 선호/회피한다(bookBonus).
 *
 *  저장: 모든 데이터(가중치/경험/통계/최근 로그)를 localStorage에 보관하고,
 *        JSON으로 내보내기/불러오기 할 수 있다.
 * ============================================================================
 */
(function (global) {
  'use strict';

  const AI = global.OmokAI;
  const SIZE = AI.SIZE;
  const EMPTY = AI.EMPTY;

  const STORAGE_KEY = 'omok_learn_v1';
  const SCHEMA_VERSION = 1;

  // ----- 경험 메모리 파라미터 -----
  const BOOK_MAX_PLY = 16; // 이 수(ply) 이내의 국면만 기록(주로 오프닝, 재현성↑)
  const BOOK_SCALE = 1500; // 경험 가산점 최대 크기 (전술 점수보다 작게)
  const BOOK_CONFIDENCE = 3; // 표본이 이 정도는 쌓여야 가산점을 100% 신뢰
  const LOG_MAX = 100; // 보관할 최근 대국 로그 수

  // ----- 자가대국 학습 기본 파라미터 -----
  const TRAIN_DEFAULTS = {
    iterations: 15, // 반복(세대) 수
    depth: 2, // 자가대국 탐색 깊이(얕게 → 빠르게 많은 판)
    maxPly: 50, // 한 판 최대 수 (무승부 처리)
    openings: 3, // 매치당 무작위 오프닝 수 (×2색 = 매치당 2N판)
    sigma: 0.25, // 가중치 변이 크기(로그정규 표준편차)
  };

  // 학습 대상 가중치의 허용 범위 (발산 방지)
  //  OPEN_THREE는 '닫힌 4(FOUR=10만)'를 넘지 않도록 상한을 1.8로 둔다
  //  (열린3 base 5만 × 1.8 = 9만 < 10만). 전술적 우선순위 보존.
  const WEIGHT_BOUNDS = {
    OPEN_THREE: [0.3, 1.8],
    THREE: [0.3, 4],
    OPEN_TWO: [0.2, 4],
    TWO: [0.2, 4],
    ONE: [0.1, 4],
    defense: [0.3, 1.6],
  };
  const WEIGHT_KEYS = Object.keys(WEIGHT_BOUNDS);

  // ----- 영속 상태 -----
  let state = defaultState();
  let training = false;
  let cancelFlag = false;

  // 내장 기본 패턴(default-learning.js)이 로드돼 있으면 그 가중치/경험북을
  // 시드로 쓴다. 없으면 AI의 순정 가중치 + 빈 경험북으로 시작한다.
  //  → 첫 방문(저장 데이터 없음)에도 학습된 AI와 바로 대결할 수 있다.
  //  → 승패 통계/로그는 플레이 이력이므로 시드하지 않고 0부터 집계한다.
  function defaultState() {
    const seed = global.OmokDefaultLearn || null;
    return {
      version: SCHEMA_VERSION,
      weights: seed && seed.weights ? Object.assign({}, seed.weights) : AI.getWeights(),
      book: seed && seed.book ? deepCopyBook(seed.book) : {},
      stats: { games: 0, aiWins: 0, humanWins: 0, draws: 0, trainIters: 0 },
      logs: [], // 최근 대국 로그
    };
  }

  // 경험북(중첩 객체)을 깊은 복사해, 시드 원본이 플레이 중 변형되지 않게 한다.
  function deepCopyBook(book) {
    const out = {};
    for (const posKey in book) {
      const node = book[posKey];
      const copy = {};
      for (const mk in node) copy[mk] = { n: node[mk].n, w: node[mk].w };
      out[posKey] = copy;
    }
    return out;
  }

  // ---- 저장/불러오기 ----
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.warn('[학습] 저장 실패:', e);
      return false;
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === SCHEMA_VERSION) {
        state = Object.assign(defaultState(), parsed);
        return true;
      }
    } catch (e) {
      console.warn('[학습] 불러오기 실패:', e);
    }
    return false;
  }

  // 모듈 초기화: 저장된 데이터를 읽어 AI에 학습 가중치를 적용한다.
  function init() {
    load();
    AI.setWeights(state.weights);
    return getStats();
  }

  /* ==========================================================================
   *  경험 메모리 (오프닝 북)
   * ======================================================================== */

  // 보드 + 둘 차례(side)를 하나의 키 문자열로 만든다.
  function posKey(board, side) {
    let s = side + '|';
    for (let y = 0; y < SIZE; y++) {
      const row = board[y];
      for (let x = 0; x < SIZE; x++) s += row[x];
    }
    return s;
  }

  function moveKey(x, y) {
    return x * SIZE + y;
  }

  // 한 판이 끝나면 호출: 경험 메모리/통계/로그를 갱신하고 저장한다.
  //  game = { humanColor, aiColor, winner(1|2|0), moves:[{x,y,player}, ...] }
  function recordGame(game) {
    const { moves, winner } = game;

    // --- 경험 메모리: 초반 국면들에 대해 (국면,수) → 승패 누적 ---
    const board = emptyBoard();
    for (let i = 0; i < moves.length && i < BOOK_MAX_PLY; i++) {
      const { x, y, player } = moves[i];
      const key = posKey(board, player); // 이 수를 두기 직전의 국면
      const mk = moveKey(x, y);
      const node = state.book[key] || (state.book[key] = {});
      const rec = node[mk] || (node[mk] = { n: 0, w: 0 });
      rec.n++;
      if (winner === player) rec.w++; // 이 수를 둔 쪽이 최종 승리했으면 +가점
      board[y][x] = player; // 다음 국면으로
    }

    // --- 통계 ---
    state.stats.games++;
    if (winner === game.aiColor) state.stats.aiWins++;
    else if (winner === game.humanColor) state.stats.humanWins++;
    else state.stats.draws++;

    // --- 로그(최근 LOG_MAX판) ---
    state.logs.push({
      t: Date.now(),
      humanColor: game.humanColor,
      aiColor: game.aiColor,
      winner,
      moves: moves.map((m) => [m.x, m.y, m.player]),
    });
    if (state.logs.length > LOG_MAX) state.logs.splice(0, state.logs.length - LOG_MAX);

    save();
  }

  // 실제 플레이에서 쓰는 경험 가산점 함수 생성.
  // 현재 국면(board, aiSide가 둘 차례)에서 후보 (x,y)에 줄 점수를 돌려준다.
  // 기록이 없으면 null을 반환 → AI는 순수 탐색 결과만 사용.
  function makeBookBonus(board, aiSide) {
    const node = state.book[posKey(board, aiSide)];
    if (!node) return null;
    return function (x, y) {
      const rec = node[moveKey(x, y)];
      if (!rec || rec.n < 1) return 0;
      const winRate = rec.w / rec.n; // 0~1
      const confidence = Math.min(1, rec.n / BOOK_CONFIDENCE);
      // 승률 0.5를 기준으로 ±. (이긴 수 +, 진 수 −)
      return BOOK_SCALE * (2 * winRate - 1) * confidence;
    };
  }

  /* ==========================================================================
   *  자가대국 가중치 학습 (진화형 강화학습)
   * ======================================================================== */

  function emptyBoard() {
    const b = [];
    for (let y = 0; y < SIZE; y++) b.push(new Array(SIZE).fill(EMPTY));
    return b;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  // 챔피언 가중치에 로그정규 변이를 줘 챌린저를 만든다.
  function mutate(weights, sigma) {
    const out = Object.assign({}, weights);
    for (const k of WEIGHT_KEYS) {
      const factor = Math.exp(gaussian() * sigma);
      const [lo, hi] = WEIGHT_BOUNDS[k];
      out[k] = clamp((weights[k] || 1) * factor, lo, hi);
    }
    return out;
  }

  // 표준정규 난수 (Box–Muller)
  function gaussian() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // 무작위 오프닝(흑 첫 수)을 중앙 근처에서 하나 고른다.
  function randomOpening() {
    const c = Math.floor(SIZE / 2);
    const dx = Math.floor(Math.random() * 5) - 2; // -2..2
    const dy = Math.floor(Math.random() * 5) - 2;
    return { x: clamp(c + dx, 0, SIZE - 1), y: clamp(c + dy, 0, SIZE - 1) };
  }

  // 가중치 wBlack(흑) vs wWhite(백)로 한 판 자가대국. 승자(1/2/0) 반환.
  function playSelfGame(wBlack, wWhite, opening, opts) {
    const board = emptyBoard();
    const fast = { maxDepth: opts.depth, timeLimit: 1e9 }; // 깊이로만 제한
    // 흑 첫 수는 지정된 오프닝으로(다양성 확보)
    board[opening.y][opening.x] = 1;
    if (AI.isWinningMove(board, opening.x, opening.y, 1)) return 1;
    let side = 2;
    for (let ply = 1; ply < opts.maxPly; ply++) {
      AI.setWeights(side === 1 ? wBlack : wWhite);
      const mv = AI.bestMove(board, side, fast);
      if (!mv || board[mv.y][mv.x] !== EMPTY) return 0;
      board[mv.y][mv.x] = side;
      if (AI.isWinningMove(board, mv.x, mv.y, side)) return side;
      side = side === 1 ? 2 : 1;
    }
    return 0; // 무승부
  }

  // 챌린저 vs 챔피언 한 매치. 챌린저가 더 많이 이기면 true.
  function challengerWins(champion, challenger, opts) {
    let cW = 0, chW = 0;
    for (let i = 0; i < opts.openings; i++) {
      const op = randomOpening();
      // 같은 오프닝을 색을 바꿔 두 판씩 (공정성)
      let r = playSelfGame(champion, challenger, op, opts); // 흑=챔피언
      if (r === 1) cW++; else if (r === 2) chW++;
      r = playSelfGame(challenger, champion, op, opts); // 흑=챌린저
      if (r === 1) chW++; else if (r === 2) cW++;
    }
    return { accept: chW > cW, championWins: cW, challengerWins: chW };
  }

  /**
   * 자가대국 학습을 비동기로 실행한다(UI 멈춤 방지를 위해 반복마다 양보).
   * @param {object} userOpts {iterations, depth, maxPly, openings, sigma}
   * @param {object} cb {onProgress(done,total,info), onDone(result)}
   */
  function train(userOpts, cb) {
    if (training) return false;
    const opts = Object.assign({}, TRAIN_DEFAULTS, userOpts || {});
    cb = cb || {};
    training = true;
    cancelFlag = false;

    let champion = Object.assign({}, state.weights);
    let accepted = 0;
    let iter = 0;

    function step() {
      if (cancelFlag || iter >= opts.iterations) return finish();

      iter++;
      const challenger = mutate(champion, opts.sigma);
      const res = challengerWins(champion, challenger, opts);
      if (res.accept) {
        champion = challenger;
        accepted++;
      }
      if (cb.onProgress) {
        cb.onProgress(iter, opts.iterations, {
          accepted,
          lastMatch: res,
          weights: Object.assign({}, champion),
        });
      }
      // 다음 반복은 매크로태스크로 넘겨 UI가 갱신될 틈을 준다.
      setTimeout(step, 0);
    }

    function finish() {
      // 학습 결과(챔피언)를 확정 적용·저장
      state.weights = champion;
      state.stats.trainIters += iter;
      AI.setWeights(champion);
      save();
      training = false;
      if (cb.onDone) cb.onDone({ accepted, iterations: iter, weights: Object.assign({}, champion) });
    }

    setTimeout(step, 0);
    return true;
  }

  function cancelTraining() {
    cancelFlag = true;
  }

  /* ==========================================================================
   *  내보내기 / 불러오기 / 초기화 / 조회
   * ======================================================================== */

  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }

  // 외부 JSON으로 상태를 교체한다(검증 후). 성공 시 true.
  function importJSON(obj) {
    try {
      const data = typeof obj === 'string' ? JSON.parse(obj) : obj;
      if (!data || typeof data !== 'object') return false;
      state = Object.assign(defaultState(), data, { version: SCHEMA_VERSION });
      AI.setWeights(state.weights);
      save();
      return true;
    } catch (e) {
      console.warn('[학습] 불러오기(JSON) 실패:', e);
      return false;
    }
  }

  function reset() {
    state = defaultState();
    AI.setWeights(state.weights);
    save();
  }

  function getStats() {
    return {
      games: state.stats.games,
      aiWins: state.stats.aiWins,
      humanWins: state.stats.humanWins,
      draws: state.stats.draws,
      trainIters: state.stats.trainIters,
      bookSize: Object.keys(state.book).length,
      logs: state.logs.length,
      weights: AI.getWeights(),
    };
  }

  function isTraining() {
    return training;
  }

  global.OmokLearn = {
    init,
    recordGame,
    makeBookBonus,
    train,
    cancelTraining,
    isTraining,
    exportJSON,
    importJSON,
    reset,
    getStats,
  };
})(typeof window !== 'undefined' ? window : globalThis);
