# 사용: python3 post_story.py <사진 공개 주소> <게시 시각 UTC, 예 2026-11-17T09:35:00>  — 사진 스토리, AI 정보 라벨 켬. 토큰 출력 안 함.
import os,sys,json,time,urllib.request,urllib.parse,datetime
T=os.environ['IG_ACCESS_TOKEN']; B='https://graph.instagram.com/v23.0/'
def call(method,path,**p):
    p['access_token']=T; data=urllib.parse.urlencode(p).encode()
    req=urllib.request.Request(B+path+'?'+data.decode()) if method=='GET' else urllib.request.Request(B+path,data=data,method='POST')
    try: return json.load(urllib.request.urlopen(req,timeout=60))
    except urllib.error.HTTPError as e: return {'err':e.read().decode()[:400].replace(T,'X')}
url=sys.argv[1]; target=datetime.datetime.fromisoformat(sys.argv[2])  # UTC, naive
now=lambda: datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
# 2분 전에 그릇(컨테이너)을 만들고, 정각에 게시
while now()<target-datetime.timedelta(minutes=2): time.sleep(5)
c=call('POST','me/media',media_type='STORIES',image_url=url,is_ai_generated='true'); print(now().strftime('%T'),'container',c,flush=True)
cid=c.get('id')
if not cid: sys.exit(1)
for i in range(30):
    s=call('GET',cid,fields='status_code'); print(now().strftime('%T'),s,flush=True)
    if s.get('status_code') in ('FINISHED','ERROR','EXPIRED'): break
    time.sleep(5)
if s.get('status_code')!='FINISHED': sys.exit(2)
while now()<target: time.sleep(1)
r=call('POST','me/media_publish',creation_id=cid); print(now().strftime('%T'),'publish',r,flush=True)
mid=r.get('id')
if mid: print(call('GET',mid,fields='id,media_type,media_product_type,permalink,timestamp'),flush=True)
