/**
 * Engine.js — AI 통합 엔진 (오케스트레이터).
 *
 * 설계 이유 (요구사항: 착수 전 파이프라인 + 콘솔 사고과정 + 시각화 데이터):
 *   여러 하위 시스템(평가·위협탐색·MCTS·알파베타·승률·학습)을 하나의 결정 파이프라인으로
 *   묶는다. 매 턴 동일한 절차를 밟아 "랜덤 금지·최고가치 수만 선택" 원칙을 보장하고,
 *   브라우저 콘솔에 사고과정을 출력하며, UI가 쓸 시각화/분석 데이터를 함께 반환한다.
 *
 * 착수 결정 파이프라인 (요구사항 순서 충실):
 *   1) 후보 수 생성 (근방 빈칸)
 *   2) 금수 필터링 (흑 3-3/장목)
 *   3) 즉시 승리수 → 있으면 즉시 채택
 *   4) 상대 즉승 방어 → 반드시 차단
 *   5) VCF(강제수) 승리 루트 탐색 → 있으면 채택
 *   6) 위험도/공격력/수비력 계산 (후보 점수화)
 *   7) 주 탐색(알파베타 또는 MCTS) 으로 최종 가치 평가
 *   8) 오프닝 북/학습 보정
 *   9) 승률 예측 + 최종 착수 결정 + 콘솔 출력
 *
 * 시간복잡도: 탐색 단계가 지배적. 시간 예산(timeMs)으로 1~3초 내 보장.
 */
import { EMPTY, BLACK, WHITE, opp, rowOf, colOf, idx, PAT } from '../core/constants.js';
import { analyzePoint } from '../core/Patterns.js';
import { blackForbidden, winnerAt } from '../core/Rules.js';
import { Evaluator } from './Evaluator.js';
import { Minimax } from './Minimax.js';
import { MCTS } from './MCTS.js';
import { WinRate } from './WinRate.js';
import { findWinningMoves, findVCF } from './ThreatSearch.js';

export class Engine {
  /**
   * @param {object} opt {weights, mode:'hybrid'|'alphabeta'|'mcts', timeMs, learner}
   */
  constructor(opt = {}) {
    this.ev = new Evaluator(opt.weights);
    this.mode = opt.mode ?? 'hybrid';
    this.timeMs = opt.timeMs ?? 3000;
    this.learner = opt.learner ?? null;   // 오프닝 북·전략 적응 제공자(선택)
    this.minimax = new Minimax(this.ev, { timeMs: this.timeMs, maxDepth: 10, width: 15 });
    this.mcts = new MCTS(this.ev, { timeMs: this.timeMs, iterations: 6000 });
    this.winrate = new WinRate(this.ev);
    this.verbose = opt.verbose ?? true;   // 콘솔 사고과정 출력 여부
  }

  setMode(m) { this.mode = m; }
  setTime(ms) { this.timeMs = ms; this.minimax.timeMs = ms; this.mcts.timeMs = ms; }
  syncWeights() { if (this.learner) this.ev.setWeights(this.learner.weights); }

