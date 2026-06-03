/**
 * Panel.js — 우측 분석 패널 갱신 (승률·위협·분석·학습 통계).
 *
 * 설계 이유 (요구사항: 화면 우측 패널, 승률 막대, 예상 우세, 분석 항목):
 *   DOM 갱신 로직을 한 곳에 모아 View 책임을 분리한다. 엔진/게임 상태를 받아
 *   승률 막대, 우세 판정, 위협/분석 텍스트, 학습 통계를 갱신한다.
 *
 * 알고리즘: 단순 DOM 텍스트/스타일 갱신. O(1).
 */
export class Panel {
  constructor() {
    this.$ = (id) => document.getElementById(id);
  }

  /** 승률 막대/숫자 갱신. wr = {black, white} */
  setWinRate(wr, aiColor) {
    const aiRate = aiColor === 1 ? wr.black : wr.white;
    const plRate = 100 - aiRate;
    this.$('ai-winrate').textContent = `${aiRate.toFixed(1)}%`;
    this.$('player-winrate').textContent = `${plRate.toFixed(1)}%`;
    this.$('winbar-ai').style.width = `${aiRate}%`;
    this.$('winbar-player').style.width = `${plRate}%`;

    // 예상 우세
    let label, cls;
    const diff = aiRate - plRate;
    if (Math.abs(diff) < 8) { label = '호각세 (Even)'; cls = 'even'; }
    else if (diff > 0) { label = 'AI 우세'; cls = 'ai'; }
    else { label = '플레이어 우세'; cls = 'player'; }
    const el = this.$('advantage');
    el.textContent = `예상 우세: ${label}`;
    el.className = `advantage ${cls}`;
  }

  /** AI 분석 요약 갱신. */
  setAnalysis(info) {
    if (!info) return;
    this.$('threat-level').textContent = info.threatLevel ?? '-';
    this.$('candidate-count').textContent = info.candidateCount ?? '-';
    this.$('engine-name').textContent = info.engine ?? '-';
    this.$('think-time').textContent = info.elapsedMs != null ? `${info.elapsedMs} ms` : '-';
  }

  /** 상단 상태/턴 표시. */
  setStatus(text, color) {
    const el = this.$('status');
    el.textContent = text;
    if (color) el.style.color = color;
  }

  /** 학습 통계 갱신. */
  setStats(stats, opponent) {
    if (stats) {
      this.$('stat-games').textContent = stats.games;
      this.$('stat-aiwins').textContent = stats.aiWins;
      this.$('stat-humanwins').textContent = stats.humanWins;
      this.$('stat-iters').textContent = stats.trainIters;
    }
    if (opponent) {
      const map = { aggressive: '공격형', defensive: '수비형', balanced: '균형형' };
      this.$('opp-style').textContent = map[opponent.style] || opponent.style;
      this.$('opp-agg').textContent = `${(opponent.aggression * 100).toFixed(0)}%`;
    }
  }

  /** 학습 진행률(셀프플레이) 갱신. */
  setProgress(done, total) {
    const el = this.$('selfplay-progress');
    if (!el) return;
    if (total === 0) { el.textContent = ''; return; }
    el.textContent = `Self-Play: ${done}/${total}`;
  }
}
