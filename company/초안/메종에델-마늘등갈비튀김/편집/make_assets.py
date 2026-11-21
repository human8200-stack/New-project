import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = sys.argv[1]
FD = sys.argv[2]
os.makedirs(OUT, exist_ok=True)
W, H = 1080, 1920
KO = os.path.join(FD, 'GowunBatang-Bold.ttf')
EN = os.path.join(FD, 'CormorantGaramond-Italic.ttf')
SC = os.path.join(FD, 'PinyonScript.ttf')


def font(p, s):
    f = ImageFont.truetype(p, s)
    try:
        f.set_variation_by_name('Italic')
    except Exception:
        pass
    return f


def shadow_text(canvas, xy, text, fnt, fill=(255, 255, 255, 255), anchor='mm', blur=6, sh_alpha=110):
    sh = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(sh)
    d.text((xy[0] + 2, xy[1] + 3), text, font=fnt, fill=(0, 0, 0, sh_alpha), anchor=anchor)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(sh)
    ImageDraw.Draw(canvas).text(xy, text, font=fnt, fill=fill, anchor=anchor)


# 1) gradient (top/bottom soft dark layers) + watermark
g = Image.new('RGBA', (W, H), (0, 0, 0, 0))
px = g.load()
for y in range(H):
    a = 0
    if y < 420:
        a = int(70 * (1 - y / 420) ** 1.6)
    elif y > H - 640:
        a = int(85 * ((y - (H - 640)) / 640) ** 1.6)
    if a:
        for x in range(W):
            px[x, y] = (0, 0, 0, a)
wm = font(EN, 30)
ImageDraw.Draw(g).text((W - 48, H - 54), 'M A I S O N   E D E L', font=wm, fill=(255, 255, 255, 120), anchor='rs')
g.save(os.path.join(OUT, 'base.png'))

