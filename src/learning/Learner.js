/**
 * Learner.js — 실시간 학습 · 패턴 분석 · 전략 적응 · 영속화.
 *
 * 설계 이유 (요구사항: 실시간 학습/패턴분석/전략적응/강화학습/저장):
 *   AI를 "고정 엔진"이 아니라 대국에서 배우는 주체로 만든다. 세 가지 학습 채널을 둔다.
 *     (1) 오프닝 북: (국면→수) 통계(n=방문,w=승). 자가대국/실전 결과로 갱신, 초반 가이드.
 *     (2) 가치 모델 가중치(강화학습): 승패 결과로 모양 가중치를 소폭 조정(정책경사 근사).
 *     (3) 상대 프로파일링: 상대의 공격/수비 성향·선호 위치·연속 수순을 누적하여
 *         전략 모드(공격형/수비형/카운터형/균형형)를 동적으로 전환.
 *   결과는 서버(/api/learning) 또는 localStorage(JSON)로 저장한다.
 *
 * 알고리즘:
 *   - 북 갱신: 게임 종료 시 각 (국면키, 수)에 n++ , 승리한 색의 수에 w++.
 *   - 가중치 갱신: Δw = lr · (승=+1/패=−1) · 정규화된 모양기여. 클램프로 발산 방지.
 *   - 상대 적응: aggression(공격수 비율) EMA → 임계값으로 전략 모드 결정.
 *
 * 시간복잡도: 게임당 O(수의 길이). 저장 O(북 크기) 직렬화.
 */
import { BLACK, WHITE, opp, rowOf, colOf, idx } from '../core/constants.js';
import { analyzePoint, tallyBoard } from '../core/Patterns.js';

const STORAGE_KEY = 'omok-learning-v2';

export class Learner {
  constructor() {
    this.version = 2;
    this.boardSize = 19;
    this.weights = { OPEN_THREE: 1.2, THREE: 0.5, OPEN_TWO: 2.0, TWO: 2.5, ONE: 0.7, defense: 1.4 };
    this.book = {};            // key "moveNo|board361" → {moveIdx:{n,w}}
    this.opponent = { style: 'balanced', aggression: 0.5, defense: 0.5, samples: 0, favorite: {} };
    this.stats = { games: 0, aiWins: 0, humanWins: 0, draws: 0, trainIters: 0 };
    this.logs = [];
    this.lr = 0.03;            // 강화학습 학습률
  }

  // ───────── 영속화 ─────────

