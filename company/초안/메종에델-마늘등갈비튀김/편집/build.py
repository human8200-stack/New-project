import subprocess, sys, os

V = '/home/user/New-project/company/초안/메종에델-마늘등갈비튀김/영상'
SND = '/home/user/New-project/company/초안/메종에델-마늘등갈비튀김/소리'
A = sys.argv[1]          # assets dir
MODE = sys.argv[2]       # ig | yt
OUTF = sys.argv[3]

CROP32 = 'crop=576:1024:72:256,'  # ③-2: 1.25x, top cut so the mirin dish is out of frame
# (file, start, end, speed, extra_filter, caption_key)
M = 1.3  # one speed for every cut (회장님 11/21 "전체적으로 빨라지면 안되지")
segs = [
    # windows skip: sudden hand bursts, freezes, one-frame jumps, top-edge cut-offs
    ('No08-01-1-꺼내닦기-v1.mp4', 0.0, 1.25, M, '', 'c01'),
    ('No08-01-1-꺼내닦기-v1.mp4', 2.3, 2.95, M, '', 'c02'),
    ('No08-01-2-가루묻히기-v1.mp4', 1.7, 3.75, M, '', 'c03'),
    ('No08-02-튀기기-v1.mp4', 0.0, 0.95, M, '', 'c04'),
    ('No08-02-튀기기-v1.mp4', 2.6, 3.6, M, '', 'c05'),
    ('No08-03-1-마늘간장-v1.mp4', 0.0, 1.1, M, '', 'c06'),
    ('No08-03-1-마늘간장-v1.mp4', 2.45, 4.0, M, '', 'c07'),
    ('No08-03-2-굴소스설탕-v1.mp4', 0.0, 1.2, M, CROP32, 'c08'),
    ('No08-03-2-굴소스설탕-v1.mp4', 2.6, 4.0, M, CROP32, 'c09'),
    ('No08-03-버무리기-v1.mp4', 0.0, 2.2, M, '', 'c10'),
    ('No08-03-버무리기-v1.mp4', 2.5, 3.75, M, '', None),
    ('No08-04-땅콩깨뿌리기-v1.mp4', 0.0, 2.15, M, '', 'c11'),
    ('No08-05-먹기-v1.mp4', 0.0, 3.15, 1.8, '', None),  # 회장님 11/22 "음식이 올라갈때 슬로우 모드인겅 좀 빠르게" — lift only
    ('No08-06-맥주-v1.mp4', 0.0, 2.35, M, '', None),
]
CARD = 4.0

times = []
t = 0.0
for s in segs:
    d = (s[2] - s[1]) / s[3]
    times.append((t, t + d))
    t += d
VIDEO_END = t
XF = 0.2  # crossfade into the card (no black frame)
TAIL = 0.8  # youtube: last cut fades out while still moving (0.4s), then 0.8s black — no frozen frame
TOTAL = t + ((CARD - XF) if MODE == 'ig' else TAIL)

inputs = []
NIN = [0]
fc = []
def addin(args):
    i = NIN[0]
    inputs.extend(args)
    NIN[0] += 1
    return i

vids = sorted(set(s[0] for s in segs))
vidx = {}
for f in vids:
    vidx[f] = addin(['-i', os.path.join(V, f)])
labels = []
for i, (f, st, en, sp, ex, _) in enumerate(segs):
    fc.append(f'[{vidx[f]}:v]trim=start={st}:end={en},setpts=(PTS-STARTPTS)/{sp},{ex}'
              f'scale=1080:1920:flags=lanczos,fps=30,eq=saturation=0.94,setsar=1,format=yuv420p[s{i}]')
    labels.append(f'[s{i}]')
if MODE == 'ig':
    ci = addin(['-loop', '1', '-t', str(CARD), '-i', os.path.join(A, 'card.png')])
    fc.append(f'[{ci}:v]scale=1080:1920,fps=30,setsar=1,format=yuv420p,settb=1/30[card]')
fc.append(''.join(labels) + f'concat=n={len(segs)}:v=1:a=0[vcat]')

# overlays: base (gradient+watermark) over the cooking part only; captions with short fades
ov = []  # (png, t0, t1)
ov.append(('base.png', 0, VIDEO_END))
ov.append(('title.png', 0.0, times[1][1]))
suffix = '-ig' if MODE == 'ig' else '-yt'
for i, s in enumerate(segs):
    if s[5]:
        ov.append((f'{s[5]}{suffix}.png', times[i][0], times[i][1]))
