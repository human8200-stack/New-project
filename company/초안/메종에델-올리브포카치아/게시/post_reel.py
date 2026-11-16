# 사용: python3 post_reel.py <게시 시각 UTC, 예 2026-11-17T09:30:00> <영상 공개 주소(커밋 고정 raw 주소)>
# 공개 주소에서 영상(인자)·표지(커밋 42cb4ab 고정)를 가져가 릴스를 올림. AI 정보 라벨 켬. 토큰은 환경 변수만, 출력하지 않음.
import os,sys,json,time,urllib.request,urllib.parse,datetime
T=os.environ['IG_ACCESS_TOKEN']; B='https://graph.instagram.com/v23.0/'
RAW='https://raw.githubusercontent.com/human8200-stack/New-project/42cb4ab88782532aa0c94776ede0a134053364ff/'
q=lambda p: RAW+urllib.parse.quote(p)
VIDEO=sys.argv[2]  # 최종 영상(v10) 공개 주소
COVER=q('company/초안/메종에델-올리브포카치아/게시/No07-표지.jpg')
CAP=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'캡션-인스타.txt')).read().strip()
def call(method,path,**p):
    p['access_token']=T; data=urllib.parse.urlencode(p).encode()
    req=urllib.request.Request(B+path+'?'+data.decode()) if method=='GET' else urllib.request.Request(B+path,data=data,method='POST')
    try: return json.load(urllib.request.urlopen(req,timeout=60))
    except urllib.error.HTTPError as e: return {'err':e.read().decode()[:400].replace(T,'X')}
now=lambda: datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
target=datetime.datetime.fromisoformat(sys.argv[1])
while now()<target-datetime.timedelta(minutes=10): time.sleep(5)
c=call('POST','me/media',media_type='REELS',video_url=VIDEO,cover_url=COVER,caption=CAP,share_to_feed='true',is_ai_generated='true')
print(now().strftime('%T'),'container',c,flush=True); cid=c.get('id')
if not cid: sys.exit(1)
for i in range(60):
    s=call('GET',cid,fields='status_code,status'); print(now().strftime('%T'),s,flush=True)
    if s.get('status_code') in ('FINISHED','ERROR','EXPIRED'): break
    time.sleep(10)
if s.get('status_code')!='FINISHED': sys.exit(2)
while now()<target: time.sleep(1)
r=call('POST','me/media_publish',creation_id=cid); print(now().strftime('%T'),'publish',r,flush=True)
if r.get('id'): print(call('GET',r['id'],fields='id,permalink,timestamp'),flush=True)