  /**
   * 핵심: 색 p가 둘 최선수를 결정한다.
   * @returns {move, winrate, analysis, candidates(시각화용)}
   */
  chooseMove(board, p) {
    const t0 = performance.now();
    this.syncWeights();
    const turn = board.moveCount + 1;
    const you = opp(p);
    const cells = board.cells;
    const log = this.verbose ? console : { log() {}, group() {}, groupEnd() {}, table() {} };

    log.group(`%c[TURN ${turn}] AI(${p === BLACK ? 'BLACK' : 'WHITE'}) thinking…`, 'color:#4ea1ff;font-weight:bold');
    log.log('Analyzing Position…');

    // ── 1) 후보 생성 ──
    const rawCandidates = board.candidateCells();
    // ── 2) 금수 필터 + 후보 점수화(공격/수비/위험도) ──
    const scored = [];
    for (const i of rawCandidates) {
      const r = rowOf(i), c = colOf(i);
      if (p === BLACK && blackForbidden(cells, r, c).forbidden) continue; // 금수 제외
      const mine = analyzePoint(cells, p, r, c);       // 공격력
      const theirs = analyzePoint(cells, you, r, c);   // 수비력(상대가 두면)
      const attack = this._shapeScore(mine);
      const defense = this._shapeScore(theirs);
      const risk = this._riskOf(theirs);               // 이 칸을 상대가 차지 시 위험도
      scored.push({ i, r, c, attack, defense, risk, score: attack + 0.9 * defense, mine, theirs });
    }
    scored.sort((a, b) => b.score - a.score);
    log.log(`Generated Candidates: ${scored.length}`);

    // ── 3) 즉시 승리수 ──
    const myWins = findWinningMoves(board, p);
    if (myWins.length) {
      const move = myWins[0];
      this._report(log, { turn, move, reason: 'Immediate five (즉시 5목 승리)', candidates: scored.slice(0, 6) });
      return this._result(board, p, move, scored, { meWin: true }, 'immediate-win', t0);
    }

    // ── 4) 상대 즉승 방어 ──
    const yourWins = findWinningMoves(board, you);
    if (yourWins.length) {
      // 막을 수 있는 즉승 자리 우선(흑 금수로 못 막는 경우 제외)
      let block = -1;
      for (const w of yourWins) {
        const r = rowOf(w), c = colOf(w);
        if (p === BLACK && blackForbidden(cells, r, c).forbidden) continue;
        block = w; break;
      }
      const canBlock = block !== -1 && yourWins.length === 1;
      if (block !== -1) {
        this._report(log, { turn, move: block, reason: 'Block opponent five (상대 5목 차단)', candidates: scored.slice(0, 6), threat: 'CRITICAL' });
        return this._result(board, p, block, scored, { youWin: true, canBlock }, 'forced-block', t0);
      }
    }

    // ── 5) VCF 강제수 승리 루트 ──
    const vcf = findVCF(board, p, { maxDepth: 14, maxNodes: 15000 });
    if (vcf.win && vcf.move !== -1) {
      this._report(log, { turn, move: vcf.move, reason: 'VCF forced win (강제수 연속 승리)', candidates: scored.slice(0, 6), threat: 'WINNING' });
      return this._result(board, p, vcf.move, scored, { meWin: true }, 'vcf', t0);
    }

    // 상대 VCF 위협 인지(방어 필요도 상승) — 정보용
    const oppVcf = findVCF(board.clone(), you, { maxDepth: 12, maxNodes: 8000 });

    // ── 6) 오프닝 북 ──
    let bookMove = -1;
    if (this.learner) bookMove = this.learner.bookMove(board, p, scored);

    // ── 7) 주 탐색 ──
    let move = -1, searchInfo = {};
    const candidateMoves = scored.slice(0, 16).map((s) => s.i);
    if (this.mode === 'mcts') {
      const r = this.mcts.search(board, p);
      move = r.move; searchInfo = { engine: 'MCTS', visits: r.visits.slice(0, 5) };
    } else {
      // hybrid/alphabeta: 알파베타가 전술·전략 모두 안정적으로 강함
      const r = this.minimax.search(board, p);
      move = r.move; searchInfo = { engine: 'AlphaBeta', score: r.score, depth: r.depth, pv: r.pv };
    }

    // 탐색이 실패하면 최고 휴리스틱 후보로 폴백
    if (move === -1 || cells[move] !== EMPTY) move = scored.length ? scored[0].i : rawCandidates[0];

    // ── 8) 오프닝 북 보정: 초반엔 검증된 북 수를 우선 ──
    if (bookMove !== -1 && turn <= 8) {
      log.log(`Opening book suggests (${rowOf(bookMove)},${colOf(bookMove)}) → applied`);
      move = bookMove;
    }

    // ── 9) 보고 + 결과 ──
    const reason = this._reasonText(searchInfo, oppVcf.win);
    this._report(log, {
      turn, move, reason,
      candidates: scored.slice(0, 6),
      threat: oppVcf.win ? 'HIGH (opponent VCF)' : this._threatLevel(scored),
      searchInfo,
    });
    return this._result(board, p, move, scored, { youWin: oppVcf.win }, searchInfo.engine, t0);
  }

  // ───────────────────────── 내부 헬퍼 ─────────────────────────

