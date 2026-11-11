#!/usr/bin/env python3
"""건강 책 2장 원고 -> 휴대폰에서 넘겨 보는 책(HTML 한 파일).

쓰는 법:  python3 build_book.py
- 읽는 것: 같은 폴더의 2-1.md ~ 2-11.md, 2-관계도.md (각 파일 "## 편집팀 메모" 위만)
           ../건강책-차례-보기용.md (책 제목, 2장 제목·핵심 문장·쪽 번호)
- 만드는 것: 같은 폴더의 book-2장.html (claude.ai 아티팩트로 그대로 게시)
원고가 고쳐지면 이 스크립트만 다시 돌리면 된다. HTML을 손으로 고치지 않는다.
쪽 나누기는 브라우저에서 글 높이를 직접 재서 한다(넘쳐서 잘리는 글 없음).
"""
import html
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOC_FILE = os.path.join(HERE, "..", "건강책-차례-보기용.md")
OUT_FILE = os.path.join(HERE, "book-2장.html")
MEMO_MARK = "## 편집팀 메모"
KV_HEAD = ["확인된 것", "아직 모르는 것", "흔한 오해"]


# ---------------------------------------------------------------- 읽기
def read_body(path):
    """'## 편집팀 메모' 위의 줄만 돌려준다."""
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    out = []
    for ln in lines:
        if ln.strip().startswith(MEMO_MARK):
            break
        out.append(ln.rstrip())
    while out and out[-1].strip() in ("", "---"):
        out.pop()
    return out


def read_toc():
    """차례 파일에서 책 제목, 부제, 2장 제목·핵심 문장·꼭지 목록을 읽는다."""
    with open(TOC_FILE, encoding="utf-8") as f:
        lines = f.read().splitlines()
    info = {"book": "", "subtitle": "", "chapter": "", "chapter_page": None,
            "key": "", "items": []}
    for ln in lines:
        if ln.startswith("# ") and not info["book"]:
            info["book"] = ln[2:].strip()
        elif ln.startswith("### ") and not info["subtitle"] and not info["chapter"]:
            info["subtitle"] = ln[4:].strip()
    start = None
    for i, ln in enumerate(lines):
        if re.match(r"^###\s+2장\.", ln):
            start = i
            break
    if start is None:
        sys.exit("차례 파일에서 '### 2장.' 줄을 못 찾았습니다.")
    m = re.match(r"^###\s+2장\.\s*(.+?)\s*···\s*(\d+)\s*$", lines[start])
    info["chapter"] = m.group(1) if m else lines[start][4:].strip()
    info["chapter_page"] = int(m.group(2)) if m else 27
    for ln in lines[start + 1:]:
        if ln.startswith("### ") or ln.startswith("## ") or ln.strip() == "---":
            break
        s = ln.strip()
        if s.startswith("**") and s.endswith("**") and not info["key"]:
            info["key"] = s.strip("*").strip()
            continue
        mi = re.match(r"^-\s+(?:(2-\d+)\s+)?(.+?)\s*···\s*(\d+)\s*$", s)
        if mi:
            info["items"].append({"id": mi.group(1), "title": mi.group(2),
                                  "page": int(mi.group(3))})
    return info


# ---------------------------------------------------------------- 글자 변환
def inline(text):
    """**굵게** 정도만 바꾼다. 나머지는 그대로(이스케이프)."""
    t = html.escape(text, quote=False)
    t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", t)
    return t


def spans(lines):
    """한 문단의 줄(대개 한 줄 = 한 문장)을 나눌 수 있는 조각(span)으로."""
    return "".join('<span class="u">%s </span>' % inline(l.strip()) for l in lines if l.strip())


def para(lines, cls="para"):
    return '<p class="%s" data-split="soft" data-units>%s</p>' % (cls, spans(lines))


def table_cells(row):
    row = row.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|"):
        row = row[:-1]
    return [c.strip() for c in row.split("|")]


def render_table(rows):
    head = table_cells(rows[0])
    body = [table_cells(r) for r in rows[1:] if not re.match(r"^\|?\s*:?-{2,}", r.strip())]
    if head == KV_HEAD:
        out = []
        for ci, name in enumerate(KV_HEAD):
            items = [r[ci] for r in body if ci < len(r) and r[ci]]
            if not items:
                continue
            lis = "".join("<li>%s</li>" % inline(x) for x in items)
            out.append('<div class="kv kv%d" data-split="soft"><div class="kv-lab">%s</div>'
                       '<ul data-units>%s</ul></div>' % (ci + 1, html.escape(name), lis))
        return "".join(out)
    # 보통 표(지금 원고에는 없지만 대비)
    th = "".join("<th>%s</th>" % inline(c) for c in head)
    trs = "".join("<tr>%s</tr>" % "".join("<td>%s</td>" % inline(c) for c in r) for r in body)
    return '<table class="tbl" data-split="hard"><thead><tr>%s</tr></thead><tbody data-units>%s</tbody></table>' % (th, trs)


def render_list(items, ordered):
    tag = "ol" if ordered else "ul"
    lis = "".join("<li>%s</li>" % inline(x) for x in items)
    return '<%s class="lst" data-split="soft" data-units>%s</%s>' % (tag, lis, tag)


def chunks(lines):
    """빈 줄로 나눈 덩어리. 단, 표·목록·인용은 덩어리 안에서 다시 가른다."""
    cur = []
    for ln in lines:
        if ln.strip() == "":
            if cur:
                yield cur
                cur = []
        else:
            cur.append(ln)
    if cur:
        yield cur


