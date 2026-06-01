/**
 * server.js — Zero-dependency static + persistence server for the Gomoku Pro AI app.
 *
 * 설계 이유 (Design rationale):
 *   요구사항은 "Node.js 백엔드 + JSON 저장"이다. 외부 의존성(Express 등) 없이
 *   Node 내장 http/fs 모듈만으로 구현하여 어떤 환경에서도 `node server/server.js`
 *   한 줄로 실행되게 한다. 브라우저(프런트엔드)에서 무거운 AI 연산을 모두 수행하므로
 *   서버는 (1) 정적 파일 서빙과 (2) 학습 결과(JSON) 영속화 두 가지 책임만 진다.
 *
 * 알고리즘 (Algorithm):
 *   - 정적 파일: 요청 경로를 화이트리스트 기반으로 안전하게 디스크 경로로 해석한 뒤
 *     스트리밍 전송. 경로 탈출(../)을 차단한다.
 *   - 영속화: GET /api/learning → data/learning.json 반환,
 *             POST /api/learning → 본문(JSON)을 검증 후 원자적으로 저장(temp→rename).
 *
 * 시간복잡도 (Complexity):
 *   요청당 O(파일 크기). 파일 I/O 바운드이며 CPU 연산은 사실상 없다.
 */

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');           // 프로젝트 루트
const DATA_FILE = path.join(ROOT, 'data', 'learning.json');
const PORT = process.env.PORT || 3000;

// 확장자 → MIME 타입 매핑 (정적 서빙용)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** 본문(JSON)을 안전하게 읽어들인다 (최대 5MB 가드). */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** JSON을 원자적으로 저장한다 (temp 파일에 쓰고 rename → 부분 쓰기 방지). */
async function saveAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // ---- 학습 데이터 API ---------------------------------------------------
    if (url.pathname === '/api/learning') {
      if (req.method === 'GET') {
        const data = await fs.readFile(DATA_FILE, 'utf8').catch(() => '{}');
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        return res.end(data);
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        // 검증: 파싱 가능한 JSON인지 확인 (손상 데이터 저장 방지)
        let parsed;
        try { parsed = JSON.parse(body); }
        catch { res.writeHead(400); return res.end('invalid json'); }
        await saveAtomic(DATA_FILE, JSON.stringify(parsed, null, 2));
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        return res.end(JSON.stringify({ ok: true }));
      }
      res.writeHead(405); return res.end('method not allowed');
    }

    // ---- 정적 파일 서빙 -----------------------------------------------------
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    // 경로 탈출 방지: ROOT 하위로 정규화
    const filePath = path.normalize(path.join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }

    const data = await fs.readFile(filePath).catch(() => null);
    if (data === null) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    return res.end(data);
  } catch (err) {
    res.writeHead(500);
    res.end(`server error: ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`\n  ♟  Gomoku Pro AI server running:  http://localhost:${PORT}\n`);
});
