# 메종 에델 소개 릴스 기록용 스크립트 (2026-11-03). 경로는 그때 작업 공간 기준이라 다시 쓰려면 고쳐야 함.
import subprocess
V='/home/user/New-project/company/초안/메종에델-마약계란/v3/'
R='/tmp/claude-0/-home-user/020f0925-2716-5554-b1a3-06e5bb251207/scratchpad/ref/'
OUT='/tmp/claude-0/-home-user/020f0925-2716-5554-b1a3-06e5bb251207/scratchpad/work/base.mov'
GPT='eq=gamma=0.66:brightness=-0.04:contrast=1.05:saturation=%s'
# file, start, src_len, speed, crop, grade, gain_db, extra_af
C=[
 (R+'ep01.mp4',0.00,2.90,1.0,'crop=579:1030:70:172','eq=gamma=1.06:saturation=1.1',0,''),
 (R+'ep02-instagram.mp4',3.15,2.50,1.0,'crop=664:1180:28:20','eq=gamma=1.14:saturation=1.3,colorbalance=rm=0.04:bm=-0.04',0,''),
 (V+'장면6-새로-GPT.mp4',0.40,2.50,1.0,None,GPT%'0.74',4,'highpass=f=120,'),
 (V+'영상-장면5.mp4',0.00,4.06,2.0,None,'eq=gamma=1.05:saturation=1.05',12,'highpass=f=120,afftdn=nr=10:nf=-50,'),
 (V+'장면6b-새로-GPT.mp4',0.00,2.50,1.0,None,GPT%'0.58',8,"highpass=f=120,afftdn=nr=12:nf=-50,bandreject=f=250:width_type=q:w=4,volume=enable='between(t,0.55,0.95)':volume=0.22,"),
 (V+'장면7-새로.mp4',1.00,2.50,1.0,None,'eq=gamma=1.06:saturation=1.0',10,'highpass=f=120,afftdn=nr=10:nf=-50,'),
 (V+'장면8-3판-GPT.mp4',0.00,2.30,1.0,None,GPT%'0.70',12,'highpass=f=120,afftdn=nr=12:nf=-50,bandreject=f=240:width_type=q:w=4,bandreject=f=120:width_type=q:w=4,'),
 (V+'영상-장면1.mp4',0.30,3.76,1.5,None,'eq=gamma=1.08:saturation=1.12',8,'highpass=f=120,afftdn=nr=12:nf=-50,bandreject=f=200:width_type=q:w=4,'),
]
X=0.3
args=['ffmpeg','-v','error','-y']
for f,s,l,sp,cr,g,gain,af in C:
    args+=['-ss',str(s),'-t',str(l),'-i',f]
fc=[];durs=[]
for i,(f,s,l,sp,cr,g,gain,af) in enumerate(C):
    vf=(cr+',' if cr else '')+f'scale=720:1280:flags=lanczos,setsar=1,setpts=(PTS-STARTPTS)/{sp},fps=24,{g},format=yuv420p'
    fc.append(f'[{i}:v]{vf}[v{i}]')
    tempo=f'atempo={sp},' if sp!=1 else ''
    fc.append(f'[{i}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,{af}{tempo}volume={gain}dB,apad,atrim=0:{l/sp:.4f}[a{i}]')
    durs.append(l/sp)
prev='v0';off=0;aprev='a0'
for i in range(1,len(C)):
    off+=durs[i-1]-X if i==1 else durs[i-1]-X
    fc.append(f'[{prev}][v{i}]xfade=transition=fade:duration={X}:offset={sum(durs[:i])-X*i:.4f}[x{i}]'); prev=f'x{i}'
    fc.append(f'[{aprev}][a{i}]acrossfade=d={X}:c1=tri:c2=tri[y{i}]'); aprev=f'y{i}'
args+=['-filter_complex',';'.join(fc),'-map',f'[{prev}]','-map',f'[{aprev}]','-c:v','prores_ks','-profile:v','2','-c:a','pcm_s16le',OUT]
subprocess.run(args,check=True)
t=0
for i,d in enumerate(durs):
    st=sum(durs[:i])-X*i; print(i+1,f'start {st:.2f} end {st+d:.2f} dur {d:.2f}')
print('total',sum(durs)-X*(len(durs)-1))
