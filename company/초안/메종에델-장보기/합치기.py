import base64, re, sys, pathlib
src = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2])
html = (src/'index.html').read_text(encoding='utf-8')
js = (src/'장보기-재료.js').read_text(encoding='utf-8')
for name in ['작은-마약계란.jpg','작은-리조또.jpg']:
    b = (src/'사진'/name).read_bytes()
    assert b[:2] == b'\xff\xd8', name
    uri = 'data:image/jpeg;base64,' + base64.b64encode(b).decode()
    key = '"사진/%s"' % name
    assert js.count(key) == 1, key
    js = js.replace(key, '"%s"' % uri)
tag = '<script src="장보기-재료.js"></script>'
assert html.count(tag) == 1
html = html.replace(tag, '<script>\n' + js + '\n</script>')
# 아티팩트 틀이 doctype/html/head/body 를 씌우므로 그 껍데기 태그만 뺀다 (내용·디자인은 그대로)
for t in ['<!doctype html>\n', '<html lang="ko">\n', '<head>\n', '</head>\n', '<body>\n', '</body>\n', '</html>',
          '<meta charset="utf-8">\n', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n']:
    assert html.count(t) == 1, t
    html = html.replace(t, '')
html = html.replace('<meta name="robots" content="noindex">\n', '<title>Maison Edel</title>\n<meta name="robots" content="noindex">\n', 1)
html = html.replace('<meta name="theme-color" content="#EFE8DC">\n<title>Maison Edel</title>\n', '<meta name="theme-color" content="#EFE8DC">\n', 1)
out.write_text(html, encoding='utf-8')