def render_chunk(ch):
    """덩어리 하나(빈 줄 사이)를 블록 HTML 목록으로."""
    out = []
    i = 0
    n = len(ch)
    while i < n:
        s = ch[i].strip()
        if s == "---":
            i += 1
            continue
        if s.startswith("### "):
            out.append('<h3 class="h3" data-keep>%s</h3>' % inline(s[4:]))
            i += 1
            continue
        if s == "[회장님 이야기]":
            out.append('<div class="story">회장님 이야기가 들어갈 자리</div>')
            i += 1
            continue
        if s.startswith("|"):
            rows = []
            while i < n and ch[i].strip().startswith("|"):
                rows.append(ch[i])
                i += 1
            out.append(render_table(rows))
            continue
        if s.startswith(">"):
            q = []
            while i < n and ch[i].strip().startswith(">"):
                q.append(re.sub(r"^\s*>\s?", "", ch[i]))
                i += 1
            out.append(render_quote(q))
            continue
        if re.match(r"^\d+\.\s", s):
            items = []
            while i < n and re.match(r"^\s*\d+\.\s", ch[i]):
                items.append(re.sub(r"^\s*\d+\.\s+", "", ch[i]))
                i += 1
            out.append(render_list(items, True))
            continue
        if s.startswith("- "):
            items = []
            while i < n and ch[i].strip().startswith("- "):
                items.append(ch[i].strip()[2:])
                i += 1
            out.append(render_list(items, False))
            continue
        if s.startswith("**핵심 한 줄**"):
            rest = [l for l in ch[i + 1:]]
            out.append('<div class="key" data-split="hard"><div class="key-lab">핵심 한 줄</div>'
                       '<p data-units><mark class="mk">%s</mark></p></div>'
                       % " ".join(inline(l.strip()) for l in rest))
            break
        m = re.match(r"^(함께 읽으면 좋은 꼭지|영양소 카드 찾기)\s*:\s*(.*)$", s)
        if m:
            out.append('<p class="see"><b>%s</b> %s</p>' % (html.escape(m.group(1)), inline(m.group(2))))
            i += 1
            continue
        # 보통 문단: 다음 특수 줄 전까지
        pl = []
        while i < n:
            t = ch[i].strip()
            if (t.startswith(("### ", "|", ">", "- ", "**핵심 한 줄**")) or t == "[회장님 이야기]"
                    or re.match(r"^\d+\.\s", t) or t == "---"
                    or re.match(r"^(함께 읽으면 좋은 꼭지|영양소 카드 찾기)\s*:", t)):
                break
            pl.append(ch[i])
            i += 1
        if len(pl) == 1 and re.fullmatch(r"\*\*[^*]+\*\*", pl[0].strip()):
            out.append('<p class="emph">%s</p>' % inline(pl[0].strip()))
        else:
            out.append(para(pl))
    return out


def render_quote(q):
    first = q[0].strip() if q else ""
    m = re.match(r"^\*\*그림 상자\*\*\s*[—-]\s*(.*)$", first)
    if m:
        desc = " ".join([m.group(1)] + [l.strip() for l in q[1:] if l.strip()])
        sent = [x for x in re.split(r"(?<=[.。])\s+", desc) if x]
        body = "".join('<span class="u">%s </span>' % inline(x) for x in sent)
        return ('<div class="fig" data-split="hard"><div class="fig-lab">그림 자리</div>'
                '<p data-units><b>그림:</b> %s</p></div>' % body)
    # 알림 상자(예: 이럴 땐 바로 병원)
    title = ""
    rest = q
    if re.fullmatch(r"\*\*.+\*\*", first):
        title = first.strip("*")
        rest = q[1:]
    inner = []
    for ch in chunks(rest):
        inner.extend(render_chunk(ch))
    inner_html = "".join(inner).replace(' data-split="soft"', "").replace(" data-units", "")
    return ('<div class="callout" data-split="hard"><div class="callout-lab">%s</div>'
            '<div data-units>%s</div></div>' % (inline(title), inner_html))


def render_figure_group(lines, title):
    """관계도의 '그림 설명' 부분: 점선 상자 안에, 덩어리마다 나눌 수 있게."""
    units = []
    for ch in chunks(lines):
        blocks = render_chunk(ch)
        h = "".join(blocks).replace(' data-split="soft"', "").replace(" data-units", "").replace(" data-keep", "")
        units.append('<div class="fg-u">%s</div>' % h)
    return ('<div class="fig figgroup" data-split="soft"><div class="fig-lab">그림 자리 — %s</div>'
            '<div data-units>%s</div></div>' % (inline(title), "".join(units)))


