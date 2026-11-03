# 메종 에델 소개 릴스 만들기 (2판, 2026-11-03, 메종에델팀)
# 크레딧 0원: 이미 만든 영상만 잘라 이어 붙인다. 새 그림·영상·음악 생성 없음.
#
# 쓰는 법
#   python3 -I 소개릴스-만들기.py <작업폴더>
#   - EP.01·EP.02 완성본은 저장소에 없고 노션에만 있다 → 노션에서 받아
#     ME_REF_DIR 폴더에 ep01.mp4, ep02-instagram.mp4 로 둔다.
#   - 글꼴(GowunBatang-Bold, PinyonScript-Regular, CormorantGaramond-MediumItalic)은 ME_FONT_DIR.
#
# 3판에 새 장면 넣는 법 (회장님 결정: 주방 모습 · 햇살 드는 정원 · 그릇 정리)
#   1) 새 영상 파일 경로를 아래 SCENES의 "자리 A/B/C" 줄 file 에 넣는다 (지금은 None = 건너뜀).
#   2) 화면 글은 장면 이름에 묶여 있어서 시간이 저절로 다시 계산된다.
#      자리 A가 들어오면 1줄이 주방~바구니에, 자리 B가 들어오면 4줄이 정원~밥 위에 걸친다.
#   3) 장면당 3초 이하, 장면 사이 0.3초 겹치기는 그대로. 전체 25초를 넘으면 경고를 낸다.
import os, sys, subprocess, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '../../../..'))
V3 = os.path.join(REPO, 'company/초안/메종에델-마약계란/v3/')
REF = os.environ.get('ME_REF_DIR', '/tmp/me-ref/')
FONT = os.environ.get('ME_FONT_DIR', '/tmp/me-fonts/')
WORK = sys.argv[1] if len(sys.argv) > 1 else '/tmp/me-intro'
os.makedirs(WORK + '/ov', exist_ok=True)

W, H, FPS, X = 720, 1280, 24, 0.3          # 1·2편과 같은 크기 · 0.3초 겹치기
GPT = 'eq=gamma=0.66:brightness=-0.04:contrast=1.05:saturation=%s'   # 밝고 노란 GPT 장면 → 1·2편 색
NR = 'highpass=f=120,afftdn=nr=12:nf=-50,'

# 장면 목록 (순서대로). file=None 이면 건너뜀.
# key, 설명, file, 시작초, 원본길이, 속도, 자르기, 색, 소리크기dB, 소리필터
SCENES = [
 dict(key='kitchen', name='자리 A · 주방 모습 (3판에 새 장면)', file=None, start=0, length=2.5, speed=1.0,
      crop=None, grade=GPT % '0.7', gain=8, af=NR),
 dict(key='basket', name='EP.01 바구니', file=REF + 'ep01.mp4', start=0.00, length=2.90, speed=1.0,
      crop='crop=579:1030:70:172', grade='eq=gamma=1.06:saturation=1.1', gain=0, af=''),
 dict(key='garlic', name='EP.02 마늘·양파', file=REF + 'ep02-instagram.mp4', start=3.15, length=2.50, speed=1.0,
      crop='crop=664:1180:28:20', grade='eq=gamma=1.14:saturation=1.3,colorbalance=rm=0.04:bm=-0.04', gain=0, af=''),
 dict(key='scallion', name='EP.03 쪽파 썰기', file=V3 + '장면6-새로-GPT.mp4', start=0.90, length=3.00, speed=1.0,
      crop=None, grade=GPT % '0.74', gain=4, af='highpass=f=120,'),
 dict(key='sauce', name='EP.03 양념 붓고 젓기', file=V3 + '장면6b-새로-GPT.mp4', start=0.70, length=3.00, speed=1.0,
      crop=None, grade=GPT % '0.58', gain=8,
      af=NR + "bandreject=f=250:width_type=q:w=4,volume=enable='between(t,0,0.28)':volume=0.22,"
             "volume=enable='between(t,1.82,2.05)':volume=0.3,"),
 dict(key='spoon', name='EP.03 계란에 양념 끼얹기', file=V3 + '장면7-새로.mp4', start=1.00, length=2.50, speed=1.0,
      crop=None, grade='eq=gamma=1.06:saturation=1.0', gain=10, af='highpass=f=120,afftdn=nr=10:nf=-50,'),
 dict(key='garden', name='자리 B · 햇살 드는 정원 (3판에 새 장면)', file=None, start=0, length=2.5, speed=1.0,
      crop=None, grade=GPT % '0.7', gain=8, af=NR),
 dict(key='rice', name='EP.03 밥 위 계란', file=V3 + '장면8-3판-GPT.mp4', start=0.00, length=2.30, speed=1.0,
      crop=None, grade=GPT % '0.70', gain=12,
      af=NR + 'bandreject=f=240:width_type=q:w=4,bandreject=f=120:width_type=q:w=4,'),
 dict(key='dishes', name='자리 C · 그릇 정리 (3판에 새 장면)', file=None, start=0, length=2.5, speed=1.0,
      crop=None, grade=GPT % '0.7', gain=8, af=NR),
 dict(key='cut', name='EP.03 계란 가르기', file=V3 + '영상-장면1.mp4', start=0.80, length=3.26, speed=1.5,
      crop=None, grade='eq=gamma=1.08:saturation=1.12', gain=8, af=NR + 'bandreject=f=200:width_type=q:w=4,'),
]

