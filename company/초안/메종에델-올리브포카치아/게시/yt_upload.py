# 사용: python3 yt_upload.py No07-v10.mp4  — 같은 폴더의 영상·표지·유튜브-제목설명.txt로 쇼츠 예약 업로드(11/17 18:00 서울), 합성 표시 켬, 재생목록 Maison Edel 레시피. YT_* 환경 변수 사용, 값 출력 안 함.
import sys,json,os,urllib.request; sys.path.insert(0,os.path.dirname(__file__)); from yt import *
P='/home/user/New-project/company/초안/메종에델-올리브포카치아/게시/'
txt=open(P+'유튜브-제목설명.txt').read()
title=txt.split('[제목]\n')[1].split('\n')[0].strip()
desc=txt.split('[설명]\n')[1].split('\n\n[태그]')[0].strip()
tags=[x.strip() for x in txt.split('[태그]\n')[1].split('\n')[0].split(',')]
t=token()
body={"snippet":{"title":title,"description":desc,"tags":tags,"categoryId":"26","defaultLanguage":"ko","defaultAudioLanguage":"ko"},
 "status":{"privacyStatus":"private","publishAt":"2026-11-17T09:00:00Z","selfDeclaredMadeForKids":False,"containsSyntheticMedia":True,"license":"youtube","embeddable":True,"publicStatsViewable":True}}
vid=P+(sys.argv[1] if len(sys.argv)>1 else 'No07-v10.mp4'); size=os.path.getsize(vid)
s,h,b=api(t,"POST","https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",body,{"X-Upload-Content-Type":"video/mp4","X-Upload-Content-Length":str(size)})
print('init',s); loc=h.get('Location') or h.get('location')
if not loc: print(b.decode()[:500]); sys.exit(1)
req=urllib.request.Request(loc,data=open(vid,'rb').read(),method='PUT',headers={"Authorization":"Bearer "+t,"Content-Type":"video/mp4"})
r=json.load(urllib.request.urlopen(req,timeout=600)); vid_id=r['id']; print('uploaded',vid_id,r['status'])
s,h,b=api(t,"POST","https://www.googleapis.com/youtube/v3/playlistItems?part=snippet",{"snippet":{"playlistId":"PLfQS0Q_w4Ppw","resourceId":{"kind":"youtube#video","videoId":vid_id}}}); print('playlist',s,b.decode()[:200] if s>=300 else '')
th=open(P+'No07-표지.jpg','rb').read()
req=urllib.request.Request("https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId="+vid_id,data=th,method='POST',headers={"Authorization":"Bearer "+t,"Content-Type":"image/jpeg"})
try: print('thumb',urllib.request.urlopen(req).status)
except urllib.error.HTTPError as e: print('thumb err',e.code,e.read().decode()[:300])