def render_article(path, toc_item, seq_label):
    lines = read_body(path)
    title_line = lines[0] if lines and lines[0].startswith("# ") else "# " + os.path.basename(path)
    title = title_line[2:].strip()
    lines = lines[1:]
    m = re.match(r"^(2-\d+)\s+(.+?):\s*(.+)$", title)
    if m:
        aid, kw, q = m.groups()
        head = ('<header class="art-head" data-keep><div class="art-no">%s</div>'
                '<h2 class="art-title"><span class="kw">%s</span> %s</h2></header>'
                % (aid, inline(kw), inline(q)))
        short = "%s %s" % (aid, kw)
    else:
        aid = "fig"
        kw, _, q = title.partition(":")
        head = ('<header class="art-head" data-keep><div class="art-no">2장 끝</div>'
                '<h2 class="art-title"><span class="kw">%s</span> %s</h2></header>'
                % (inline(kw.strip()), inline(q.strip())))
        short = kw.strip()
    blocks = [head]
    # 첫 괄호 줄(꼭지 위치·원고 표시)은 작은 회색 글씨로
    while lines and lines[0].strip() == "":
        lines = lines[1:]
    if lines and lines[0].strip().startswith("(") and lines[0].strip().endswith(")"):
        lines = lines[1:]  # 편집용 괄호 줄은 책에 넣지 않음

    # '## ' 로 나뉜 구역
    sections = []  # (h2 text or None, lines)
    cur_h, cur = None, []
    for ln in lines:
        if ln.startswith("## "):
            sections.append((cur_h, cur))
            cur_h, cur = ln[3:].strip(), []
        else:
            cur.append(ln)
    sections.append((cur_h, cur))

    for h2, body in sections:
        if h2 is not None:
            if "오른쪽 쪽" in h2:
                blocks.append('<div class="brk" data-side="오른쪽 쪽"></div>')
            elif "왼쪽 쪽" in h2:
                pass  # 꼭지는 늘 새 쪽에서 시작하므로 따로 나누지 않음
            elif h2.startswith("그림"):
                # 그림 설명 구역: '함께 읽으면…' 줄부터는 상자 밖으로
                fig_lines, after = [], []
                for idx, ln in enumerate(body):
                    if re.match(r"^\s*(함께 읽으면 좋은 꼭지|영양소 카드 찾기)\s*:", ln):
                        after = body[idx:]
                        break
                    fig_lines.append(ln)
                inner_title = re.sub(r"^그림\s*설명\s*", "", h2).strip("() ") or h2
                blocks.append(render_figure_group(fig_lines, "그림 설명 (%s)" % inner_title))
                body = after
            # 그 밖의 '## 짧은 글 (…)' 같은 편집 표시는 책에 나가지 않음
        for ch in chunks(body):
            blocks.extend(render_chunk(ch))
    return {
        "id": aid,
        "short": short,
        "toc_title": toc_item["title"] if toc_item else title,
        "plan_page": toc_item["page"] if toc_item else None,
        "html": '<article data-id="%s" data-short="%s">%s</article>'
                % (html.escape(aid), html.escape(short, quote=True), "".join(blocks)),
    }


# ---------------------------------------------------------------- 쪽(표지·차례)
def cover_html(info):
    ch_no = "2장"
    return """
<div class="cover">
  <div class="pill">원고 미리 보기</div>
  <div class="c-title">『%s』</div>
  <div class="c-sub">%s</div>
  <div class="c-rule"></div>
  <div class="c-ch"><span class="ch-no">%s</span> %s</div>
  <p class="c-key"><mark class="mk">%s</mark></p>
  <div class="c-foot">손가락으로 옆으로 밀거나, 화면 왼쪽·오른쪽을 눌러 넘겨 보세요.<br>그림은 아직 자리만 표시했어요.</div>
</div>""" % (inline(info["book"]), inline(info["subtitle"]), ch_no,
             inline(info["chapter"]), inline(info["key"]))


def toc_html(info, arts):
    rows = []
    for a in arts:
        it = a["toc"]
        num = html.escape(it["id"]) if it["id"] else "그림"
        t = it["title"]
        if ":" in t:
            k, _, rest = t.partition(":")
            tt = '<b>%s</b>:%s' % (inline(k), inline(rest))
        else:
            tt = inline(t)
        rows.append('<button class="trow" type="button" data-goto="%s"><span class="tn">%s</span>'
                    '<span class="tt">%s</span><span class="dots"></span><span class="tp" data-pg="%s">%s</span></button>'
                    % (html.escape(a["id"]), num, tt, html.escape(a["id"]), it["page"]))
    return """
<div class="toc">
  <div class="toc-lab">차례</div>
  <div class="toc-ch"><span class="ch-no">2장</span> %s</div>
  <p class="toc-key"><mark class="mk">%s</mark></p>
  <div class="toc-list">%s</div>
  <p class="toc-note">쪽 번호를 누르면 그 꼭지로 가요. (휴대폰에서 읽기 좋게 글자를 실제 책보다 크게 짜서, 쪽 번호는 실제 책과 달라요.)</p>
</div>""" % (inline(info["chapter"]), inline(info["key"]), "".join(rows))