# 2) opening title (top)
t = Image.new('RGBA', (W, H), (0, 0, 0, 0))
shadow_text(t, (W // 2, 170), 'M A I S O N   E D E L', font(EN, 34))
shadow_text(t, (W // 2, 250), '마늘 등갈비 튀김', font(KO, 78))
shadow_text(t, (W // 2, 330), 'Garlic Fried Pork Ribs', font(EN, 50))
t.save(os.path.join(OUT, 'title.png'))

# 3) captions: insta (one Korean line) / youtube (Korean + English)
caps = {
    'c01': ('등갈비 800g', 'pork ribs 800g'),
    'c02': ('키친타월로 물기 닦기', 'pat dry with kitchen towel'),
    'c03': ('전분가루 5T', 'potato starch 5T'),
    'c04': ('포도씨유 1컵 · 180℃', 'grapeseed oil 1 cup · 180°C'),
    'c05': ('노릇하게 튀기기', 'fry until golden'),
    'c06': ('다진 마늘 3T', 'minced garlic 3T'),
    'c07': ('간장 2T', 'soy sauce 2T'),
    'c08': ('굴소스 1t · 맛술 1T', 'oyster sauce 1t · mirin 1T'),
    'c09': ('설탕 1T · 후추', 'sugar 1T · pepper'),
    'c10': ('소스 5단에서 버무리기', 'toss in the sauce · level 5'),
    'c11': ('다진 땅콩 · 깨', 'crushed peanuts · sesame'),
}
yb = int(H * 0.79)
for k, (ko, en) in caps.items():
    a = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    shadow_text(a, (W // 2, yb), ko, font(KO, 64))
    a.save(os.path.join(OUT, f'{k}-ig.png'))
    b = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    shadow_text(b, (W // 2, yb - 30), ko, font(KO, 60))
    shadow_text(b, (W // 2, yb + 45), en, font(EN, 48))
    b.save(os.path.join(OUT, f'{k}-yt.png'))

# 4) Bon appetit
b = Image.new('RGBA', (W, H), (0, 0, 0, 0))
shadow_text(b, (W // 2, int(H * 0.80)), 'Bon appétit', font(SC, 120), blur=8)
b.save(os.path.join(OUT, 'bon.png'))

# 5) recipe card
bg = Image.new('RGB', (W, H), (238, 230, 219))
d = ImageDraw.Draw(bg)
for y in range(H):  # soft vertical tone
    c = int(244 - 14 * y / H)
    d.line([(0, y), (W, y)], fill=(c, c - 7, c - 17))
card = Image.new('RGBA', (W, H), (0, 0, 0, 0))
dc = ImageDraw.Draw(card)
# header
dc.text((64, 86), 'M A I S O N   E D E L', font=font(EN, 30), fill=(120, 110, 98, 255), anchor='ls')
dc.text((W - 64, 86), 'Recipe No.08', font=font(EN, 40), fill=(120, 110, 98, 255), anchor='rs')
# simple garlic bulb illustration
ill = Image.new('RGBA', (W, H), (0, 0, 0, 0))
di = ImageDraw.Draw(ill)
cx, cy = W // 2, 520
di.ellipse((cx - 120, cy + 120, cx + 120, cy + 150), fill=(0, 0, 0, 40))
for dx, col in ((-70, (236, 228, 214, 255)), (70, (236, 228, 214, 255)), (0, (246, 240, 230, 255))):
    di.ellipse((cx + dx - 85, cy - 95, cx + dx + 85, cy + 135), fill=col, outline=(196, 182, 162, 255), width=3)
di.polygon([(cx - 22, cy - 80), (cx + 22, cy - 80), (cx + 8, cy - 190), (cx - 8, cy - 190)], fill=(232, 222, 205, 255), outline=(196, 182, 162, 255))
di.line([(cx - 30, cy + 132), (cx - 40, cy + 160)], fill=(170, 150, 120, 255), width=3)
di.line([(cx + 10, cy + 135), (cx + 14, cy + 165)], fill=(170, 150, 120, 255), width=3)
di.line([(cx + 40, cy + 130), (cx + 55, cy + 158)], fill=(170, 150, 120, 255), width=3)
card.alpha_composite(ill.filter(ImageFilter.GaussianBlur(0.6)))
# panel
panel_top, panel_bot = 800, 1700
sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(sh).rounded_rectangle((52, panel_top + 10, W - 52, panel_bot + 14), 36, fill=(0, 0, 0, 45))
card.alpha_composite(sh.filter(ImageFilter.GaussianBlur(16)))
dc = ImageDraw.Draw(card)
dc.rounded_rectangle((48, panel_top, W - 48, panel_bot), 36, fill=(245, 241, 235, 255))
dc.text((W // 2, panel_top + 105), '마늘 등갈비 튀김', font=font(KO, 82), fill=(62, 62, 62, 255), anchor='mm')
dc.text((W // 2, panel_top + 180), 'Garlic Fried Pork Ribs', font=font(EN, 46), fill=(140, 132, 120, 255), anchor='mm')
dc.line([(120, panel_top + 225), (W - 120, panel_top + 225)], fill=(222, 214, 202, 255), width=2)
ko34 = font(KO, 33)
dc.text((110, panel_top + 275), '재료', font=font(KO, 33), fill=(107, 114, 88, 255), anchor='ls')
ing = ['등갈비 800g · 전분가루 5T · 포도씨유 1컵',
       '[소스] 다진 마늘 3T · 간장 2T · 굴소스 1t',
       '맛술 1T · 설탕 1T · 후추 약간',
       '다진 땅콩 · 깨 약간']
for i, s in enumerate(ing):
    dc.text((200, panel_top + 275 + i * 46), s, font=ko34, fill=(62, 62, 62, 255), anchor='ls')
yl = panel_top + 275 + 4 * 46 - 10
dc.line([(120, yl), (W - 120, yl)], fill=(222, 214, 202, 255), width=2)
steps = ['찬물에 핏물을 빼고, 꺼내서 키친타월로 닦아요',
         '전분가루를 골고루 묻혀요',
         '웍에 포도씨유, 튀김모드 180℃로 노릇하게 튀겨요',
         '건져내고 기름은 따라 버려요',
         '소스를 5단에서 끓이고 등갈비를 넣어 섞어요',
         '다진 땅콩과 깨를 뿌려 완성해요']
for i, s in enumerate(steps):
    y = yl + 60 + i * 50
    dc.text((112, y), str(i + 1), font=font(EN, 40), fill=(160, 90, 80, 255), anchor='ls')
    dc.text((152, y), s, font=ko34, fill=(62, 62, 62, 255), anchor='ls')
dc.text((W // 2, panel_bot - 50), '저장해 두세요', font=font(KO, 34), fill=(90, 90, 90, 255), anchor='mm')
bg = bg.convert('RGBA')
bg.alpha_composite(card)
bg.convert('RGB').save(os.path.join(OUT, 'card.png'))
print('ok')
