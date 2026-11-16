import os, json, urllib.request, urllib.parse, sys
def token():
    d=urllib.parse.urlencode({"client_id":os.environ["YT_CLIENT_ID"],"client_secret":os.environ["YT_CLIENT_SECRET"],"refresh_token":os.environ["YT_REFRESH_TOKEN"],"grant_type":"refresh_token"}).encode()
    r=json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token",d))
    return r["access_token"]
def api(tok,method,url,body=None,headers=None):
    h={"Authorization":"Bearer "+tok}
    if headers: h.update(headers)
    data=None
    if body is not None:
        data=json.dumps(body).encode(); h["Content-Type"]="application/json; charset=UTF-8"
    req=urllib.request.Request(url,data=data,headers=h,method=method)
    try:
        resp=urllib.request.urlopen(req); return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()
