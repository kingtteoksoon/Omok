/**
 * Renderer.js — Canvas 기반 바둑판/돌/오버레이 렌더링.
 *
 * 설계 이유 (요구사항: Canvas API, 시각화 기능):
 *   고해상도·고성능 묘사를 위해 Canvas를 사용한다. 격자/화점/돌/마지막수 표시/금수
 *   표식/AI 후보 시각화(초록=유망, 노랑=주의, 빨강=위험)를 레이어로 분리해 그린다.
 *   devicePixelRatio 를 반영해 레티나에서도 선명하게 렌더링한다.
 *
 * 알고리즘: 전체 다시 그리기(보드는 작아 매 프레임 redraw가 충분히 저렴). O(CELLS).
 */
import { SIZE, EMPTY, BLACK, WHITE, idx, rowOf, colOf } from '../core/constants.js';
import { blackForbidden } from '../core/Rules.js';

const STAR_POINTS = [3, 9, 15]; // 19로 바둑판 화점 좌표

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.overlay = [];          // AI 후보 시각화 데이터
    this.showForbidden = true;  // 흑 금수 표식 표시
    this.showOverlay = true;    // AI 사고 시각화 표시
    this.resize();
  }

  /** 컨테이너 크기에 맞춰 캔버스 픽셀 크기/여백/격자간격 계산. */
  resize() {
    const dpr = window.devicePixelRatio || 1;
    const css = Math.min(this.canvas.clientWidth, this.canvas.clientHeight) || 600;
    this.canvas.width = css * dpr;
    this.canvas.height = css * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.px = css;
    this.margin = css * 0.04;
    this.gap = (css - 2 * this.margin) / (SIZE - 1); // 격자 간격
    this.stoneR = this.gap * 0.44;
  }

  /** 격자 좌표 → 화면 px. */
  _xy(r, c) { return [this.margin + c * this.gap, this.margin + r * this.gap]; }

  /** 화면 px → 격자 좌표(가장 가까운 교차점), 범위 밖이면 null. */
  pickCell(px, py) {
    const c = Math.round((px - this.margin) / this.gap);
    const r = Math.round((py - this.margin) / this.gap);
    if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return null;
    return idx(r, c);
  }

  setOverlay(list) { this.overlay = list || []; }

  /** 전체 보드 렌더. board, lastMove(index), turnColor(흑 금수표시 대상). */
  render(board, lastMove = -1, turnColor = BLACK) {
    const ctx = this.ctx, px = this.px;
    // 배경(나무색)
    ctx.fillStyle = '#e9c27a';
    ctx.fillRect(0, 0, px, px);

    // 격자선
    ctx.strokeStyle = '#5a3d1a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < SIZE; k++) {
      const [x0, y0] = this._xy(0, k), [x1, y1] = this._xy(SIZE - 1, k);
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      const [a0, b0] = this._xy(k, 0), [a1, b1] = this._xy(k, SIZE - 1);
      ctx.moveTo(a0, b0); ctx.lineTo(a1, b1);
    }
    ctx.stroke();

    // 화점
    ctx.fillStyle = '#5a3d1a';
    for (const r of STAR_POINTS) for (const c of STAR_POINTS) {
      const [x, y] = this._xy(r, c);
      ctx.beginPath(); ctx.arc(x, y, this.gap * 0.08, 0, Math.PI * 2); ctx.fill();
    }

    // AI 사고 시각화 오버레이 (돌 아래 레이어)
    if (this.showOverlay) this._drawOverlay();

    // 흑 금수 표식 (현재 흑 차례일 때만)
    if (this.showForbidden && turnColor === BLACK) this._drawForbidden(board);

    // 돌
    for (let i = 0; i < SIZE * SIZE; i++) {
      const v = board.cells[i];
      if (v === EMPTY) continue;
      this._drawStone(rowOf(i), colOf(i), v, i === lastMove);
    }
  }

  _drawStone(r, c, color, isLast) {
    const ctx = this.ctx;
    const [x, y] = this._xy(r, c);
    // 그림자
    ctx.beginPath(); ctx.arc(x + 1.5, y + 2, this.stoneR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill();
    // 본체(그라데이션)
    const g = ctx.createRadialGradient(x - this.stoneR * 0.3, y - this.stoneR * 0.3, this.stoneR * 0.1, x, y, this.stoneR);
    if (color === BLACK) { g.addColorStop(0, '#555'); g.addColorStop(1, '#0a0a0a'); }
    else { g.addColorStop(0, '#fff'); g.addColorStop(1, '#cfcfcf'); }
    ctx.beginPath(); ctx.arc(x, y, this.stoneR, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    // 마지막 수 표식
    if (isLast) {
      ctx.beginPath(); ctx.arc(x, y, this.stoneR * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = color === BLACK ? '#ff5555' : '#cc2222'; ctx.fill();
    }
  }

  _drawForbidden(board) {
    const ctx = this.ctx;
    for (let i = 0; i < SIZE * SIZE; i++) {
      if (board.cells[i] !== EMPTY) continue;
      const r = rowOf(i), c = colOf(i);
      if (board.neighborCount[i] === 0) continue; // 근방 아닌 칸은 스킵(성능)
      if (blackForbidden(board.cells, r, c).forbidden) {
        const [x, y] = this._xy(r, c);
        ctx.strokeStyle = 'rgba(200,0,0,0.8)'; ctx.lineWidth = 2;
        const s = this.stoneR * 0.5;
        ctx.beginPath();
        ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
        ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
        ctx.stroke();
      }
    }
  }

  _drawOverlay() {
    const ctx = this.ctx;
    const colors = { green: 'rgba(57,211,83,0.45)', yellow: 'rgba(240,200,40,0.45)', red: 'rgba(230,60,60,0.45)', select: 'rgba(78,161,255,0.6)' };
    for (const o of this.overlay) {
      const [x, y] = this._xy(o.r, o.c);
      ctx.beginPath(); ctx.arc(x, y, this.stoneR * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = colors[o.color] || colors.yellow; ctx.fill();
    }
  }
}