  /** 서버(우선) 또는 localStorage 에서 로드. */
  async load() {
    try {
      const res = await fetch('/api/learning');
      if (res.ok) { this._apply(await res.json()); return 'server'; }
    } catch { /* 서버 없음 → 로컬 폴백 */ }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { this._apply(JSON.parse(raw)); return 'local'; }
    } catch { /* 무시 */ }
    return 'default';
  }

  _apply(d) {
    if (!d) return;
    if (d.weights) this.weights = Object.assign(this.weights, d.weights);
    if (d.book) this.book = d.book;
    if (d.opponent) this.opponent = Object.assign(this.opponent, d.opponent);
    if (d.stats) this.stats = Object.assign(this.stats, d.stats);
    if (d.logs) this.logs = d.logs;
  }

  toJSON() {
    return {
      version: this.version, boardSize: this.boardSize, weights: this.weights,
      book: this.book, opponent: this.opponent, stats: this.stats,
      logs: this.logs.slice(-200), // 최근 200판만 보관(파일 비대화 방지)
    };
  }

  /** 서버(우선)와 localStorage 둘 다 저장 시도. */
  async save() {
    const json = JSON.stringify(this.toJSON());
    try { localStorage.setItem(STORAGE_KEY, json); } catch { /* 용량 초과 무시 */ }
    try {
      await fetch('/api/learning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: json });
      return true;
    } catch { return false; }
  }

  // ───────── 오프닝 북 ─────────

  _bookKey(board) { return `${board.moveCount}|${board.serialize()}`; }

  /**
   * 현재 국면의 북 추천 수. 승률(w/n)과 방문수(n)를 결합해 신뢰도 높은 수 선택.
   * @param scored 엔진의 후보 점수목록(폴백 정렬용)
   * @returns 인덱스 또는 -1
   */
  bookMove(board, p, scored) {
    const entry = this.book[this._bookKey(board)];
    if (!entry) return -1;
    let best = -1, bestVal = -Infinity;
    for (const k in entry) {
      const { n, w } = entry[k];
      if (n < 2) continue;                       // 표본 부족 무시
      const winRate = w / n;
      const val = winRate + 0.3 * Math.min(1, n / 20); // 승률 + 방문 신뢰 보너스
      if (val > bestVal) { bestVal = val; best = +k; }
    }
    return best;
  }

  // ───────── 게임 종료 학습 ─────────

  /**
   * 한 판 종료 시 호출. 기보로 북·가중치·상대성향을 갱신한다.
   * @param moves [[r,c,player]...]  @param winner BLACK|WHITE|0  @param aiColor
   */
  learnFromGame(moves, winner, aiColor, humanColor = null) {
    this.stats.games++;
    if (winner === 0) this.stats.draws++;
    else if (winner === aiColor) this.stats.aiWins++;
    else this.stats.humanWins++;

    this._updateBook(moves, winner);
    this._updateWeights(moves, winner, aiColor);
    if (humanColor !== null) this._updateOpponentProfile(moves, humanColor);

    this.logs.push({ t: Date.now(), aiColor, humanColor, winner, moves });
    this.stats.trainIters++;
  }

  /** 기보를 따라 재생하며 (국면키, 수) 통계 누적. */
  _updateBook(moves, winner) {
    const cells = new Int8Array(361);
    for (let m = 0; m < Math.min(moves.length, 16); m++) { // 초반 16수만 북에 반영
      const [r, c, pl] = moves[m];
      const key = `${m}|${cells.join('')}`;
      const mi = idx(r, c);
      const e = (this.book[key] ||= {});
      const cell = (e[mi] ||= { n: 0, w: 0 });
      cell.n++;
      if (winner === pl) cell.w++;
      cells[mi] = pl;
    }
  }

  /**
   * 강화학습(정책경사 근사): 마지막 국면에서 각 색의 모양 기여를 보고
   * 승자 색의 모양 가중치는 강화, 패자 색 모양은 약화한다.
   * 단순·안정적 업데이트로 발산을 막기 위해 클램프 [0.2, 5].
   */
  _updateWeights(moves, winner, aiColor) {
    if (winner === 0) return;
    const reward = winner === aiColor ? +1 : -1; // AI 관점 보상
    // 최종 보드 재구성
    const cells = new Int8Array(361);
    for (const [r, c, pl] of moves) cells[idx(r, c)] = pl;
    // AI 색의 모양 개수를 특징으로 사용
    const t = this._tally(cells, aiColor);
    const norm = (t.OPEN_THREE + t.THREE + t.OPEN_TWO + t.TWO + 1);
    const keys = ['OPEN_THREE', 'THREE', 'OPEN_TWO', 'TWO'];
    for (const k of keys) {
      const grad = reward * (t[k] / norm);
      this.weights[k] = clamp(this.weights[k] + this.lr * grad, 0.2, 5);
    }
    // defense 가중치: 졌으면 방어를 더 중시하도록 미세 조정
    this.weights.defense = clamp(this.weights.defense + this.lr * (-reward) * 0.5, 0.5, 3);
  }

  /** 보드 전체 모양 집계(강화학습 특징 추출). */
  _tally(cells, p) { return tallyBoard(cells, p); }

  // ───────── 상대 프로파일링 / 전략 적응 ─────────

  /**
   * 상대(휴먼) 착수의 공격성/수비성·선호 위치를 EMA로 누적하고 전략 모드를 갱신.
   * aggression = 상대 수가 "공격형 모양(열린3 이상)"을 만든 비율.
   */
  _updateOpponentProfile(moves, humanColor) {
    const cells = new Int8Array(361);
    let attackMoves = 0, total = 0;
    for (const [r, c, pl] of moves) {
      if (pl === humanColor) {
        const a = analyzePoint(cells, humanColor, r, c);
        const c2 = a.counts;
        const isAttack = a.hasFive || c2.OPEN_FOUR || c2.FOUR || c2.OPEN_THREE >= 1;
        if (isAttack) attackMoves++;
        total++;
        // 선호 위치(보드 9분할 영역) 빈도
        const zone = `${Math.floor(r / 7)}${Math.floor(c / 7)}`;
        this.opponent.favorite[zone] = (this.opponent.favorite[zone] || 0) + 1;
      }
      cells[idx(r, c)] = pl;
    }
    if (total === 0) return;
    const ratio = attackMoves / total;
    const alpha = 0.3; // EMA 계수
    this.opponent.aggression = (1 - alpha) * this.opponent.aggression + alpha * ratio;
    this.opponent.defense = 1 - this.opponent.aggression;
    this.opponent.samples++;
    this.opponent.style = this._classifyStyle(this.opponent.aggression);
  }

  _classifyStyle(agg) {
    if (agg >= 0.65) return 'aggressive';   // 상대가 공격형 → 우리는 카운터/수비
    if (agg <= 0.35) return 'defensive';    // 상대가 수비형 → 우리는 공격형
    return 'balanced';
  }

  /**
   * 상대 성향에 따른 우리 전략 모드 추천.
   *   상대 공격형 → counter, 상대 수비형 → attack, 중간 → balanced.
   * 엔진의 공/수 가중에 활용할 수 있다.
   */
  recommendedStrategy() {
    const s = this.opponent.style;
    if (s === 'aggressive') return 'counter';
    if (s === 'defensive') return 'attack';
    return 'balanced';
  }
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