  /** 모양 점수(후보 정렬/공방 가치). */
  _shapeScore(a) {
    if (a.hasFive) return 1e9;
    const c = a.counts;
    return c.OPEN_FOUR * 100000 + c.FOUR * 10000 + c.OPEN_THREE * 1500 +
           c.THREE * 350 + c.OPEN_TWO * 130 + c.TWO * 35 + c.ONE * 6;
  }

  /** 위험도: 상대가 이 칸을 차지했을 때 만들어지는 위협 강도. */
  _riskOf(theirs) {
    const c = theirs.counts;
    if (theirs.hasFive) return 1.0;
    if (c.OPEN_FOUR || c.FOUR >= 2) return 0.95;
    if (c.FOUR || c.OPEN_THREE >= 2) return 0.8;
    if (c.OPEN_THREE) return 0.55;
    if (c.THREE || c.OPEN_TWO) return 0.3;
    return 0.1;
  }

  /** 후보군 기반 위협 레벨 라벨. */
  _threatLevel(scored) {
    const top = scored[0];
    if (!top) return 'LOW';
    if (top.risk >= 0.95 || top.defense >= 100000) return 'CRITICAL';
    if (top.risk >= 0.8 || top.defense >= 10000) return 'HIGH';
    if (top.risk >= 0.5) return 'MEDIUM';
    return 'LOW';
  }

  _reasonText(info, oppThreat) {
    if (oppThreat) return 'Defuse opponent threat while keeping initiative (상대 위협 차단 + 주도권 유지)';
    if (info.engine === 'MCTS') return 'Highest visit-count move from MCTS (최다 방문 수)';
    if (info.score >= 5_000_000) return 'Winning line found (승리 라인 확보)';
    return 'Best attack-defense balance (최적 공방 균형)';
  }

  /** 콘솔 사고과정 출력 (요구사항 예시 포맷 준수). */
  _report(log, { turn, move, reason, candidates, threat, searchInfo }) {
    log.log(`Generated Candidates: ${candidates.length} (top shown)`);
    const labels = 'ABCDEFGH';
    candidates.forEach((c, k) => {
      log.log(`Candidate ${labels[k]} (${c.r},${c.c})  Score: ${(c.score).toFixed(0)}  ` +
              `Attack: ${c.attack.toFixed(0)}  Defense: ${c.defense.toFixed(0)}  Risk: ${(c.risk * 100).toFixed(0)}%`);
    });
    if (threat) log.log(`Threat Level: ${threat}`);
    if (searchInfo) log.log(`Search: ${JSON.stringify(searchInfo).slice(0, 160)}`);
    log.log(`%cSelected Move: (${rowOf(move)},${colOf(move)})`, 'color:#39d353;font-weight:bold');
    log.log(`Reason: ${reason}`);
    log.groupEnd();
  }

  /** 결과 패키징(승률·분석·시각화 후보 포함). */
  _result(board, p, move, scored, tactics, engine, t0) {
    const wr = this.winrate.compute(board, p, tactics);
    const elapsed = Math.round(performance.now() - t0);
    // 시각화용: 상위 후보를 위험도/가치에 따라 색 분류
    const viz = scored.slice(0, 12).map((c) => ({
      i: c.i, r: c.r, c: c.c, score: c.score, risk: c.risk,
      color: c.i === move ? 'select'
           : c.risk >= 0.8 ? 'red'
           : c.score >= 1500 ? 'green'
           : 'yellow',
    }));
    return {
      move,
      winrate: wr,
      elapsedMs: elapsed,
      engine,
      analysis: {
        topScore: scored[0]?.score ?? 0,
        threatLevel: this._threatLevel(scored),
        candidateCount: scored.length,
      },
      candidates: viz,
    };
  }

  /** 현재 국면 분석만 필요할 때(플레이어 차례 등) 승률·위협 요약 제공. */
  analyze(board, toMove) {
    const myWins = findWinningMoves(board, toMove);
    const yourWins = findWinningMoves(board, opp(toMove));
    const wr = this.winrate.compute(board, toMove, {
      meWin: myWins.length > 0,
      youWin: yourWins.length > 0,
      canBlock: yourWins.length <= 1,
    });
    return { winrate: wr };
  }
}
