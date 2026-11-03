# 메종 에델 소개 릴스 기록용 스크립트 (2026-11-03). 경로는 그때 작업 공간 기준이라 다시 쓰려면 고쳐야 함.
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np, os
S='/tmp/claude-0/-home-user/020f0925-2716-5554-b1a3-06e5bb251207/scratchpad/'
W,H,FPS,DUR=720,1280,24,17.636
KO=ImageFont.truetype(S+'ref/GowunBatang-Bold.ttf',50)
PIN=ImageFont.truetype(S+'ref/PinyonScript-Regular.ttf',95)
WMF=ImageFont.truetype(S+'ref/CormorantGaramond-MediumItalic.ttf',14)
CENTER_Y=1000  # EP.02 Bon appetit ink centre 988 (938~1037), ~78%
LINES=[ # (start, end, lines)
 (0.35,2.55,['에델은 요리하는 걸','좋아해요']),
 (2.95,6.95,['칼끝이 도마에 닿는','소리를 좋아하고']),
 (9.05,12.95,['양념이 천천히 스며드는','시간을 좋아해요']),
 (13.35,15.20,['오늘도,','햇살 드는 부엌에서']),
]
FADE_IN,FADE_OUT=0.4,0.3
WRITE_START,WRITE_LEN=15.5,1.0
def text_layer(lines,font,lh):
    L=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(L)
    total=lh*len(lines); y0=CENTER_Y-total/2
    for i,t in enumerate(lines):
        b=d.textbbox((0,0),t,font=font); w=b[2]-b[0]; h=b[3]-b[1]
        d.text(((W-w)/2-b[0], y0+i*lh+(lh-h)/2-b[1]),t,font=font,fill=(255,255,255,255))
    return L
def with_shadow(L):
    a=np.array(L)[...,3]
    sh=Image.fromarray(a).filter(ImageFilter.GaussianBlur(4))
    shadow=Image.new('RGBA',(W,H),(0,0,0,0)); shadow.putalpha(sh.point(lambda v:int(v*0.7)))
    out=Image.new('RGBA',(W,H),(0,0,0,0)); out.alpha_composite(shadow,(0,2)); out.alpha_composite(L); return out
layers=[(s,e,with_shadow(text_layer(ls,KO,66))) for s,e,ls in LINES]
me=with_shadow(text_layer(['Maison Edel'],PIN,110))
ma=np.array(me)[...,3]; cols=np.where(ma.max(axis=0)>0)[0]; MX0,MX1=cols.min(),cols.max()
# gradient band (bottom) + watermark
g=np.zeros((H,W,4),np.uint8); ys=np.arange(H)
alpha=np.clip((ys-H*0.62)/(H*0.38),0,1)**1.2*0.46*255
g[...,3]=alpha[:,None].astype(np.uint8)
band=Image.fromarray(g,'RGBA')
wm=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(wm)
t='M A I S O N   E D E L'; b=d.textbbox((0,0),t,font=WMF)
d.text((692-(b[2]-b[0])-b[0],1238-b[3]),t,font=WMF,fill=(235,232,226,140))
def env(t,s,e):
    if t<s or t>e: return 0
    return min(1,(t-s)/FADE_IN,(e-t)/FADE_OUT)
n=int(round(DUR*FPS))
for k in range(n):
    t=k/FPS
    fr=Image.new('RGBA',(W,H),(0,0,0,0)); fr.alpha_composite(band); fr.alpha_composite(wm)
    for s,e,L in layers:
        a=env(t,s,e)
        if a>0:
            A=L.copy(); A.putalpha(Image.fromarray((np.array(L)[...,3]*a).astype(np.uint8))); fr.alpha_composite(A)
    if t>=WRITE_START:
        p=min(1,(t-WRITE_START)/WRITE_LEN); p=1-(1-p)**1.6
        edge=MX0+(MX1-MX0+30)*p
        x=np.arange(W); m=np.clip((edge-x)/30,0,1)
        A=me.copy(); arr=np.array(me); arr[...,3]=(arr[...,3]*m[None,:]).astype(np.uint8); fr.alpha_composite(Image.fromarray(arr,'RGBA'))
    fr.save(S+f'work/ov/{k:04d}.png',compress_level=1)
print(n,'frames; ME x',MX0,MX1)
