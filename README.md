# ♟ Gomoku Pro AI — 프로기사 수준 오목 엔진

브라우저에서 실행되는 고급 오목(Gomoku/Omok) AI. 단순 규칙 기반이 아니라 **수읽기 ·
승률 예측 · 실시간 학습 · 전략 적응 · 자가대국 강화학습**을 수행하는 엔진입니다.

```
node server/server.js     # → http://localhost:3000
```
브라우저 콘솔(F12)을 열면 매 턴 AI의 사고과정이 출력됩니다.

---

## 1. 디렉토리 구조

```
Omok/
├── index.html              # UI 진입 (Canvas 보드 + 분석 패널)
├── styles/main.css         # 반응형 다크 테마 (PC 우선, 모바일 대응)
├── server/server.js        # 무의존 Node 서버: 정적 서빙 + 학습 JSON 영속화 API
├── data/learning.json      # 학습 결과(가중치/오프닝 북/통계) — JSON 저장
└── src/
    ├── core/               # 게임·규칙 엔진
    │   ├── constants.js     #   보드 기하·상수
    │   ├── Board.js         #   Int8Array 보드 + O(1) place/undo + 근방 후보 캐시
    │   ├── Patterns.js      #   모양 인식 (analyzePoint / tallyBoard)
    │   └── Rules.js         #   승리 판정 + 흑 금수(3-3·장목)
    ├── ai/                 # AI 엔진
    │   ├── Evaluator.js     #   선형 가치 모델(=1층 신경망) — 학습 가능 평가 함수
    │   ├── ThreatSearch.js  #   VCF 강제수 수읽기 (승리 루트 탐색)
    │   ├── Minimax.js       #   알파-베타 + 반복심화 + 무브오더링
    │   ├── MCTS.js          #   몬테카를로 트리 탐색 (휴리스틱 prior)
    │   ├── WinRate.js       #   로지스틱 승률 계산 (0~100%)
    │   └── Engine.js        #   통합 결정 파이프라인 + 콘솔 사고과정 출력
    ├── learning/           # 학습 엔진
    │   ├── Learner.js       #   오프닝 북 · 가중치 RL · 상대 프로파일링 · 영속화
    │   └── SelfPlay.js      #   자가대국(AI vs AI) 강화학습 루프
    └── ui/                 # 프레젠테이션
        ├── Renderer.js      #   Canvas 렌더 + AI 시각화 오버레이
        ├── Panel.js         #   승률/분석/학습 통계 패널
        └── Controller.js    #   게임 흐름·입력·턴 제어
```

구현 순서는 요구사항을 따라 **게임 엔진 → 규칙 엔진 → AI 엔진 → 승률 분석 → 학습 →
UI** 순으로 진행했습니다.

---

## 2. 게임 규칙

- 19×19, 흑 선공·백 후공.
- **흑 금수**: 3-3(열린3 두 개) 금수, 장목(6목 이상) 금수. **4-4·띈4 허용**.
- **백**: 금수 없음(5목 이상 승리).
- 금수 위치는 보드에 ✕ 로 표시됩니다.

## 3. AI 엔진 — 착수 결정 파이프라인

매 턴 동일 절차로 **최고 가치의 수만** 둡니다(랜덤 없음).

| 단계 | 내용 | 모듈 |
|---|---|---|
| 1 | 후보 수 생성(근방 빈칸) | `Board.candidateCells` |
| 2 | 금수 필터링 | `Rules.blackForbidden` |
| 3 | 위험도·공격력·수비력 점수화 | `Engine` + `Patterns.analyzePoint` |
| 4 | 즉시 승리수 탐지 | `ThreatSearch.findWinningMoves` |
| 5 | 상대 즉승 방어 | `ThreatSearch.findWinningMoves` |
| 6 | VCF 강제수 승리 루트 | `ThreatSearch.findVCF` |
| 7 | 주 탐색(α-β / MCTS) | `Minimax` / `MCTS` |
| 8 | 오프닝 북 보정 | `Learner.bookMove` |
| 9 | 승률 예측 + 최종 착수 + 콘솔 출력 | `WinRate`, `Engine` |

