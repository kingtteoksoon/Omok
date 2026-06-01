/**
 * Evaluator.js — 정적 평가 함수 (선형 가치 모델 / Linear Value Model).
 *
 * 설계 이유 (NN 평가 + 강화학습 요구사항 충족):
 *   요구사항은 "신경망 평가(3순위)"와 "강화학습(4순위)"을 요구한다. 브라우저 단독·무의존
 *   환경에서 무거운 DNN 대신 *선형 가치 모델*(특징의 가중합)을 사용한다. 이는 1층
 *   신경망(활성화 없는 선형 유닛)과 수학적으로 동일하며, 가중치를 자가대국 결과로
 *   업데이트(강화학습)할 수 있어 "학습되는 평가 함수"라는 본질을 만족한다.
 *   특징(feature) = 모양 카테고리별 개수, 파라미터 = 학습 가능한 weights.
 *
 * 알고리즘:
 *   value(board, p) = Σ_cat  base[cat]·W[cat]·count_p[cat]
 *                   − defenseW · Σ_cat base[cat]·W[cat]·count_opp[cat]
 *   FIVE/OPEN_FOUR/FOUR 는 전술적으로 결정적이므로 고정 대형 가중치를 쓰고,
 *   중·저급 모양(OPEN_THREE…ONE)은 학습 가중치 W로 스케일한다(데이터 스키마와 일치).
 *
 * 시간복잡도: tallyBoard 2회 = O(CELLS).
 */
import { opp } from '../core/constants.js';
import { tallyBoard } from '../core/Patterns.js';

// 고정(전술적) 가중치 — 결정적 모양. 학습 대상 아님.
const FIXED = {
  FIVE: 10_000_000,
  OPEN_FOUR: 100_000,
  FOUR: 10_000,
};

// 학습 가중치가 곱해질 기준 스케일. (학습 weights는 ~0.5~4 범위의 배율)
const BASE = {
  OPEN_THREE: 1000,
  THREE: 300,
  OPEN_TWO: 120,
  TWO: 40,
};

export class Evaluator {
  /**
   * @param {object} weights 학습 가중치 {OPEN_THREE,THREE,OPEN_TWO,TWO,ONE,defense}
   */
  constructor(weights) {
    this.weights = Object.assign(
      { OPEN_THREE: 1, THREE: 1, OPEN_TWO: 1, TWO: 1, ONE: 1, defense: 1 },
      weights || {}
    );
  }

  setWeights(w) { this.weights = Object.assign(this.weights, w); }

  /** 한 색의 "공격력" 점수(상대 무시). 승률 계산 및 평가에 사용. */
  attackScore(cells, p) {
    const t = tallyBoard(cells, p);
    const W = this.weights;
    return (
      FIXED.FIVE * t.FIVE +
      FIXED.OPEN_FOUR * t.OPEN_FOUR +
      FIXED.FOUR * t.FOUR +
      BASE.OPEN_THREE * W.OPEN_THREE * t.OPEN_THREE +
      BASE.THREE * W.THREE * t.THREE +
      BASE.OPEN_TWO * W.OPEN_TWO * t.OPEN_TWO +
      BASE.TWO * W.TWO * t.TWO
    );
  }

  /**
   * 색 p 관점의 정적 평가. (자기 공격력 − 방어가중·상대 공격력)
   * 양수면 p 유리, 음수면 불리.
   */
  evaluate(cells, p) {
    const me = this.attackScore(cells, p);
    const you = this.attackScore(cells, opp(p));
    return me - this.weights.defense * you;
  }
}