ov.append(('bon.png', max(times[-1][0] + 0.1, times[-1][1] - 1.35), times[-1][1]))
cur = '[vcat]'
for k, (png, t0, t1) in enumerate(ov):
    ii = addin(['-loop', '1', '-t', f'{VIDEO_END:.3f}', '-i', os.path.join(A, png)])
    fd = 0.12 if png not in ('base.png', 'bon.png') else (0 if png == 'base.png' else 0.35)
    fil = f'[{ii}:v]format=rgba'
    if fd:
        fil += f',fade=in:st={t0:.3f}:d={fd}:alpha=1'
        if png != 'bon.png':
            fil += f',fade=out:st={t1 - fd:.3f}:d={fd}:alpha=1'
    fc.append(fil + f'[o{k}]')
    fc.append(f'{cur}[o{k}]overlay=0:0:enable=\'between(t,{t0:.3f},{t1:.3f})\'[v{k}]')
    cur = f'[v{k}]'
if MODE == 'ig':
    fc.append(f'{cur}fps=30,settb=1/30[vmain]')
    fc.append(f'[vmain][card]xfade=transition=fade:duration={XF}:offset={VIDEO_END - XF:.3f}[vout]')
else:
    fc.append(f'{cur}fade=t=out:st={VIDEO_END - 0.4:.3f}:d=0.4,tpad=stop_mode=add:stop_duration={TAIL}:color=black[vout]')

# sounds (11/22 회장님 "그리고 음식 소리들 좀 더 자연스럽게 안되나?"):
#   (file, ss, dur, at, role, dist) — gain is computed so each role sits at one level (main/bed/hit),
#   dist: near = hand-close (bright, dry) / far = top-down wok (darker, a little more room)
T = times
BITE = T[12][1]  # 0407 crunch (transient at 5.3s) lands on the last frame before the rib reaches the top edge
def C(i, src):  # frame-exact: source-second inside cut i -> timeline second
    return T[i][0] + (src - segs[i][1]) / segs[i][2]
def D(i, start):
    return T[i][1] - start
snd = [
    # ① 꺼내 닦기 (hand-close)
    ('1-찰랑-손으로물젓기-bsb0651.mp3', 0.4, 0.6, T[0][0] + 0.03, 'main', 'near'),
    ('1-찰랑-물방울-bsb1382.mp3', 0.0, D(0, T[0][0] + 0.2), T[0][0] + 0.2, 'bed', 'near'),
    ('1-톡톡-종이만지기-bsb0785.ogg', 1.25, D(1, T[1][0]), T[1][0], 'main', 'near'),
    ('1-사각-천속알갱이누르기-bsb2890.mp3', 1.5, D(2, T[2][0]), T[2][0], 'main', 'near'),
    # ② 튀기기: the rib is already entering the oil on the first frame -> 치익 from frame 0
    ('2-치이익-튀김기름넣기-bsb2505.mp3', 0.4, D(3, T[3][0]), T[3][0], 'main', 'far'),
    ('2-타닥-튀김기름-bsb2507.mp3', 3.0, D(3, T[3][0]), T[3][0], 'bed', 'far'),
    ('2-타닥-튀김기름-bsb2507.mp3', 1.2, D(4, T[4][0]), T[4][0], 'main', 'far'),
    # ③-1 마늘·간장: garlic / soy already touching the wok on the first frame of each cut -> 지글 from frame 0
    ('2-치이익-대체-팬지지기-bsb0144.mp3', 0.5, D(5, T[5][0]), T[5][0], 'main', 'far'),
    ('2-치이익-대체-팬지지기-bsb0144.mp3', 6.0, D(6, T[6][0]), T[6][0], 'main', 'far'),
    # ③-2 굴소스·설탕: oyster sauce dripping in from frame 0 -> 보글; sugar first hits the sauce at src 2.85s -> 사르르
    ('3-바글바글-대체-끓음-bsb0149.mp3', 1.0, D(7, T[7][0]), T[7][0], 'main', 'far'),
    ('3-바글바글-대체-끓음-bsb0149.mp3', 2.6, D(8, T[8][0]), T[8][0], 'bed', 'far'),
    ('4-사르르-생쌀붓기-bsb0201.mp3', 2.2, D(8, C(8, 2.85)), C(8, 2.85), 'main', 'far'),
    # ③ 버무리기: spatula touches the wok at src 0.00s and again at 1.55s (cut 10), at 2.50s (cut 11) -> 착 (hits at 9.55/25.35/39.45s)
    ('3-바글바글-세게끓음-bsb0491.mp3', 0.5, D(9, T[9][0]), T[9][0], 'bed', 'far'),
    ('3-착착-팬볶기뒤적임-bsb1676.mp3', 9.53, 0.45, C(9, 0.0), 'hit', 'far'),
    ('3-착착-팬볶기뒤적임-bsb1676.mp3', 25.3, 0.4, C(9, 1.55) - 0.05, 'hit', 'far'),
    ('3-바글바글-세게끓음-bsb0491.mp3', 2.3, D(10, T[10][0]), T[10][0], 'bed', 'far'),
    ('3-착착-팬볶기뒤적임-bsb1676.mp3', 39.43, 0.45, C(10, 2.5), 'hit', 'far'),
    # ④ 땅콩: first peanuts land on the plate at src 0.10s -> 사르르 (a part of 0201 not used in ③-2)
    ('4-사르르-생쌀붓기-bsb0201.mp3', 6.0, D(11, C(11, 0.1)), C(11, 0.1), 'main', 'near'),
    # ⑤ 먹기 (1.8x lift): small pick-up tap, faint room, bite right before the rib reaches the top edge
    ('4-톡-작은접시놓기-bsb1190.mp3', 4.0, 0.4, T[12][0] + 0.03, 'bed', 'near'),
    ('3-착착-팬볶기뒤적임-bsb1676.mp3', 0.0, BITE - 0.3 - T[12][0] + 0.05, T[12][0], 'bed', 'near'),
    ('5-바삭-대체-러스크씹기-bsb0407.mp3', 5.0, 0.42, BITE - 0.3, 'hit', 'near'),
    # ⑥ 맥주 (kept until the new pictures come): glass + faint foam only
    ('6-잔들기-유리잔손에쥐기-bsb1201.mp3', 2.0, 0.45, T[13][0] + 0.03, 'main', 'near'),
    ('6-거품-맥주따르기-bsb1391.mp3', 6.0, D(13, T[13][0] + 0.3) + (0.5 if MODE == 'ig' else 0.6), T[13][0] + 0.3, 'bed', 'near'),
]
if MODE == 'ig':
    # card: a later, unused part of the foam keeps fizzing softly under the recipe card
    snd.append(('6-거품-맥주따르기-bsb1391.mp3', 9.0, TOTAL - VIDEO_END - 0.2, VIDEO_END + 0.1, 'card', 'near'))