### 권장 AI 구조 충족
- **1순위 MCTS** — `MCTS.js` (UCT 선택, 휴리스틱 prior 확장, 그리디 롤아웃). 자가대국 학습 골격.
- **2순위 Minimax/Alpha-Beta** — `Minimax.js` (반복심화·무브오더링). 기본 `hybrid` 모드의 주 엔진(전술 안정성).
- **3순위 신경망 평가** — `Evaluator.js`. 무의존 환경에서 *선형 가치 모델*(활성화 없는 1층 신경망과 동치)을 사용하며, 특징=모양 카테고리 개수, 파라미터=학습 가중치.
- **4순위 강화학습** — `Learner._updateWeights`(정책경사 근사) + `SelfPlay` 자가대국.

> 설계 선택: 오목은 전술이 날카로워, 동일 시간예산에서는 *위협탐색(VCF)+알파베타*가
> 순수 MCTS보다 안정적으로 강합니다. 그래서 기본값은 `hybrid`이며 MCTS는 자가대국·옵션
> 모드로 완전 구현해 두었습니다. (UI에서 엔진 전환 가능)

## 4. 승률 계산

`adv = log압축(공격력_나) − log압축(공격력_상대) + tempo` 를 로지스틱으로 0~100%에
사상하고, 즉승/막을수없는위협 등은 전술 오버라이드로 보정합니다. 매 수마다 우측 패널과
승률 막대가 실시간 갱신되고 **AI 우세/플레이어 우세/호각세**를 표시합니다.

## 5. 학습 시스템

- **실시간 학습**: 대국 종료 시 기보로 오프닝 북(`{국면→수: n,w}`)과 가치 가중치를 갱신.
- **상대 프로파일링**: 상대의 공격성(EMA)·선호 영역을 누적 → `공격형/수비형/균형형`
  분류 → 전략 모드(`attack/counter/balanced`) 적응.
- **자가대국(Self-Play)**: 버튼 한 번으로 수십~수만 판 반복 학습(강화학습). 진행률 표시.
- **저장**: `POST /api/learning` 으로 서버의 `data/learning.json` 에 원자적 저장,
  서버 미동작 시 `localStorage` 폴백. "내보내기"로 JSON 다운로드도 가능.

> 기존 업로드된 학습 파일(`omok-learning-2026-05-30*.json`)은 15×15 보드용이라
> 좌표 호환이 안 되어, **board-size 독립적인 가중치만 시드**로 재사용하고 19×19용
> 오프닝 북은 새로 학습합니다. 저장 스키마(version/weights/book/stats/logs)는 동일하게
> 유지해 앞으로 호환됩니다.

## 6. 콘솔 사고과정 출력 예시

```
[TURN 12] AI(WHITE) thinking…
  Analyzing Position…
  Generated Candidates: 35 (top shown)
  Candidate A (10,11)  Score: 1820  Attack: 1500  Defense: 360  Risk: 55%
  …
  Threat Level: HIGH
  Search: {"engine":"AlphaBeta","score":420,"depth":6,"pv":[...]}
  Selected Move: (10,11)
  Reason: Best attack-defense balance
```

## 7. 성능 · 복잡도

| 연산 | 복잡도 | 비고 |
|---|---|---|
| `Board.place/undo` | O(1) | 근방 카운터 상수 갱신 |
| `analyzePoint` | O(1) | 4방향 × 상수 윈도우 |
| `tallyBoard` / `evaluate` | O(CELLS) | 전체 라인 1패스 |
| `Minimax.search` | ~O(b^(d/2)) | b≈12, d≈6, 무브오더링 가지치기 |
| `findVCF` | O(b^d) (b≈1~5) | 강제수라 분기 극소 → 실전 빠름 |
| `MCTS.search` | O(iter·(깊이+롤아웃)) | 시간예산 상한 |

AI 응답시간 목표 **1초 이내(최대 3초)** 를 시간예산(`timeMs`)으로 보장합니다.

## 8. 게임 모드

- **AI VS PLAYER**: 사람(흑 또는 백) vs AI.
- **PLAYER VS PLAYER**: 동일 브라우저 2인 대전.
- 난이도(사고시간), 탐색 엔진, 시각화 토글을 UI에서 선택.

---

### 코드 품질
모든 모듈은 객체지향·단일책임으로 분리했고, 각 파일 상단에 **설계 이유 · 알고리즘 ·
시간복잡도**를 주석으로 명시했습니다. 핵심 로직은 Node 기반 단위 테스트로 검증했습니다
(규칙·승리·금수·즉승/방어·VCF·자가대국).