# ---------------------------------------------------------------- 스타일·스크립트
CSS = r"""
:root{
  --bg:#E6DFD1;
  --paper:#FBF6EA;
  --paper-edge:#EFE6D3;
  --ink:#27241F;
  --ink2:#3D3832;
  --sub:#857D71;
  --line:#D9CFBC;
  --accent:#66763A;
  --accent-soft:rgba(102,118,58,.09);
  --mark:rgba(214,188,100,.50);
  --fig:#8A8F6A;
  --story:#B9AF9B;
  --kv1:#5F7A3E;
  --kv2:#9A7B2F;
  --kv3:#9B5A45;
  --btn:#FFFDF7;
  --shadow:rgba(60,48,28,.20);
  color-scheme:light;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#161512;
    --paper:#2A2721;
    --paper-edge:#221F1A;
    --ink:#EDE6D8;
    --ink2:#D9D1C2;
    --sub:#A49B8C;
    --line:#4A443A;
    --accent:#AFC07A;
    --accent-soft:rgba(175,192,122,.10);
    --mark:rgba(190,165,80,.38);
    --fig:#A6AB86;
    --story:#6E6758;
    --kv1:#A9C27F;
    --kv2:#D6B465;
    --kv3:#D99682;
    --btn:#2F2C26;
    --shadow:rgba(0,0,0,.45);
    color-scheme:dark;
  }
}
:root[data-theme="dark"]{
  --bg:#161512;
  --paper:#2A2721;
  --paper-edge:#221F1A;
  --ink:#EDE6D8;
  --ink2:#D9D1C2;
  --sub:#A49B8C;
  --line:#4A443A;
  --accent:#AFC07A;
  --accent-soft:rgba(175,192,122,.10);
  --mark:rgba(190,165,80,.38);
  --fig:#A6AB86;
  --story:#6E6758;
  --kv1:#A9C27F;
  --kv2:#D6B465;
  --kv3:#D99682;
  --btn:#2F2C26;
  --shadow:rgba(0,0,0,.45);
  color-scheme:dark;
}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{background:var(--bg);color:var(--ink);
  font-family:"Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic","맑은 고딕",sans-serif;
  -webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;}
#app{position:fixed;inset:0;display:flex;flex-direction:column;
  padding-left:max(16px,env(safe-area-inset-left));padding-right:max(16px,env(safe-area-inset-right));
  padding-top:max(10px,env(safe-area-inset-top));overflow:hidden}
#stage{flex:1 1 auto;position:relative;display:flex;align-items:center;justify-content:center;
  min-height:0;touch-action:pan-y;user-select:none;-webkit-user-select:none;cursor:pointer}
#bookbox{position:relative}
#book{position:absolute;left:0;top:0;transform-origin:0 0;display:flex;perspective:1800px}
#bar{flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:12px;
  padding:8px 0 max(10px,env(safe-area-inset-bottom))}
#bar button{font:inherit;font-size:15px;font-weight:500;color:var(--ink);background:var(--btn);
  border:1px solid var(--line);border-radius:999px;padding:9px 18px;min-width:76px;cursor:pointer}
#bar button:disabled{opacity:.4;cursor:default}
#count{font-size:14px;color:var(--sub);min-width:120px;text-align:center;font-variant-numeric:tabular-nums}
#count b{color:var(--ink);font-weight:700}

/* ---------- 쪽: 380 x 562 (152 x 225mm 비율) ---------- */
.page{width:380px;height:562px;background:var(--paper);position:relative;overflow:hidden;flex:0 0 auto;
  box-shadow:0 1px 3px var(--shadow)}
.spread .page.l{box-shadow:-1px 1px 3px var(--shadow);background:linear-gradient(to left,var(--paper-edge),var(--paper) 7%)}
.spread .page.r{box-shadow:1px 1px 3px var(--shadow);background:linear-gradient(to right,var(--paper-edge),var(--paper) 7%)}
.page.blank{background:var(--paper)}
.run{position:absolute;left:30px;right:30px;top:16px;font-size:7px;letter-spacing:.04em;color:var(--sub);
  display:flex;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:5px;white-space:nowrap}
.run b{font-family:"Nanum Myeongjo","Noto Serif KR",serif;font-weight:800;color:var(--accent);margin-right:6px}
.pbody{position:absolute;left:30px;right:30px;top:42px;bottom:40px;overflow:hidden}
.folio{position:absolute;left:0;right:0;bottom:14px;text-align:center;font-size:7.7px;color:var(--sub);
  letter-spacing:.12em;font-variant-numeric:tabular-nums}
.page.r .folio{text-align:right;padding-right:30px}
.page.l .folio{text-align:left;padding-left:30px}

/* 본문 */
.pbody{font-size:9.4px;line-height:1.78;color:var(--ink2);word-break:keep-all;overflow-wrap:break-word}
.pbody strong{color:var(--ink);font-weight:700}
.art-head{margin-bottom:6px}
.art-no{font-family:"Nanum Myeongjo","Noto Serif KR",serif;font-weight:800;font-size:9.1px;color:var(--accent);
  letter-spacing:.08em}
.art-title{font-family:"Nanum Myeongjo","Noto Serif KR",serif;font-weight:800;font-size:14px;line-height:1.4;
  color:var(--ink);margin-top:2px}
.art-title .kw{color:var(--accent)}
.meta{font-size:7.3px;line-height:1.5;color:var(--sub);margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--line)}
.h3{font-family:"Nanum Myeongjo","Noto Serif KR",serif;font-weight:800;font-size:10.8px;line-height:1.45;
  color:var(--ink);margin:14px 0 6px}
.pbody > .h3:first-child{margin-top:0}
.para{margin:0 0 8px;text-indent:0}
.para.cont{margin-top:0}
.emph{margin:4px 0 10px;font-weight:700;color:var(--ink);border-left:3px solid var(--accent);padding-left:10px;line-height:1.65}
.mk{background:linear-gradient(transparent 56%,var(--mark) 56%);color:inherit;
  -webkit-box-decoration-break:clone;box-decoration-break:clone}
.lst{margin:4px 0 10px;padding-left:1.4em}
.lst li{margin:2px 0;padding-left:2px}
ol.lst li::marker{color:var(--accent);font-weight:700}
ul.lst li::marker{color:var(--accent)}
.story{margin:6px 0 12px;border:1.5px dashed var(--story);border-radius:8px;padding:12px 12px;text-align:center;
  font-size:8.8px;color:var(--sub);background:transparent}
.fig{margin:8px 0 12px;border:1.5px dashed var(--fig);border-radius:8px;padding:9px 12px 10px;
  font-size:8.4px;line-height:1.6;color:var(--ink2)}
.fig-lab{font-size:7.3px;font-weight:700;letter-spacing:.08em;color:var(--fig);margin-bottom:3px}
.fig.cont .fig-lab::after{content:" (이어서)"}
.figgroup .fg-u{margin:0 0 7px}
.figgroup .fg-u:last-child{margin-bottom:0}
.figgroup .para,.figgroup p{margin:0 0 3px}
.figgroup .lst{margin:2px 0 2px;padding-left:1.2em}
.kv{margin:6px 0 10px;border-radius:8px;padding:8px 11px 8px;background:var(--accent-soft);font-size:8.8px;line-height:1.62}
.kv-lab{font-size:8px;font-weight:700;letter-spacing:.05em;margin-bottom:3px}
.kv1 .kv-lab{color:var(--kv1)} .kv2 .kv-lab{color:var(--kv2)} .kv3 .kv-lab{color:var(--kv3)}
.kv1{border-left:3px solid var(--kv1)} .kv2{border-left:3px solid var(--kv2)} .kv3{border-left:3px solid var(--kv3)}
.kv.cont .kv-lab::after{content:" (이어서)";font-weight:500;color:var(--sub)}
.kv ul{padding-left:1.1em}
.kv li{margin:3px 0}
.key{margin:10px 0 12px;padding:10px 12px;border-top:1.5px solid var(--ink);border-bottom:1px solid var(--line)}
.key-lab{font-size:7.7px;font-weight:700;letter-spacing:.08em;color:var(--accent);margin-bottom:3px}
.key p{font-family:"Nanum Myeongjo","Noto Serif KR",serif;font-weight:800;font-size:10.5px;line-height:1.6;color:var(--ink)}
.callout{margin:8px 0 12px;padding:9px 12px;border:1.5px solid var(--kv3);border-radius:8px;font-size:8.8px;line-height:1.6}
.callout-lab{font-weight:700;color:var(--kv3);margin-bottom:3px}
.callout .lst{margin:2px 0;padding-left:1.1em}
.see{margin:10px 0 0;padding-top:8px;border-top:1px dashed var(--line);font-size:8px;line-height:1.6;color:var(--sub)}
.see b{color:var(--accent);font-weight:700;margin-right:4px}
.tbl{width:100%;border-collapse:collapse;font-size:8px;margin:6px 0 10px}
.tbl th,.tbl td{border:1px solid var(--line);padding:4px 6px;vertical-align:top;text-align:left}
.brk{display:none}
.side-mark{font-size:7px;color:var(--sub);letter-spacing:.06em;margin:0 0 6px}

/* 표지 */
.cover{position:absolute;left:32px;right:30px;top:58px;bottom:40px}
.pill{display:inline-block;padding:2px 10px 3px;border:1px solid var(--sub);border-radius:999px;font-size:7.7px;
  color:var(--sub);letter-spacing:.06em}
.c-title{font-family:"Nanum Myeongjo","Noto Serif KR",serif;font-weight:800;font-size:21.7px;line-height:1.25;
  margin-top:26px;color:var(--ink);letter-spacing:.01em}
.c-sub{font-family:"Nanum Myeongjo","Noto Serif KR",serif;font-weight:700;font-size:9.8px;line-height:1.55;
  color:var(--ink2);margin-top:12px;word-break:keep-all}
.c-rule{width:40px;height:2px;background:var(--ink);margin:30px 0 26px}
.c-ch{font-family:"Nanum Myeongjo","Noto Serif KR",serif;font-weight:800;font-size:14px;line-height:1.45;color:var(--ink);word-break:keep-all}
.ch-no{color:var(--accent);margin-right:4px}
.c-key{margin-top:14px;font-size:10.5px;font-weight:700;line-height:1.7;color:var(--ink);word-break:keep-all}
.c-foot{position:absolute;left:0;right:0;bottom:6px;font-size:7.7px;line-height:1.6;color:var(--sub);word-break:keep-all}

/* 차례 */
.toc{position:absolute;left:28px;right:28px;top:30px;bottom:30px}
.toc-lab{font-family:"Nanum Myeongjo","Noto Serif KR",serif;font-weight:800;font-size:14.7px;letter-spacing:.3em;color:var(--ink)}
.toc-ch{font-family:"Nanum Myeongjo","Noto Serif KR",serif;font-weight:800;font-size:10.5px;line-height:1.4;margin-top:8px;
  padding-top:8px;border-top:1.5px solid var(--ink);color:var(--ink);word-break:keep-all}
.toc-key{font-size:8.4px;font-weight:700;line-height:1.55;margin:4px 0 6px;color:var(--ink);word-break:keep-all}
.trow{display:flex;align-items:flex-end;width:100%;background:none;border:0;font:inherit;color:var(--ink2);
  text-align:left;padding:2px 0;cursor:pointer;font-size:8px;line-height:1.38}
.trow .tn{flex:0 0 34px;color:var(--sub);font-size:7.7px;font-variant-numeric:tabular-nums;line-height:1.55}
.trow .tt{flex:0 1 auto;word-break:keep-all}
.trow .tt b{color:var(--ink);font-weight:700}
.trow .dots{flex:1 1 auto;min-width:14px;height:5px;margin:0 6px 5px;
  background-image:radial-gradient(circle,var(--sub) .9px,transparent 1.2px);background-size:7px 5px;background-repeat:repeat-x;opacity:.7}
.trow .tp{flex:0 0 auto;min-width:1.8em;text-align:right;font-family:"Nanum Myeongjo","Noto Serif KR",serif;font-weight:800;
  color:var(--accent);font-variant-numeric:tabular-nums}
.toc-note{margin-top:6px;font-size:6.6px;line-height:1.55;color:var(--sub);word-break:keep-all}

/* 넘김 애니메이션 */
.flip{position:absolute;top:0;z-index:5;pointer-events:none;backface-visibility:hidden}
.flip.fwd{transform-origin:0 50%;animation:flipF .34s ease-in forwards}
.flip.back{transform-origin:100% 50%;animation:flipB .34s ease-in forwards}
@keyframes flipF{from{transform:rotateY(0);filter:brightness(1)}to{transform:rotateY(-88deg);filter:brightness(.8)}}
@keyframes flipB{from{transform:rotateY(0);filter:brightness(1)}to{transform:rotateY(88deg);filter:brightness(.8)}}
@media (prefers-reduced-motion: reduce){.flip{display:none!important;animation:none!important}}

#measure{position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none}
"""

