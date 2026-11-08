"""메종 에델 레시피 카드 (C안 틀) — 크레딧 0, PIL로 그림.

쓰는 법:
  python3 -I recipe_card.py <요리키> <저장할 파일.png> [--tall] [--fonts 글꼴폴더]
  예) python3 -I recipe_card.py tomato_sotbap /tmp/카드.png
      python3 -I recipe_card.py tomato_sotbap /tmp/카드-세로.png --tall   (1080x1920 영상 끝용, 글자는 위에서 1,600px 안)
새 요리는 아래 RECIPES에 한 덩어리 추가 + 주재료 그림 함수(draw_*) 하나 추가.
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np, math, sys, os

IV = (248, 246, 242); BE = (232, 221, 207); TA = (168, 154, 138); OL = (107, 114, 88); CH = (62, 62, 62)
TOM = (196, 104, 82); TOM_D = (160, 78, 62)
K = 2; W = 1080
FONT_DIR = '/tmp/claude-0/-home-user/020f0925-2716-5554-b1a3-06e5bb251207/scratchpad/ref/'
EMO = '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf'

# ---------------- 레시피 (레시피함 원문 계량 그대로, 제품명·냄비 이름 없이) ----------------
# 토마토 솥밥: 회장님 11/8 설명 — 밥물에 곰국 블록을 넣음, 꼭지 딴 토마토 (레시피함 원문은 '물에 녹여 붓기')
RECIPES = {
    'tomato_sotbap': dict(
        no='05', ko='토마토 솥밥', en='Tomato Sotbap', meta='4인분  ·  약 40분', main='tomato',
        ing=['쌀 2.5컵 · 다진 소고기 100g · 토마토 1개',
             '쪽파 약간 · 포도씨유 1T · 밥물 2컵 · 곰국 블록 1개'],
        steps=['쌀은 30분 이상 불려 물기를 빼요',
               '포도씨유에 소고기를 볶다가 쌀을 섞어요',
               '밥물에 곰국 블록, 꼭지 딴 토마토를 가운데에',
               '뚜껑 덮고 9단 2분 → 3단 12분',
               '쪽파 넣고 1분 뜸, 토마토를 으깨 섞어요']),
    'egg_kabocha': dict(
        no='04', ko='에그 단호박 스타터', en='Egg Kabocha Starter', meta='약 30분', main='kabocha',
        # 노션: 기준 4인분인데 단호박·달걀은 3개라 화면에 '인분'은 쓰지 않음
        ing=['미니 단호박 3개 · 달걀 3개 · 피자치즈 45g',
             '소금 · 후추 · 바질가루 약간 · 물 150ml'],
        steps=['미니 단호박 윗부분을 잘라 속을 파내요',
               '달걀을 하나씩 넣고 소금 · 후추 · 바질가루',
               '피자치즈를 얹어요',
               '냄비에 물 150ml, 찜기에 단호박을 올려요',
               '뚜껑 덮고 7단 20분 쪄요']),
}


def F(name, s): return ImageFont.truetype(os.path.join(FONT_DIR, name), int(s * K))
def k(v): return int(round(v * K))
def ltext(d, x, y, t, f, c): d.text((k(x), k(y)), t, font=f, fill=c)
def ctext(d, y, t, f, c): d.text(((k(W) - d.textlength(t, font=f)) / 2, k(y)), t, font=f, fill=c)


def save_line(img, d, y, f):
    t = '저장해 두세요 '; w = d.textlength(t, font=f) / K; hs = f.size / K * 0.95
    x = (W - w - hs) / 2; ltext(d, x, y, t, f, CH)
    ef = ImageFont.truetype(EMO, 109); e = Image.new('RGBA', (140, 140), (0, 0, 0, 0))
    ImageDraw.Draw(e).text((6, 6), '🤍', font=ef, embedded_color=True)
    e = e.crop(e.getbbox()).resize((k(hs), k(hs)), Image.LANCZOS)
    img.paste(e, (k(x + w), k(y + f.size / K * 0.12)), e)


def linen_bg(Hh):
    base = Image.new('RGB', (W * K, Hh * K), BE)
    a = np.asarray(base).astype(np.float32)
    yy = np.linspace(0, 1, base.height)[:, None]; xx = np.linspace(0, 1, base.width)[None, :]
    light = (1 - ((xx - 0.15) ** 2 * 1.4 + (yy - 0.05) ** 2 * 2.2)).clip(0, 1) * 22
    a = (a + light[..., None] - 10 * yy[..., None]).clip(0, 255)
    rng = np.random.default_rng(9)
    weave = np.sin(np.arange(base.width) / k(2.2))[None, :] * 0.8 + np.sin(np.arange(base.height) / k(2.6))[:, None] * 0.8
    a = (a + weave[..., None] + rng.normal(0, 4, a.shape[:2])[..., None]).clip(0, 255)
    img = Image.fromarray(a.astype(np.uint8)).convert('RGBA')
    sh = Image.new('L', img.size, 0); sd = ImageDraw.Draw(sh)   # 창 그림자
    sd.polygon([(k(700), 0), (k(780), 0), (k(1080), k(300)), (k(1080), k(390))], fill=40)
    sd.polygon([(k(860), 0), (k(900), 0), (k(1080), k(170)), (k(1080), k(210))], fill=30)
    shade = Image.new('RGBA', img.size, (80, 62, 50, 0)); shade.putalpha(sh.filter(ImageFilter.GaussianBlur(k(18))))
    img.alpha_composite(shade)
    return img


def _shade(t, sz, c, r, dark_col, light_col, light_box):
    sh = Image.new('L', (sz, sz), 0); ImageDraw.Draw(sh).ellipse((c - r * 0.2, c - r * 0.1, c + r * 1.4, c + r * 1.2), fill=120)
    sh = sh.filter(ImageFilter.GaussianBlur(r * 0.35))
    alpha = t.split()[3]; zero = Image.new('L', (sz, sz), 0)
    t = Image.composite(Image.new('RGBA', (sz, sz), dark_col + (255,)), t, Image.composite(sh, zero, alpha))
    hl = Image.new('L', (sz, sz), 0); ImageDraw.Draw(hl).ellipse(light_box, fill=150)
    hl = hl.filter(ImageFilter.GaussianBlur(r * 0.14))
    return Image.composite(Image.new('RGBA', (sz, sz), light_col + (255,)), t, Image.composite(hl, zero, alpha))


def _ground_shadow(layer, cx, cy, r, h=1.0):
    s = Image.new('RGBA', layer.size, (0, 0, 0, 0))
    ImageDraw.Draw(s).ellipse((k(cx - r * 1.2), k(cy + r * 0.62 * h), k(cx + r * 1.3), k(cy + r * 1.08 * h)), fill=(90, 70, 55, 70))
    layer.alpha_composite(s.filter(ImageFilter.GaussianBlur(k(r * 0.16))))


def draw_tomato(layer, cx, cy, r):
    sz = k(r * 2.6); c = sz / 2; R = k(r)
    t = Image.new('RGBA', (sz, sz), (0, 0, 0, 0)); td = ImageDraw.Draw(t)
    pts = [(c + R * (1 + 0.025 * math.cos(5 * a)) * 1.08 * math.cos(a), c + R * (1 + 0.025 * math.cos(5 * a)) * 0.93 * math.sin(a))
           for a in np.linspace(0, 2 * math.pi, 181)]
    td.polygon(pts, fill=TOM + (255,))
    t = _shade(t, sz, c, R, TOM_D, (250, 222, 205), (c - R * 0.75, c - R * 0.62, c - R * 0.2, c - R * 0.25))
    td = ImageDraw.Draw(t); top = c - R * 0.86
    for a in [-150, -110, -70, -30, 10]:
        ang = math.radians(a)
        tip = (c + R * 0.5 * math.cos(ang), top + R * 0.25 * math.sin(ang) + R * 0.06)
        s1 = (c + R * 0.18 * math.cos(ang + 0.6), top + R * 0.1 * math.sin(ang + 0.6))
        s2 = (c + R * 0.18 * math.cos(ang - 0.6), top + R * 0.1 * math.sin(ang - 0.6))
        td.polygon([s1, tip, s2, (c, top)], fill=OL + (255,))
    td.line([(c, top), (c + R * 0.06, top - R * 0.22), (c + R * 0.17, top - R * 0.32)], fill=OL + (255,), width=k(r * 0.07))
    t = t.filter(ImageFilter.GaussianBlur(k(1.2)))
    _ground_shadow(layer, cx, cy, r)
    layer.alpha_composite(t, (int(k(cx) - sz / 2), int(k(cy) - sz / 2)))


def draw_kabocha(layer, cx, cy, r):
    """꼭지 달린 미니 단호박 하나: 짙은 초록 껍질, 골 사이 주황 결이 살짝"""
    G, G_D, G_L, ORG = (66, 88, 64), (46, 64, 48), (128, 148, 112), (200, 146, 86)
    sz = k(r * 2.8); c = sz / 2; R = k(r)
    t = Image.new('RGBA', (sz, sz), (0, 0, 0, 0)); td = ImageDraw.Draw(t)
    rx, ry = R * 1.18, R * 0.86       # 납작하고 넓은 몸통
    def body(a):
        bump = 1 + 0.035 * abs(math.cos(4 * a))   # 골 8개 느낌
        dent = 1 - 0.09 * max(0, -math.sin(a)) ** 6  # 꼭지 쪽 살짝 들어감
        return (c + rx * bump * math.cos(a), c + ry * bump * dent * math.sin(a))
    pts = [body(a) for a in np.linspace(0, 2 * math.pi, 241)]
    td.polygon(pts, fill=G + (255,))
    alpha = t.split()[3]
    # 골 (세로 곡선) + 주황 결
    ribs = Image.new('RGBA', (sz, sz), (0, 0, 0, 0)); rd = ImageDraw.Draw(ribs)
    for i, u in enumerate(np.linspace(-0.82, 0.82, 7)):
        line = [(c + rx * u * math.cos(v * math.pi / 2) ** 0.55, c + ry * math.sin(v * math.pi / 2) * 0.97) for v in np.linspace(-0.92, 0.95, 30)]
        rd.line(line, fill=G_D + (255,), width=k(r * 0.05), joint='curve')
        rd.line([(x + k(r * 0.035), y) for x, y in line[4:-6]], fill=ORG + (150,), width=k(r * 0.018), joint='curve')
    ribs = ribs.filter(ImageFilter.GaussianBlur(k(r * 0.012)))
    ribs.putalpha(Image.composite(ribs.split()[3], Image.new('L', (sz, sz), 0), alpha))
    t.alpha_composite(ribs)
    # 껍질 점무늬 (연한 초록)
    rng = np.random.default_rng(4); sp = ImageDraw.Draw(t)
    for _ in range(int(r * 0.7)):
        a = rng.random() * 2 * math.pi; q = math.sqrt(rng.random()) * 0.9
        x, y = c + rx * q * math.cos(a), c + ry * q * math.sin(a)
        s = k(r * (0.008 + 0.01 * rng.random()))
        sp.ellipse((x - s, y - s, x + s, y + s), fill=G_L + (80,))
    t.putalpha(alpha)
    t = _shade(t, sz, c, R, G_D, (150, 168, 132), (c - R * 0.95, c - R * 0.62, c - R * 0.3, c - R * 0.22))
    # 꼭지 (짧고 굵은 나무색)
    td = ImageDraw.Draw(t); top = c - ry * 0.9
    td.ellipse((c - R * 0.2, top - R * 0.06, c + R * 0.2, top + R * 0.12), fill=(118, 108, 74, 255))
    stem = [(c - R * 0.09, top + R * 0.02), (c - R * 0.06, top - R * 0.26), (c + R * 0.02, top - R * 0.34),
            (c + R * 0.12, top - R * 0.3), (c + R * 0.08, top - R * 0.2), (c + R * 0.09, top + R * 0.02)]
    td.polygon(stem, fill=(168, 150, 104, 255))
    td.line([(c - R * 0.02, top - R * 0.02), (c + R * 0.02, top - R * 0.28)], fill=(196, 180, 136, 255), width=k(r * 0.025))
    t = t.filter(ImageFilter.GaussianBlur(k(1.2)))
    _ground_shadow(layer, cx, cy, r * 1.05, 0.95)
    layer.alpha_composite(t, (int(k(cx) - sz / 2), int(k(cy) - sz / 2)))


MAINS = {'tomato': draw_tomato, 'kabocha': draw_kabocha}


def make_card(key, out, tall=False):
    rcp = RECIPES[key]
    Hh, P0, oy, s = (1920, 860, 150, 1.15) if tall else (1350, 600, 0, 1.0)
    img = linen_bg(Hh)
    size = 150 if rcp['main'] == 'tomato' else 140
    MAINS[rcp['main']](img, 540 + (520 - 540) * s, oy + 320 * s, size * s)
    d = ImageDraw.Draw(img)
    d.text((k(64), k(58)), 'M A I S O N   E D E L', font=F('CormorantGaramond-Medium.ttf', 24), fill=(120, 105, 92))
    rt = 'Recipe No.' + rcp['no']; f = F('CormorantGaramond-Italic.ttf', 32)
    d.text((k(W - 64) - d.textlength(rt, font=f), k(52)), rt, font=f, fill=(120, 105, 92))
    P1 = P0 + 702
    panel = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(panel).rounded_rectangle((k(48), k(P0), k(W - 48), k(P1)), radius=k(30), fill=IV + (238,))
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((k(48), k(P0 + 8), k(W - 48), k(P1 + 8)), radius=k(30), fill=(60, 45, 35, 40))
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(k(10)))); img.alpha_composite(panel)
    img = img.convert('RGB'); d = ImageDraw.Draw(img); o = P0 - 600
    GB, GR, CI = 'GowunBatang-Bold.ttf', 'GowunBatang-Regular.ttf', 'CormorantGaramond-Italic.ttf'
    ft = F(GB, 76)
    while d.textlength(rcp['ko'], font=ft) / K > W - 200: ft = F(GB, ft.size / K - 2)
    ctext(d, 636 + o, rcp['ko'], ft, CH)
    t1, t2 = rcp['en'], '   ·   ' + rcp['meta']; f1, f2 = F(CI, 36), F(GR, 28)
    w = (d.textlength(t1, font=f1) + d.textlength(t2, font=f2)) / K; x = (W - w) / 2
    ltext(d, x, 728 + o, t1, f1, OL); ltext(d, x + d.textlength(t1, font=f1) / K, 734 + o, t2, f2, TA)
    d.line((k(120), k(790 + o), k(W - 120), k(790 + o)), fill=BE, width=k(2))
    fi = F(GR, 30); ltext(d, 110, 812 + o, '재료', F(GB, 30), OL)
    y = 812 + o
    for tline in rcp['ing']:
        assert d.textlength(tline, font=fi) / K < W - 196 - 70, '재료 줄이 너무 길어요: ' + tline
        ltext(d, 196, y, tline, fi, CH); y += 46
    d.line((k(120), k(916 + o), k(W - 120), k(916 + o)), fill=BE, width=k(2))
    fs, fn = F(GR, 31), F(CI, 38); y = 938 + o
    for i, tline in enumerate(rcp['steps']):
        assert d.textlength(tline, font=fs) / K < W - 150 - 70, '단계가 너무 길어요: ' + tline
        ltext(d, 112, y - 8, str(i + 1), fn, TOM_D); ltext(d, 150, y, tline, fs, CH); y += 48
    save_line(img, d, P1 - 64, F(GR, 32))
    img.resize((W, Hh), Image.LANCZOS).save(out)
    return out


if __name__ == '__main__':
    args = sys.argv[1:]
    if '--fonts' in args:
        i = args.index('--fonts'); FONT_DIR = args[i + 1]; del args[i:i + 2]
    tall = '--tall' in args; args = [a for a in args if a != '--tall']
    print(make_card(args[0], args[1], tall))