# 화면 글: 장면 이름에 묶음 (첫 장면, 끝 장면, 줄들, 그림자 진하기[, 끝 장면 끝에서 몇 초 전에 사라질지 — 기본 0.35])
# 첫 장면이 없으면(자리가 비면) 다음 있는 장면부터 시작.
TEXTS = [
 (['kitchen', 'basket'], 'basket', ['에델은 요리하는 걸', '좋아해요'], 0.7),
 (['garlic'], 'scallion', ['칼끝이 도마에 닿는', '소리를 좋아하고'], 0.7),
 (['sauce'], 'spoon', ['양념이 천천히 스며드는', '시간을 좋아해요'], 1.0),   # 계량컵 위 → 그림자 진하게
 (['garden', 'rice'], 'rice', ['오늘도,', '햇살 드는 부엌에서'], 0.7, 0.0),   # 마지막 겹치기 동안 사라짐 → 읽는 시간 확보
]
ENDING = 'cut'   # 필기체 Maison Edel 이 써지는 장면

def timeline():
    act = [s for s in SCENES if s['file']]
    t = 0; out = []
    for i, s in enumerate(act):
        d = s['length'] / s['speed']
        assert d <= 3.0 + 1e-6, f"{s['name']} 가 3초를 넘음 ({d:.2f})"
        out.append(dict(s, t0=t, t1=t + d, dur=d)); t += d - X
    total = out[-1]['t1']
    if not 15 <= total <= 25: print(f'경고: 전체 {total:.2f}초 (15~25초 밖)')
    return out, total

def build_base(act):
    args = ['ffmpeg', '-v', 'error', '-y']
    for s in act: args += ['-ss', str(s['start']), '-t', str(s['length']), '-i', s['file']]
    fc = []
    for i, s in enumerate(act):
        vf = (s['crop'] + ',' if s['crop'] else '') + \
             f"scale={W}:{H}:flags=lanczos,setsar=1,setpts=(PTS-STARTPTS)/{s['speed']},fps={FPS},{s['grade']},format=yuv420p"
        fc.append(f'[{i}:v]{vf}[v{i}]')
        tempo = f"atempo={s['speed']}," if s['speed'] != 1 else ''
        fc.append(f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,{s['af']}{tempo}"
                  f"volume={s['gain']}dB,apad,atrim=0:{s['dur']:.4f}[a{i}]")
    pv, pa = 'v0', 'a0'
    for i in range(1, len(act)):
        fc.append(f"[{pv}][v{i}]xfade=transition=fade:duration={X}:offset={act[i]['t0']:.4f}[x{i}]"); pv = f'x{i}'
        fc.append(f'[{pa}][a{i}]acrossfade=d={X}:c1=tri:c2=tri[y{i}]'); pa = f'y{i}'
    args += ['-filter_complex', ';'.join(fc), '-map', f'[{pv}]', '-map', f'[{pa}]',
             '-c:v', 'prores_ks', '-profile:v', '2', '-c:a', 'pcm_s16le', WORK + '/base.mov']
    subprocess.run(args, check=True)

def text_times(act):
    by = {s['key']: s for s in act}; res = []
    for firsts, last, lines, shade, *rest in TEXTS:
        first = next(by[k] for k in firsts if k in by)
        res.append((first['t0'] + 0.35, by[last]['t1'] - (rest[0] if rest else 0.35), lines, shade))
    # 장면이 다 보이기 시작한 뒤(겹치기 0.3초 끝 +0.05초)에 나타나고, 끝 장면 겹치기 0.05초 전에 사라짐
    return res