JS = r"""
(function(){
  "use strict";
  var KEY = "healthbook-ch2-page";
  var START_FOLIO = __START__;
  var PW = 380, PH = 562;
  var src = document.getElementById("src");
  var book = document.getElementById("book");
  var bookbox = document.getElementById("bookbox");
  var stage = document.getElementById("stage");
  var countEl = document.getElementById("count");
  var prevBtn = document.getElementById("prev");
  var nextBtn = document.getElementById("next");
  var measure = document.getElementById("measure");
  var pages = [];      // {el, kind, folio, art}
  var artStart = {};   // 꼭지 id -> 쪽 순번
  var cur = 0;         // 지금 보이는 첫 쪽 순번
  var anchor = 0;      // 읽던 쪽 (펼친 두 쪽에서 맞춰 당기기 전)
  var spread = false;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function mkPage(kind){
    var p = document.createElement("div");
    p.className = "page " + kind;
    return p;
  }
  function fits(body){ return body.scrollHeight <= body.clientHeight + 0.5; }

  function newBodyPage(art){
    var p = mkPage("text");
    var run = document.createElement("div");
    run.className = "run";
    run.innerHTML = "<span><b>2장</b>" + escapeHtml(document.body.getAttribute("data-chapter")) + "</span><span>" + escapeHtml(art.getAttribute("data-short")) + "</span>";
    var body = document.createElement("div");
    body.className = "pbody";
    var fol = document.createElement("div");
    fol.className = "folio";
    p.appendChild(run); p.appendChild(body); p.appendChild(fol);
    measure.appendChild(p);
    return {el:p, body:body, folioEl:fol};
  }
  function escapeHtml(s){ return String(s||"").replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); }
  function unitBox(el){ return el.hasAttribute("data-units") ? el : el.querySelector("[data-units]"); }

  // 블록 하나를 page에 흘려 넣는다. 다 못 넣으면 남은 조각(복제본)을 돌려준다.
  function place(block, pg){
    pg.body.appendChild(block);
    if (fits(pg.body)) return null;
    var mode = block.getAttribute("data-split");
    var empty = pg.body.children.length === 1;
    if (!mode || (mode === "hard" && !empty)) {
      pg.body.removeChild(block);
      return empty ? "TOO_BIG" : block;
    }
    var box = unitBox(block);
    if (!box || box.children.length < 2) {
      pg.body.removeChild(block);
      return empty ? "TOO_BIG" : block;
    }
    // 조각 단위로 나누기
    var units = Array.prototype.slice.call(box.children);
    var rest = block.cloneNode(true);
    var restBox = unitBox(rest);
    while (box.firstChild) box.removeChild(box.firstChild);
    var placed = 0;
    for (var i = 0; i < units.length; i++) {
      box.appendChild(units[i]);
      if (!fits(pg.body)) { box.removeChild(units[i]); break; }
      placed++;
    }
    if (placed === 0) {
      pg.body.removeChild(block);
      return empty ? "TOO_BIG" : rest;
    }
    // 남은 조각
    var restUnits = Array.prototype.slice.call(restBox.children);
    for (var j = 0; j < placed; j++) restBox.removeChild(restUnits[j]);
    rest.classList.add("cont");
    if (restBox.tagName === "OL") {
      var st = parseInt(restBox.getAttribute("start") || "1", 10);
      restBox.setAttribute("start", st + placed);
    }
    return rest;
  }

  function paginate(){
    var keepArt = pages[anchor] && pages[anchor].art, keepOff = 0;
    if (keepArt) { keepOff = anchor - artStart[keepArt]; }
    pages = []; artStart = {};
    measure.innerHTML = "";
    // 표지·차례
    var cov = mkPage("kcover"); cov.innerHTML = src.content.querySelector("#cover-src").innerHTML;
    pages.push({el:cov, kind:"cover", folio:null, art:null});
    var toc = mkPage("tocp"); toc.innerHTML = src.content.querySelector("#toc-src").innerHTML;
    pages.push({el:toc, kind:"toc", folio:null, art:null});
    var folio = START_FOLIO;
    var arts = src.content.querySelectorAll("article");
    for (var a = 0; a < arts.length; a++) {
      var art = arts[a], id = art.getAttribute("data-id");
      var blocks = Array.prototype.slice.call(art.children).map(function(b){ return b.cloneNode(true); });
      var pg = newBodyPage(art);
      var artPages = [pg];
      artStart[id] = pages.length;
      var queue = blocks.slice();
      var guard = 0;
      while (queue.length && guard++ < 5000) {
        var b = queue.shift();
        if (b.classList.contains("brk")) {
          if (pg.body.children.length) { pg = newBodyPage(art); artPages.push(pg); }
          var sm = document.createElement("div"); sm.className = "side-mark"; sm.textContent = "· " + b.getAttribute("data-side") + " ·";
          pg.body.appendChild(sm);
          continue;
        }
        var r = place(b, pg);
        if (r === null) continue;
        if (r === "TOO_BIG") { // 빈 쪽에도 안 들어가는 블록: 그대로 두고 넘침 검사에서 드러나게
          pg.body.appendChild(b); pg = newBodyPage(art); artPages.push(pg); continue;
        }
        // 쪽 끝에 제목만 남지 않게 (뒤 글과 함께 다음 쪽으로)
        var carry = [];
        while (pg.body.lastElementChild && (pg.body.lastElementChild.hasAttribute("data-keep") || pg.body.lastElementChild.className === "side-mark") && pg.body.children.length > 1) {
          carry.unshift(pg.body.removeChild(pg.body.lastElementChild));
        }
        pg = newBodyPage(art); artPages.push(pg);
        queue = carry.concat([r], queue);
      }
      artPages.forEach(function(p){
        if (!p.body.children.length) return;
        p.folioEl.textContent = folio;
        pages.push({el:p.el, kind:"text", folio:folio, art:id});
        folio++;
      });
    }
    // 차례에 실제 쪽 번호
    pages.forEach(function(p){
      p.el.querySelectorAll && p.el.querySelectorAll("[data-pg]").forEach(function(s){
        var i = artStart[s.getAttribute("data-pg")];
        if (i != null) s.textContent = pages[i].folio;
      });
    });
    measure.innerHTML = "";
    if (keepArt && artStart[keepArt] != null) anchor = Math.min(artStart[keepArt] + keepOff, pages.length - 1);
    anchor = Math.min(anchor, pages.length - 1); cur = anchor;
  }

  function layout(){
    var w = stage.clientWidth, h = stage.clientHeight;
    var sTwo = Math.min(w / (PW * 2), h / PH);
    spread = sTwo >= 0.9 && w >= 700;
    var vw = spread ? PW * 2 : PW;
    var s = spread ? sTwo : Math.min(w / PW, h / PH);
    s = Math.max(0.3, Math.min(s, 1.8));
    book.style.transform = "scale(" + s + ")";
    book.style.width = vw + "px"; book.style.height = PH + "px";
    bookbox.style.width = Math.floor(vw * s) + "px";
    bookbox.style.height = Math.floor(PH * s) + "px";
    book.classList.toggle("spread", spread);
    cur = spread ? viewStart(anchor) : anchor;
    render();
  }
  // 펼친 두 쪽: [표지] 혼자, 그다음 (1,2) (3,4) ...
  function viewStart(i){ if (!spread || i === 0) return i; return i % 2 === 1 ? i : i - 1; }
  function viewPages(i){
    if (!spread) return [i];
    if (i === 0) return [0];
    return i + 1 < pages.length ? [i, i + 1] : [i];
  }
  function render(){
    book.innerHTML = "";
    var v = viewPages(cur);
    v.forEach(function(i, k){
      var el = pages[i].el;
      el.classList.remove("l", "r");
      if (spread && v.length === 2) el.classList.add(k === 0 ? "l" : "r");
      else if (spread) el.classList.add(i === 0 ? "r" : "l");
      book.appendChild(el);
    });
    if (spread && v.length === 1) { // 혼자 있는 쪽은 가운데
      book.style.justifyContent = "center";
    } else book.style.justifyContent = "flex-start";
    var first = pages[v[0]], last = pages[v[v.length - 1]];
    var label;
    if (first.kind === "cover") label = "표지";
    else if (first.kind === "toc") label = last.folio == null ? "차례" : "차례 · " + last.folio + "쪽";
    else label = (first.folio === last.folio ? first.folio : first.folio + "–" + last.folio) + "쪽";
    var n = v.map(function(i){return i + 1;});
    countEl.innerHTML = "<b>" + label + "</b> · " + (n.length > 1 ? n[0] + "–" + n[1] : n[0]) + " / " + pages.length;
    prevBtn.disabled = cur <= 0;
    nextBtn.disabled = v[v.length - 1] >= pages.length - 1;
    try {
      var pc = pages[anchor];
      localStorage.setItem(KEY, JSON.stringify({i:anchor, a:pc.art, o:pc.art ? anchor - artStart[pc.art] : 0}));
    } catch (e) {}
  }
  function go(target, dir){
    target = Math.max(0, Math.min(pages.length - 1, target));
    var shown = spread ? viewStart(target) : target;
    anchor = target;
    if (shown === cur) { render(); return; }
    if (!reduce) flipOut(dir || (shown > cur ? 1 : -1));
    cur = shown;
    render();
  }
  function step(dir){
    var v = viewPages(cur);
    if (dir > 0) go(v[v.length - 1] + 1, 1);
    else go(spread ? (cur <= 1 ? 0 : cur - 2) : cur - 1, -1);
  }
  function flipOut(dir){
    var kids = Array.prototype.slice.call(book.children);
    if (!kids.length) return;
    var src = dir > 0 ? kids[kids.length - 1] : kids[0];
    var c = src.cloneNode(true);
    c.classList.add("flip", dir > 0 ? "fwd" : "back");
    c.style.left = src.offsetLeft + "px";
    book.__flip && book.__flip.remove();
    book.__flip = c;
    setTimeout(function(){ book.appendChild(c); }, 0);
    var kill = function(){ c.remove(); };
    c.addEventListener("animationend", kill);
    setTimeout(kill, 600);
  }

  // 조작
  prevBtn.addEventListener("click", function(e){ e.stopPropagation(); step(-1); });
  nextBtn.addEventListener("click", function(e){ e.stopPropagation(); step(1); });
  document.addEventListener("keydown", function(e){
    if (e.key === "ArrowRight" || e.key === "PageDown") { step(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { step(-1); e.preventDefault(); }
  });
  var tx = null, ty = 0, swipedAt = 0;
  stage.addEventListener("touchstart", function(e){
    if (e.touches.length !== 1) { tx = null; return; }
    tx = e.touches[0].clientX; ty = e.touches[0].clientY;
  }, {passive:true});
  stage.addEventListener("touchend", function(e){
    if (tx == null) return;
    var t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty;
    tx = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) { swipedAt = Date.now(); step(dx < 0 ? 1 : -1); }
  }, {passive:true});
  stage.addEventListener("click", function(e){
    if (Date.now() - swipedAt < 450) return; // 밀기 뒤 따라오는 눌림은 무시
    var g = e.target.closest && e.target.closest("[data-goto]");
    if (g) { var i = artStart[g.getAttribute("data-goto")]; if (i != null) go(i, 1); return; }
    var r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
    if (x < 0.4) step(-1); else if (x > 0.6) step(1);
  });
  window.addEventListener("resize", layout);

  // 검사용 (Playwright)
  window.__book = {
    count: function(){ return pages.length; },
    cur: function(){ return cur; },
    spread: function(){ return spread; },
    overflow: function(){ // 쪽마다 넘친 px (0이면 잘린 글 없음)
      var res = [];
      measure.innerHTML = "";
      pages.forEach(function(p, i){
        var el = p.el.cloneNode(true); measure.appendChild(el);
        var worst = 0;
        el.querySelectorAll(".pbody,.cover,.toc").forEach(function(b){
          worst = Math.max(worst, b.scrollHeight - b.clientHeight, b.scrollWidth - b.clientWidth);
        });
        res.push(worst);
        measure.removeChild(el);
      });
      return res;
    },
    folios: function(){ return pages.map(function(p){ return p.folio; }); },
    starts: function(){ return artStart; }
  };

  function start(){
    paginate();
    var saved = 0;
    try {
      var sv = JSON.parse(localStorage.getItem(KEY) || "null");
      if (sv && sv.a && artStart[sv.a] != null) {
        var nxt = null;
        for (var k in artStart) if (artStart[k] > artStart[sv.a] && (nxt == null || artStart[k] < nxt)) nxt = artStart[k];
        saved = Math.min(artStart[sv.a] + (sv.o || 0), (nxt == null ? pages.length : nxt) - 1);
      } else if (sv && typeof sv.i === "number") saved = sv.i;
    } catch (e) {}
    anchor = cur = Math.max(0, Math.min(saved, pages.length - 1));
    layout();
  }
  start();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function(){ paginate(); layout(); });
  }
})();
"""


