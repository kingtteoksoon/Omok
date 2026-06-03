/**
 * WinRate.js — 승률 계산 시스템.
 *
 * 설계 이유 (요구사항: 매 턴 AI/플레이어 승률 0~100%, 실시간 갱신):
 *   탐색 점수(평가값)는 절대 단위가 없어 그대로 보여줄 수 없다. 로지스틱(시그모이드)
 *   함수로 "점수 차 → 확률"로 사상하면 해석 가능한 0~100% 승률이 된다. 또한
 *   전술적 결정 국면(즉승/열린4/막아야 하는 위협)은 평가값만으로는 과소/과대평가될 수
 *   있어, 명시적 전술 오버라이드로 보정한다.
 *
 * 알고리즘:
 *   adv = attack(me) − attack(opp)            (방어가중 없는 순수 공격력 차)
 *   p(me) = 1 / (1 + exp(−adv / K))            (로지스틱, K=스케일)
 *   + 전술 오버라이드: 즉승 가능 → ~99%, 상대 즉승(내가 못 막음) → ~1%, 등.
 *   + 선수(tempo) 보정: 둘 차례 색에 소폭 가산.
 *
 * 시간복잡도: attackScore 2회 = O(CELLS).
 */
import { opp } from '../core/constants.js';

export class WinRate {
  constructor(evaluator) { this.ev = evaluator; }

  /**
   * @param board 현재 보드
   * @param toMove 둘 차례 색
   * @param tactics {meWin:boolean, youWin:boolean} 선택적 전술 힌트(엔진이 주입)
   * @returns {black:number, white:number, advFor:('AI'|...)} 0~100 정수 승률
   */
  compute(board, toMove, tactics = {}) {
    const me = toMove, you = opp(toMove);
    const sMe = this.ev.attackScore(board.cells, me);
    const sYou = this.ev.attackScore(board.cells, you);

    // 점수 차를 로그 스케일로 압축 후 로지스틱. 큰 값 폭주를 막기 위해 부호보존 log.
    const slog = (x) => Math.sign(x) * Math.log10(1 + Math.abs(x));
    const adv = slog(sMe) - slog(sYou) + 0.15; // +0.15 = 선수(tempo) 보정
    let pMe = 1 / (1 + Math.exp(-adv / 0.9));

    // 전술 오버라이드 (엔진이 정확 정보 제공 시)
    if (tactics.meWin) pMe = 0.995;
    else if (tactics.youWin && !tactics.canBlock) pMe = 0.01;
    else if (tactics.youWin) pMe = Math.min(pMe, 0.35);

    pMe = Math.max(0.005, Math.min(0.995, pMe));
    const pYou = 1 - pMe;

    // 색 기준으로 환산
    const black = me === 1 ? pMe : pYou;
    return {
      black: +(black * 100).toFixed(1),
      white: +((1 - black) * 100).toFixed(1),
      forMove: +(pMe * 100).toFixed(1),
    };
  }
}
