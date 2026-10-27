#!/usr/bin/env python3
"""Maison Edel 댓글·DM 받은편지함.

  python3 inbox.py fetch            # 아직 답하지 않은 댓글·DM을 JSON으로 출력
  python3 inbox.py reply-comment <댓글ID> "<답글>"
  python3 inbox.py reply-dm <상대IGSID> "<메시지>"

토큰은 환경 변수 IG_ACCESS_TOKEN에서만 읽는다. 답장은 설화가 노션에서
승인한 초안만 보낸다 (노션 'Maison Edel 작업실' > 댓글·DM 답장 규칙).
"""
import json
import os
import sys
import urllib.parse
import urllib.request

API = "https://graph.instagram.com/v21.0"
TOKEN = os.environ.get("IG_ACCESS_TOKEN", "")
RECENT_POSTS = 10  # 최근 게시물 몇 개의 댓글을 볼지


def call(path, params=None, method="GET"):
    params = dict(params or {}, access_token=TOKEN)
    url = f"{API}/{path}"
    data = None
    if method == "GET":
        url += "?" + urllib.parse.urlencode(params)
    else:
        data = urllib.parse.urlencode(params).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data, method=method)) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"Instagram API 오류 {e.code}: {e.read().decode()}")


def fetch():
    me = call("me", {"fields": "user_id,username"})
    my_name = me["username"]
    out = {"account": my_name, "comments": [], "dms": []}

    media = call("me/media", {"fields": "id,permalink,caption,comments_count", "limit": RECENT_POSTS})
    for m in media.get("data", []):
        if not m.get("comments_count"):
            continue
        comments = call(f"{m['id']}/comments", {
            "fields": "id,text,username,timestamp,replies{username}", "limit": 50})
        for c in comments.get("data", []):
            if c.get("username") == my_name:
                continue
            replied = any(r.get("username") == my_name
                          for r in c.get("replies", {}).get("data", []))
            if not replied:
                out["comments"].append({
                    "id": c["id"], "post": m["permalink"],
                    "post_caption": (m.get("caption") or "")[:60],
                    "from": c.get("username"), "text": c["text"], "time": c["timestamp"]})

    convs = call("me/conversations", {
        "platform": "instagram",
        "fields": "id,updated_time,messages.limit(5){from,to,message,created_time}"})
    for cv in convs.get("data", []):
        msgs = cv.get("messages", {}).get("data", [])
        if not msgs or msgs[0]["from"].get("username") == my_name:
            continue  # 마지막 말이 우리 쪽이면 답할 것 없음
        out["dms"].append({
            "conversation": cv["id"], "from": msgs[0]["from"].get("username"),
            "from_id": msgs[0]["from"]["id"],
            "recent": [{"from": x["from"].get("username"), "text": x.get("message", ""),
                        "time": x["created_time"]} for x in reversed(msgs)]})
    return out


def main():
    if not TOKEN:
        sys.exit("IG_ACCESS_TOKEN이 없어요. 클라우드 환경 설정에 넣어 주세요.")
    cmd = sys.argv[1:] or ["fetch"]
    if cmd[0] == "fetch":
        print(json.dumps(fetch(), ensure_ascii=False, indent=2))
    elif cmd[0] == "reply-comment" and len(cmd) == 3:
        print(call(f"{cmd[1]}/replies", {"message": cmd[2]}, "POST"))
    elif cmd[0] == "reply-dm" and len(cmd) == 3:
        body = {"recipient": json.dumps({"id": cmd[1]}),
                "message": json.dumps({"text": cmd[2]}, ensure_ascii=False)}
        print(call("me/messages", body, "POST"))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