def overlay(act, total):
    KO = ImageFont.truetype(FONT + 'GowunBatang-Bold.ttf', 50)
    PIN = ImageFont.truetype(FONT + 'PinyonScript-Regular.ttf', 95)   # EP.02 Bon appétit 와 같은 크기 (폭 413px)
    WMF = ImageFont.truetype(FONT + 'CormorantGaramond-MediumItalic.ttf', 14)
    CY = 1000                                                          # Bon appétit 높이 (위에서 약 78%)
    def layer(lines, font, lh):
        L = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(L); y0 = CY - lh * len(lines) / 2
        for i, t in enumerate(lines):
            b = d.textbbox((0, 0), t, font=font)
            d.text(((W - (b[2] - b[0])) / 2 - b[0], y0 + i * lh + (lh - (b[3] - b[1])) / 2 - b[1]), t, font=font, fill=(255, 255, 255, 255))
        return L
    def shadow(L, k):
        a = np.array(L)[..., 3]; out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        for blur, amt, dy in ((10, 0.45 * k, 2), (4, 0.75 * k, 2), (1.5, 0.5 * max(0, k - 0.7) / 0.3, 1)):
            if amt <= 0: continue
            s = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            s.putalpha(Image.fromarray(a).filter(ImageFilter.GaussianBlur(blur)).point(lambda v: int(min(255, v * amt))))
            out.alpha_composite(s, (0, dy))
        out.alpha_composite(L); return out
    TT = text_times(act)
    layers = [(s, e, shadow(layer(ls, KO, 66), k)) for s, e, ls, k in TT]
    end = next(s for s in act if s['key'] == ENDING)
    ws = end['t0'] + X + 0.07; wl = 1.0
    me = shadow(layer(['Maison Edel'], PIN, 110), 0.8); ma = np.array(me)
    cols = np.where(ma[..., 3].max(axis=0) > 0)[0]; m0, m1 = cols.min(), cols.max()
    g = np.zeros((H, W, 4), np.uint8); ys = np.arange(H)
    g[..., 3] = (np.clip((ys - H * 0.62) / (H * 0.38), 0, 1) ** 1.2 * 0.46 * 255)[:, None].astype(np.uint8)
    band = Image.fromarray(g, 'RGBA')
    wm = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(wm); t = 'M A I S O N   E D E L'
    b = d.textbbox((0, 0), t, font=WMF); d.text((692 - (b[2] - b[0]) - b[0], 1238 - b[3]), t, font=WMF, fill=(235, 232, 226, 140))
    n = int(round(total * FPS))
    for k in range(n):
        tt = k / FPS; fr = Image.new('RGBA', (W, H), (0, 0, 0, 0)); fr.alpha_composite(band); fr.alpha_composite(wm)
        for s, e, L in layers:
            a = 0 if (tt < s or tt > e) else min(1, (tt - s) / 0.4, (e - tt) / 0.3)
            if a > 0:
                A = np.array(L); A[..., 3] = (A[..., 3] * a).astype(np.uint8); fr.alpha_composite(Image.fromarray(A, 'RGBA'))
        if tt >= ws:
            p = 1 - (1 - min(1, (tt - ws) / wl)) ** 1.6; edge = m0 + (m1 - m0 + 30) * p
            m = np.clip((edge - np.arange(W)) / 30, 0, 1); A = ma.copy(); A[..., 3] = (A[..., 3] * m[None, :]).astype(np.uint8)
            fr.alpha_composite(Image.fromarray(A, 'RGBA'))
        fr.save(WORK + f'/ov/{k:04d}.png', compress_level=1)
    return TT, ws

def encode(out):
    fc = '[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]'
    base = ['ffmpeg', '-v', 'error', '-y', '-i', WORK + '/base.mov', '-framerate', str(FPS), '-i', WORK + '/ov/%04d.png', '-filter_complex', fc, '-map', '[v]']
    vopt = ['-c:v', 'libx264', '-preset', 'slow', '-b:v', '2300k', '-passlogfile', WORK + '/p2']
    subprocess.run(base + ['-an'] + vopt + ['-pass', '1', '-f', 'mp4', '/dev/null'], check=True)
    af = 'acompressor=threshold=0.05:ratio=4:attack=3:release=120,volume=19dB,alimiter=limit=0.55:attack=0.3:release=80:level=false'
    subprocess.run(base + ['-map', '0:a', '-af', af] + vopt + ['-pass', '2', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
                   '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', out], check=True)

if __name__ == '__main__':
    act, total = timeline()
    for f in os.listdir(WORK + '/ov'): os.remove(WORK + '/ov/' + f)
    build_base(act)
    TT, ws = overlay(act, total)
    encode(WORK + '/final.mp4')
    info = dict(total=round(total, 3),
                scenes=[dict(name=s['name'], t0=round(s['t0'], 2), t1=round(s['t1'], 2), src=os.path.basename(s['file']),
                             start=s['start'], end=round(s['start'] + s['length'], 2), speed=s['speed']) for s in act],
                texts=[dict(t0=round(a, 2), t1=round(b, 2), lines=l) for a, b, l, k in TT], ending_write=round(ws, 2))
    json.dump(info, open(WORK + '/timeline.json', 'w'), ensure_ascii=False, indent=1)
    print(json.dumps(info, ensure_ascii=False, indent=1))
