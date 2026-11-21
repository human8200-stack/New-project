import subprocess, sys, os

V = '/home/user/New-project/company/초안/메종에델-마늘등갈비튀김/영상'
SND = '/home/user/New-project/company/초안/메종에델-마늘등갈비튀김/소리'
A = sys.argv[1]          # assets dir
MODE = sys.argv[2]       # ig | yt
OUTF = sys.argv[3]

CROP32 = 'crop=576:1024:72:256,'  # ③-2: 1.25x, top cut so the mirin dish is out of frame
# (file, start, end, speed, extra_filter, caption_key)
segs = [
    ('No08-01-1-꺼내닦기-v1.mp4', 0.0, 4.0, 1.8, '', None),
    ('No08-01-2-가루묻히기-v1.mp4', 1.6, 4.0, 1.7, '', 'c03'),
    ('No08-02-튀기기-v1.mp4', 0.0, 1.5, 1.8, '', 'c04'),
    ('No08-02-튀기기-v1.mp4', 2.2, 4.0, 1.8, '', 'c05'),
    ('No08-03-1-마늘간장-v1.mp4', 0.0, 1.1, 1.6, '', 'c06'),
    ('No08-03-1-마늘간장-v1.mp4', 2.45, 4.0, 1.6, '', 'c07'),
    ('No08-03-2-굴소스설탕-v1.mp4', 0.0, 1.45, 1.6, CROP32, 'c08'),
    ('No08-03-2-굴소스설탕-v1.mp4', 2.25, 4.0, 1.6, CROP32, 'c09'),
    ('No08-03-버무리기-v1.mp4', 0.0, 2.25, 1.8, '', 'c10'),
    ('No08-03-버무리기-v1.mp4', 2.5, 4.0, 1.8, '', None),
    ('No08-04-땅콩깨뿌리기-v1.mp4', 0.0, 2.15, 1.6, '', 'c11'),
    ('No08-05-먹기-v1.mp4', 0.0, 4.0, 1.7, '', None),
    ('No08-06-맥주-v1.mp4', 0.0, 4.0, 1.7, '', None),
]
CARD = 3.0

times = []
t = 0.0
for s in segs:
    d = (s[2] - s[1]) / s[3]
    times.append((t, t + d))
    t += d
VIDEO_END = t
TOTAL = t + (CARD if MODE == 'ig' else 0)

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
    fc.append(f'[{ci}:v]scale=1080:1920,fps=30,setsar=1,format=yuv420p,fade=in:st=0:d=0.25[card]')
fc.append(''.join(labels) + f'concat=n={len(segs)}:v=1:a=0[vcat]')

# overlays: base (gradient+watermark) over the cooking part only; captions with short fades
ov = []  # (png, t0, t1)
ov.append(('base.png', 0, VIDEO_END))
ov.append(('title.png', 0.0, times[0][1]))
suffix = '-ig' if MODE == 'ig' else '-yt'
ov.append((f'c01{suffix}.png', 0.0, 1.05))
ov.append((f'c02{suffix}.png', 1.05, times[0][1]))
for i, s in enumerate(segs):
    if s[5]:
        ov.append((f'{s[5]}{suffix}.png', times[i][0], times[i][1]))
ov.append(('bon.png', times[-1][1] - 1.35, times[-1][1]))
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
    fc.append(f'{cur}[card]concat=n=2:v=1:a=0[vout]')
else:
    fc.append(f'{cur}null[vout]')

# sounds: (file, ss, dur, at, gain_dB)
T = times
snd = [
    ('1-찰랑-손으로물젓기-bsb0651.mp3', 0.4, 0.6, 0.05, 0),
    ('1-찰랑-물방울-bsb1382.mp3', 0.0, 0.9, 0.30, -10),
    ('1-톡톡-종이만지기-bsb0785.ogg', 0.5, 0.5, 1.65, 8),
    ('1-사각-천속알갱이누르기-bsb2890.mp3', 1.5, T[1][1] - (T[1][0] + 0.5), T[1][0] + 0.5, 2),
    ('2-치이익-튀김기름넣기-bsb2505.mp3', 0.4, T[2][1] - T[2][0], T[2][0], 10),
    ('2-타닥-튀김기름-bsb2507.mp3', 1.2, T[3][1] - T[3][0], T[3][0], 0),
    ('2-치이익-대체-팬지지기-bsb0144.mp3', 0.5, T[4][1] - T[4][0], T[4][0], 0),
    ('2-치이익-대체-팬지지기-bsb0144.mp3', 6.0, T[5][1] - T[5][0], T[5][0], 2),
    ('3-바글바글-대체-끓음-bsb0149.mp3', 1.0, T[6][1] - T[6][0], T[6][0], -3),
    ('3-바글바글-대체-끓음-bsb0149.mp3', 2.6, T[7][1] - T[7][0], T[7][0], -9),
    ('4-사르르-생쌀붓기-bsb0201.mp3', 2.2, T[7][1] - (T[7][0] + 0.22), T[7][0] + 0.22, -10),
    ('3-바글바글-세게끓음-bsb0491.mp3', 0.5, T[8][1] - T[8][0], T[8][0], 4),
    ('3-착착-팬볶기뒤적임-bsb1676.mp3', 9.5, 0.5, T[8][0] + 0.08, 4),
    ('3-바글바글-세게끓음-bsb0491.mp3', 2.0, T[9][1] - T[9][0], T[9][0], -2),
    ('3-착착-팬볶기뒤적임-bsb1676.mp3', 39.0, 0.5, T[9][0] + 0.05, 2),
    ('4-사르르-생쌀붓기-bsb0201.mp3', 1.1, T[10][1] - T[10][0], T[10][0], -12),
    ('5-바삭-대체-러스크씹기-bsb0407.mp3', 4.8, 1.7, T[11][0] + 2.12, 0),
    ('6-잔들기-유리잔손에쥐기-bsb1201.mp3', 2.0, 0.45, T[12][0] + 0.06, 4),
    ('6-거품-맥주따르기-bsb1391.mp3', 6.0, T[12][1] - (T[12][0] + 0.4) + (0.5 if MODE == 'ig' else 0), T[12][0] + 0.4, -2),
]
amix = []
for j, (f, ss, d, at, g) in enumerate(snd):
    ii = addin(['-i', os.path.join(SND, f)])
    fo = min(0.06, d / 3)
    fc.append(f'[{ii}:a]atrim=start={ss}:duration={d:.3f},asetpts=PTS-STARTPTS,aresample=48000,'
              f'aformat=channel_layouts=stereo,afade=in:d=0.02,afade=out:st={d - fo:.3f}:d={fo:.3f},'
              f'volume={g}dB,adelay={int(at * 1000)}|{int(at * 1000)}[a{j}]')
    amix.append(f'[a{j}]')
fc.append(''.join(amix) + f'amix=inputs={len(amix)}:normalize=0:dropout_transition=0,'
          f'apad,atrim=0:{TOTAL:.3f},loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]')

cmd = ['ffmpeg', '-v', 'error', '-y'] + inputs + ['-filter_complex', ';'.join(fc),
       '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'medium',
       '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
       '-movflags', '+faststart', '-t', f'{TOTAL:.3f}', OUTF]
print('cuts', len(segs) + (1 if MODE == 'ig' else 0), 'video_end', round(VIDEO_END, 3), 'total', round(TOTAL, 3))
for i, (a, b) in enumerate(times):
    print(i + 1, round(a, 3), round(b, 3), segs[i][0], segs[i][1], segs[i][2], segs[i][3])
r = subprocess.run(cmd)
sys.exit(r.returncode)