# ---------------------------------------------------------------- 묶기
def main():
    info = read_toc()
    arts = []
    for it in info["items"]:
        if it["id"]:
            path = os.path.join(HERE, "%s.md" % it["id"])
        else:
            path = os.path.join(HERE, "2-관계도.md")
        if not os.path.exists(path):
            sys.exit("원고 파일이 없습니다: %s" % path)
        a = render_article(path, it, None)
        a["toc"] = it
        arts.append(a)
    for a in arts:
        if MEMO_MARK in a["html"] or "편집팀 메모" in a["html"]:
            sys.exit("편집팀 메모가 본문에 섞였습니다: %s" % a["id"])

    start_folio = info["items"][0]["page"] if info["items"] else 27
    out = []
    out.append("<title>%s 2장</title>" % html.escape(info["book"]))
    out.append('<meta name="claude:viewport-fit-sides" content="cover">')
    out.append("<style>%s</style>" % CSS)
    out.append('<link rel="preconnect" href="https://fonts.googleapis.com">')
    out.append('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>')
    out.append('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nanum+Myeongjo:wght@400;700;800&family=Noto+Sans+KR:wght@400;500;700&display=swap">')
    out.append('<div id="app" data-chapter="">')
    out.append('<div id="stage" aria-label="책 보기"><div id="bookbox"><div id="book"></div></div></div>')
    out.append('<div id="bar"><button id="prev" type="button" aria-label="이전 쪽">‹ 이전</button>'
               '<span id="count" aria-live="polite"></span>'
               '<button id="next" type="button" aria-label="다음 쪽">다음 ›</button></div>')
    out.append("</div>")
    out.append('<div id="measure" aria-hidden="true"></div>')
    out.append('<template id="src">')
    out.append('<div id="cover-src">%s</div>' % cover_html(info))
    out.append('<div id="toc-src">%s</div>' % toc_html(info, arts))
    for a in arts:
        out.append(a["html"])
    out.append("</template>")
    chapter_short = info["chapter"].split("—")[0].strip()
    js = JS.replace("__START__", str(int(start_folio)))
    js = js.replace('document.body.getAttribute("data-chapter")', json.dumps(" " + chapter_short))
    out.append("<script>%s</script>" % js)
    doc = "\n".join(out) + "\n"
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        f.write(doc)
    print("만듦: %s (%d바이트, 꼭지 %d개)" % (OUT_FILE, len(doc.encode("utf-8")), len(arts)))


if __name__ == "__main__":
    main()
