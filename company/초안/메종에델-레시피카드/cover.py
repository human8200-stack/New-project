"""메종 에델 표지 ('에델의 부엌 일기' 틀, 봉순이식) — 크레딧 0.

틀은 매 편 같고, 사진만 그날 이야기 장면으로 바꾼다.
  위: "○○한 날" (작고 차분하게, 고운바탕)   아래: 고정 한 줄 "에델의 부엌 일기 · No.○○"
  A안(기본, 회장님 11/8 확정 결재 92) = 아래 아이보리 띠 안에 고정 한 줄, 제목은 왼쪽 정렬 / B안 = 사진 위 은은한 그림자 띠만
크기 1080x1920 (인스타 릴스 표지·유튜브 쇼츠 썸네일). 글자는 프로필 격자(가운데 3:4 = 위 240~1680) 안에만.

쓰는 법:
  python3 -I cover.py <사진> "<○○한 날>" <번호> <A|B> <저장.jpg> [--fonts 글꼴폴더]
  예) python3 -I cover.py 12.png "비 오는 날, 크림 카레 당면 끓인 날" 05 A 표지-A.jpg
  C안) python3 -I cover.py C 12.png "비 오는 날엔" "크림카레 당면" 05 표지-C.jpg 150 250 620
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import sys, os

W, H = 1080, 1920
GRID_TOP, GRID_BOT = 240, 1680
IV = (248, 246, 242); TA = (168, 154, 138); OL = (107, 114, 88); CH = (62, 62, 62)
FONT_DIR = '/tmp/claude-0/-home-user/020f0925-2716-5554-b1a3-06e5bb251207/scratchpad/ref/'


def F(name, s): return ImageFont.truetype(os.path.join(FONT_DIR, name), s)


def fit_cover(src):
    im = Image.open(src).convert('RGB')
    s = max(W / im.width, H / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x = (im.width - W) // 2; y = (im.height - H) // 2
    return im.crop((x, y, x + W, y + H))


def shade(img, y0, y1, top_alpha, bot_alpha):
    """y0~y1 사이에 위→아래로 투명도가 바뀌는 어두운 띠"""
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0)); d = ImageDraw.Draw(layer)
    for y in range(y0, y1):
        t = (y - y0) / max(1, y1 - y0 - 1)
        a = int(top_alpha + (bot_alpha - top_alpha) * t)
        d.line([(0, y), (W, y)], fill=(40, 34, 30, a))
    return Image.alpha_composite(img.convert('RGBA'), layer)


def text_c(d, y, t, f, fill, shadow=None):
    w = d.textlength(t, font=f); x = (W - w) / 2
    if shadow:
        d.text((x + 2, y + 2), t, font=f, fill=shadow)
    d.text((x, y), t, font=f, fill=fill)


def soft_text(img, y, t, f, fill, x=None):
    """흰 글자 + 아주 엷은 번진 그림자 (노션 화면 글자 스타일). x가 없으면 가운데"""
    if x is None:
        x = (W - ImageDraw.Draw(img).textlength(t, font=f)) / 2
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).text((x, y + 2), t, font=f, fill=(0, 0, 0, 120))
    img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(4)))
    ImageDraw.Draw(img).text((x, y), t, font=f, fill=fill)
    return img


def make(src, title, no, style='A', out='표지.jpg', title_x=60, title_max=700):
    """style 기본 = A(회장님 11/8 확정, 결재 92). title_x=None이면 가운데, 숫자면 왼쪽 정렬 시작점
    (사진 속 손·젓가락과 겹치지 않게 왼쪽으로 — 매 편 사진을 보고 title_max로 폭을 조절)"""
    img = fit_cover(src).convert('RGBA')
    ft = F('GowunBatang-Regular.ttf', 54)
    limit = (W - 140) if title_x is None else title_max
    while ImageDraw.Draw(img).textlength(title, font=ft) > limit:
        ft = F('GowunBatang-Regular.ttf', ft.size - 2)
    fixed_ko, fixed_no = '에델의 부엌 일기', 'No.' + no
    # 위: 제목 (격자 안, 위에서 약 270px)
    img = shade(img, 0, 560, 150, 0)
    img = soft_text(img, 272, title, ft, (255, 255, 255, 255), title_x)
    img = soft_text(img, 352, 'M A I S O N   E D E L', F('CormorantGaramond-Medium.ttf', 24), (245, 240, 232, 230), None if title_x is None else title_x + 4)
    fk = F('GowunBatang-Bold.ttf', 40); fn = F('CormorantGaramond-Italic.ttf', 46); fd = F('GowunBatang-Regular.ttf', 40)
    if style == 'A':
        # 아래 아이보리 띠 (격자 안 1500~1680 + 그 아래까지)
        band = Image.new('RGBA', img.size, (0, 0, 0, 0)); bd = ImageDraw.Draw(band)
        bd.rectangle((0, 1500, W, H), fill=IV + (245,))
        bd.line((0, 1500, W, 1500), fill=TA + (255,), width=2)
        img = Image.alpha_composite(img, band)
        d = ImageDraw.Draw(img)
        sep = '  ·  '
        w = d.textlength(fixed_ko, font=fk) + d.textlength(sep, font=fd) + d.textlength(fixed_no, font=fn)
        x = (W - w) / 2; y = 1560
        d.text((x, y), fixed_ko, font=fk, fill=CH); x += d.textlength(fixed_ko, font=fk)
        d.text((x, y), sep, font=fd, fill=TA); x += d.textlength(sep, font=fd)
        d.text((x, y - 6), fixed_no, font=fn, fill=OL)
    else:
        img = shade(img, 1380, H, 0, 170)
        sep = '  ·  '
        d = ImageDraw.Draw(img)
        w = d.textlength(fixed_ko, font=fk) + d.textlength(sep, font=fd) + d.textlength(fixed_no, font=fn)
        x0 = (W - w) / 2; y = 1570
        sh = Image.new('RGBA', img.size, (0, 0, 0, 0)); sd = ImageDraw.Draw(sh)
        x = x0
        for t, f, dy in [(fixed_ko, fk, 0), (sep, fd, 0), (fixed_no, fn, -6)]:
            sd.text((x, y + dy + 2), t, font=f, fill=(0, 0, 0, 130)); x += sd.textlength(t, font=f)
        img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(4)))
        d = ImageDraw.Draw(img); x = x0
        for t, f, dy, c in [(fixed_ko, fk, 0, (255, 255, 255)), (sep, fd, 0, (235, 228, 218)), (fixed_no, fn, -6, (240, 236, 226))]:
            d.text((x, y + dy), t, font=f, fill=c); x += d.textlength(t, font=f)
    img.convert('RGB').save(out, quality=93)
    return out


# ---- C안 (11/9, kr_cookman·봉순이 참고): 음식이 화면 가득 + 가운데 아래 굵은 두 줄 + 맨 아래 작은 고정 한 줄 ----
C_L1_Y, C_L2_Y, C_FIX_Y = 1235, 1350, 1600     # 매 편 같은 자리 (격자 3:4 = 위 240~1680 안)
C_L1_SIZE, C_L2_SIZE = 96, 138                  # 고운바탕 Bold. 둘째 줄 글자 높이 약 120px


def crop_cover(src, box):
    """box = (x, y, w): 원본에서 9:16으로 더 가까이 잘라 1080x1920으로"""
    im = Image.open(src).convert('RGB'); x, y, w = box; h = round(w * 16 / 9)
    return im.crop((x, y, x + w, y + h)).resize((W, H), Image.LANCZOS)


def make_c(src, line1, line2, no, out='표지-C.jpg', box=None):
    img = (crop_cover(src, box) if box else fit_cover(src)).convert('RGBA')
    img = shade(img, 1000, H, 0, 175)
    d = ImageDraw.Draw(img)
    f1 = F('GowunBatang-Bold.ttf', C_L1_SIZE); f2 = F('GowunBatang-Bold.ttf', C_L2_SIZE)
    while d.textlength(line2, font=f2) > W - 90:
        f2 = F('GowunBatang-Bold.ttf', f2.size - 4)
    img = soft_text(img, C_L1_Y, line1, f1, (255, 255, 255, 255))
    img = soft_text(img, C_L2_Y, line2, f2, (255, 255, 255, 255))
    img = soft_text(img, C_FIX_Y, '에델의 부엌 일기  ·  No.' + no, F('GowunBatang-Regular.ttf', 38), (245, 240, 232, 235))
    img.convert('RGB').save(out, quality=93)
    return out


if __name__ == '__main__':
    a = sys.argv[1:]
    if '--fonts' in a:
        i = a.index('--fonts'); FONT_DIR = a[i + 1]; del a[i:i + 2]
    # 쓰는 법: cover.py <사진> "<○○한 날>" <번호> [A|B] [저장.jpg]   (기본 A, 제목 왼쪽 정렬)
    # C안: cover.py C <사진> "<첫 줄>" "<둘째 줄>" <번호> <저장.jpg> [x y w]
    if a[0] == 'C':
        box = tuple(int(v) for v in a[6:9]) if len(a) >= 9 else None
        print(make_c(a[1], a[2], a[3], a[4], a[5], box))
    else:
        print(make(a[0], a[1], a[2], a[3] if len(a) > 3 else 'A', a[4] if len(a) > 4 else '표지.jpg'))
