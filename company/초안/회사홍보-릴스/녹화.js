// 릴스-장면.html 을 1초 30장씩 찍어 mp4로 묶는다 (소리 없음).
// 쓰는 법: node 녹화.js   (playwright, ffmpeg 필요)
// 결과: 릴스-미리보기.mp4, 릴스-장면들.jpg (6컷 모음)
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const DIR = __dirname;
const FPS = 30, SEC = 31.5, W = 1080, H = 1920;
const CRF = process.env.CRF || '20';
const SHOTS = [2.8, 0, 7.6, 11.8, 16.6, 25.5, 30.0]; // 대표 컷 6장: 쪽지·조직도·레시피·사람 챙기기(손글씨)·예고·식탁 (두 번째 값은 안 씀)

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const url = 'file://' + path.join(DIR, '릴스-장면.html') + '?record';
  await page.goto(url);
  await page.evaluate(() => window.__ready); // 글꼴을 읽고 자막 폭까지 맞춘 뒤
  const ok = await page.evaluate(() => document.fonts.check('800 40px Pretendard') && document.fonts.check('500 40px Pretendard'));
  if (!ok) throw new Error('글꼴을 못 읽음');
  const stage = await page.$('#stage');

  const out = path.join(DIR, '릴스-미리보기.mp4');
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', '-an', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });

  const total = Math.round(FPS * SEC);
  for (let f = 0; f < total; f++) {
    await page.evaluate((ms) => window.seek(ms), (f * 1000) / FPS);
    const buf = await stage.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (f % 150 === 0) console.log('찍는 중', f, '/', total);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));

  // 6컷 모음
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'reel-'));
  const picks = [SHOTS[0], ...SHOTS.slice(2)];
  const files = [];
  for (let i = 0; i < picks.length; i++) {
    await page.evaluate((ms) => window.seek(ms), picks[i] * 1000);
    const p = path.join(tmp, `c${i}.png`);
    await stage.screenshot({ path: p });
    files.push(p);
  }
  await browser.close();
  const args = ['-y', '-loglevel', 'error'];
  files.forEach((f) => args.push('-i', f));
  const fc = files.map((_, i) => `[${i}:v]scale=360:640[v${i}]`).join(';') + ';' +
    files.map((_, i) => `[v${i}]`).join('') + `xstack=inputs=6:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0[o]`;
  args.push('-filter_complex', fc, '-map', '[o]', '-q:v', '3', path.join(DIR, '릴스-장면들.jpg'));
  execFileSync('ffmpeg', args);
  console.log('끝:', out, (fs.statSync(out).size / 1e6).toFixed(1) + 'MB');
})();