# one level per role (RMS for main/bed, peak for hits), so no sound jumps out louder or quieter than the rest
LEVEL = {'main': -24.0, 'bed': -33.0, 'card': -38.0}
HIT_PEAK = -5.0
def measure(f, ss, d):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(ss), '-t', f'{d:.3f}', '-i', os.path.join(SND, f),
                          '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], capture_output=True).stdout
    import array, math
    x = array.array('f'); x.frombytes(raw)
    rms = math.sqrt(sum(v * v for v in x) / max(1, len(x)))
    pk = max((abs(v) for v in x), default=0)
    return 20 * math.log10(rms + 1e-9), 20 * math.log10(pk + 1e-9)
# room = same kitchen for every sound: short early reflections + one shared tone curve
NEAR = 'highpass=f=90,lowpass=f=11000,aecho=1.0:0.92:11|19:0.10|0.06'
FAR = 'highpass=f=110,lowpass=f=6500,equalizer=f=3000:t=q:w=1:g=-2,aecho=1.0:0.88:17|29|41:0.18|0.12|0.07'
spread = []
amix = []
for j, (f, ss, d, at, role, dist) in enumerate(snd):
    rms, pk = measure(f, ss, d)
    g = (HIT_PEAK - pk) if role == 'hit' else min(LEVEL[role] - rms, -3.0 - pk)
    if dist == 'far':
        g -= 2.0  # a step further away than the hands
    spread.append((f[:14], round(rms + g, 1), round(pk + g, 1)))
    ii = addin(['-i', os.path.join(SND, f)])
    fo = min(0.025, d / 3)  # 15–30 ms soft edges, sound still stops with the cut
    fc.append(f'[{ii}:a]atrim=start={ss}:duration={d:.3f},asetpts=PTS-STARTPTS,aresample=48000,'
              f'aformat=channel_layouts=stereo,afade=in:d=0.02,afade=out:st={d - fo:.3f}:d={fo:.3f},'
              f'volume={g:.2f}dB,{NEAR if dist == "near" else FAR},adelay={int(round(at * 1000))}|{int(round(at * 1000))}[a{j}]')
    amix.append(f'[a{j}]')
fc.append(''.join(amix) + f'amix=inputs={len(amix)}:normalize=0:dropout_transition=0,'
          f'equalizer=f=250:t=q:w=1:g=1,equalizer=f=8000:t=q:w=1:g=-1.5,'
          f'apad,atrim=0:{TOTAL:.3f},aresample=48000[aout]')
for z in spread:
    print('lvl', *z)

cmd = ['ffmpeg', '-v', 'error', '-y'] + inputs + ['-filter_complex', ';'.join(fc),
       '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium',
       '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
       '-movflags', '+faststart', '-t', f'{TOTAL:.3f}', OUTF]
print('cuts', len(segs) + (1 if MODE == 'ig' else 0), 'video_end', round(VIDEO_END, 3), 'total', round(TOTAL, 3))
for i, (a, b) in enumerate(times):
    print(i + 1, round(a, 3), round(b, 3), segs[i][0], segs[i][1], segs[i][2], segs[i][3])
r = subprocess.run(cmd)
sys.exit(r.returncode)
