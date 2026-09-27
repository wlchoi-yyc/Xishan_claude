# 預告片畫面：以六張參考圖（shots/）做鏡頭推移、光束、雲霧、粒子與調色，加上文字動畫
# 輸出 1920x1080 30fps 原始影格到 stdout；python3 video.py still 12.5 可輸出單格預覽
import os
import sys
import math
from functools import lru_cache
from multiprocessing import Pool

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1920, 1080
FPS = 30
DUR = 102.0
BAR = 110  # 電影遮幅黑邊
HERE = os.path.dirname(os.path.abspath(__file__))
FONT_DIR = os.path.join(HERE, 'fonts')
SERIF = os.path.join(FONT_DIR, 'NotoSerifTC.ttf')
KAI = os.path.join(FONT_DIR, 'WenKaiBold.ttf')
KAI_R = os.path.join(FONT_DIR, 'WenKai.ttf')


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def lerp(a, b, k):
    return a + (b - a) * k


# ---------------- 鏡頭素材 ----------------
# shots/*.jpg 由 ref/reference.png 的六格參考圖切出，經 EDSR x3 超解像放大（見 upscale.py）
SHOT_DIR = os.path.join(HERE, 'shots')


@lru_cache(None)
def photo(name):
    return Image.open(os.path.join(SHOT_DIR, name + '.jpg')).convert('RGB')


def cam(name, cx, cy, z, rot=0.0):
    """以來源比例座標 (cx, cy) 為中心、放大 z 倍取景，回傳 0~1 的 float 陣列"""
    im = photo(name)
    sw, sh = im.size
    z = max(1.0, z)
    half = 0.5 / z
    cx = min(max(cx, half), 1 - half)
    cy = min(max(cy, half), 1 - half)
    s = sw / z / W  # 每個輸出像素對應的來源像素
    if rot:
        c, si = math.cos(rot) * s, math.sin(rot) * s
        a, b, d, e = c, -si, si, c
    else:
        a, b, d, e = s, 0, 0, s
    x0 = cx * sw - (a * W / 2 + b * H / 2)
    y0 = cy * sh - (d * W / 2 + e * H / 2)
    out = im.transform((W, H), Image.AFFINE, (a, b, x0, d, e, y0), resample=Image.BICUBIC)
    return np.asarray(out, np.float32) / 255.0


def move(name, t, t0, t1, a, b, ease=True, shake=0.0, rot=(0.0, 0.0)):
    """a, b = (cx, cy, z)：由 a 推移到 b"""
    k = (t - t0) / (t1 - t0)
    k = smooth(k) * 0.6 + k * 0.4 if ease else k
    cx, cy, z = (lerp(a[i], b[i], k) for i in range(3))
    if shake:
        cx += shake * (math.sin(t * 37) + 0.5 * math.sin(t * 91)) / z
        cy += shake * (math.cos(t * 29) + 0.5 * math.sin(t * 73)) / z
    return cam(name, cx, cy, z, lerp(rot[0], rot[1], k))


def grade(img, exp=1.0, sat=1.0, temp=0.0, contrast=1.0, tint=(1, 1, 1), lift=0.0):
    img = img * exp
    lum = (img[..., :1] * 0.3 + img[..., 1:2] * 0.59 + img[..., 2:3] * 0.11)
    img = lum + (img - lum) * sat
    if temp:
        img = img * np.array([1 + temp, 1 + temp * 0.2, 1 - temp], np.float32)
    if contrast != 1.0:
        img = (img - 0.45) * contrast + 0.45
    img = img * np.array(tint, np.float32) + lift
    return np.clip(img, 0, 1.2)


def mblur(img, amount):
    """橫向動態模糊（快速轉場用）"""
    if amount < 2:
        return img
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    im = im.resize((max(8, int(W / amount)), H), Image.BILINEAR).resize((W, H), Image.BILINEAR)
    return np.asarray(im, np.float32) / 255.0


def gblur(img, r):
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    small = im.resize((W // 4, H // 4), Image.BILINEAR).filter(ImageFilter.GaussianBlur(r / 4))
    return np.asarray(small.resize((W, H), Image.BILINEAR), np.float32) / 255.0


def noise2d(w, h, sx, sy, rng):
    small = rng.random((max(2, int(h / sy)), max(2, int(w / sx)))).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(im, np.float32) / 255.0


@lru_cache(None)
def mist_tex(seed):
    rng = np.random.default_rng(seed)
    w = W * 2
    n = noise2d(w, H, 260, 90, rng) * 0.6 + noise2d(w, H, 90, 35, rng) * 0.4
    return np.clip(n * 1.8 - 0.55, 0, 1)


def mist(img, t, y0, thick, strength, color=(1, 1, 1), speed=40.0, seed=1):
    tex = mist_tex(seed)
    off = int(t * speed) % W
    a = tex[:, off:off + W]
    band = np.exp(-((_yy - H * y0) / (H * thick)) ** 2)
    a = (a * band * strength)[..., None]
    img *= 1 - a
    img += a * np.array(color, np.float32)


# 光束：以低解像度計算角度噪聲再放大
_ly, _lx = np.mgrid[0:H // 6, 0:W // 6].astype(np.float32) * 6
_ray_rng = np.random.default_rng(5)
_RAY_K = _ray_rng.integers(5, 60, 12)
_RAY_P = _ray_rng.uniform(0, 6.28, 12)


def rays(img, sx, sy, t, color, strength, reach=900.0):
    ang = np.arctan2(_ly - sy, _lx - sx)
    v = np.zeros_like(ang)
    for k, p in zip(_RAY_K, _RAY_P):
        v += np.sin(ang * k + p + t * 0.15 * (1 if k % 2 else -1))
    v = np.clip(v / 4, 0, 1) ** 2
    dist = np.sqrt((_lx - sx) ** 2 + (_ly - sy) ** 2)
    v *= np.exp(-dist / reach)
    im = Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(3)), np.float32)[..., None] / 255.0
    img += a * np.array(color, np.float32) * strength


def darken_from_top(img, k, soft=0.35):
    """暮色「自遠而至」：畫面上方（遠處）先暗"""
    front = lerp(-soft, 1 + soft, k)
    m = np.clip((front - _yy / H) / soft, 0, 1)[..., None]
    night = grade(img, exp=0.35, sat=0.5, temp=-0.25, tint=(0.8, 0.85, 1.15))
    return img * (1 - m) + night * m


# ---------------- 特效 ----------------
_yy, _xx = np.mgrid[0:H, 0:W].astype(np.float32)
VIGNETTE = (1 - 0.55 * (((_xx - W / 2) / (W / 2)) ** 2 + ((_yy - H / 2) / (H / 2)) ** 2) ** 1.3 / 2 ** 1.3)[..., None]
GRAIN = [np.random.default_rng(i).normal(0, 1, (H // 2, W // 2)).astype(np.float32) for i in range(6)]


def grain(t):
    g = GRAIN[int(t * FPS) % len(GRAIN)]
    return np.repeat(np.repeat(g, 2, 0), 2, 1)[..., None]


def add_glow(img, x, y, r, color, strength):
    d2 = ((_xx - x) ** 2 + (_yy - y) ** 2) / (r * r)
    g = np.exp(-d2)[..., None] * strength
    core = np.exp(-d2 * 30)[..., None] * strength
    img += (g * 0.6 + core) * np.array(color, np.float32)


def particles(img, t, kind, seed=0, n=260, strength=1.0):
    rng = np.random.default_rng(seed)
    over = Image.new('L', (W, H), 0)
    dr = ImageDraw.Draw(over)
    if kind == 'rain':
        x0 = rng.uniform(-200, W, n)
        y0 = rng.uniform(0, H, n)
        sp = rng.uniform(1400, 2200, n)
        for i in range(n):
            y = (y0[i] + t * sp[i]) % (H + 200) - 100
            x = x0[i] + (y - y0[i]) * 0.12
            dr.line([(x, y), (x + 6, y + 50)], fill=int(90 * strength), width=1)
        col = np.array([0.7, 0.75, 0.8], np.float32)
    elif kind == 'embers':
        x0 = rng.uniform(0, W, n)
        y0 = rng.uniform(0, H, n)
        sp = rng.uniform(80, 260, n)
        for i in range(n):
            y = (y0[i] - t * sp[i]) % (H + 40)
            x = x0[i] + 30 * math.sin(t * 2 + i)
            r = 1.5 + (i % 3)
            dr.ellipse([x - r, y - r, x + r, y + r], fill=int(255 * strength))
        over = over.filter(ImageFilter.GaussianBlur(1.5))
        col = np.array([1.0, 0.55, 0.15], np.float32) * 1.6
    elif kind == 'stars':
        x0 = rng.uniform(0, W, n)
        y0 = rng.uniform(0, H * 0.6, n)
        for i in range(n):
            tw = 0.5 + 0.5 * math.sin(t * (1 + i % 5) + i)
            r = 0.8 + (i % 4 == 0) * 1.0
            dr.ellipse([x0[i] - r, y0[i] - r, x0[i] + r, y0[i] + r], fill=int(255 * tw * strength))
        col = np.array([0.85, 0.9, 1.0], np.float32)
    elif kind == 'dust':
        x0 = rng.uniform(0, W, n)
        y0 = rng.uniform(0, H, n)
        for i in range(n):
            x = (x0[i] + t * (20 + i % 30)) % W
            y = (y0[i] + 15 * math.sin(t * 0.7 + i)) % H
            r = 1 + (i % 3)
            dr.ellipse([x - r, y - r, x + r, y + r], fill=int(150 * strength))
        over = over.filter(ImageFilter.GaussianBlur(1.2))
        col = np.array([1.0, 0.9, 0.75], np.float32)
    a = np.asarray(over, np.float32)[..., None] / 255.0
    img += a * col


# ---------------- 文字 ----------------

@lru_cache(None)
def font(path, size, weight=None):
    f = ImageFont.truetype(path, size)
    if weight:
        f.set_variation_by_axes([weight])
    return f


@lru_cache(512)
def text_img(text, path, size, color, track=0.0, weight=None, glow=0, glow_col=None, gradient=None):
    f = font(path, size, weight)
    chars = list(text)
    widths = [f.getlength(c) for c in chars]
    sp = size * track
    tw = sum(widths) + sp * (len(chars) - 1)
    pad = int(size * 0.8) + glow * 3
    w = int(tw + pad * 2)
    h = int(size * 1.5 + pad * 2)
    mask = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(mask)
    x = pad
    for c, cw in zip(chars, widths):
        d.text((x, pad), c, font=f, fill=255)
        x += cw + sp
    m = np.asarray(mask, np.float32) / 255.0
    rgb = np.zeros((h, w, 3), np.float32)
    if gradient:
        ys = np.linspace(0, 1, h)[:, None]
        for c in range(3):
            rgb[..., c] = np.interp(ys, [0.3, 0.5, 0.62, 0.75], [gradient[0][c], gradient[1][c], gradient[2][c],
                                                                gradient[3][c]])[:, :1] / 255.0
    else:
        rgb[:] = np.array(color, np.float32) / 255.0
    # 暗影
    sh = np.asarray(mask.filter(ImageFilter.GaussianBlur(max(4, size // 10))), np.float32) / 255.0
    sh = np.clip(sh * 1.3, 0, 1) * 0.55
    rgb = rgb * m[..., None]
    a = m
    if glow:
        gm = np.asarray(mask.filter(ImageFilter.GaussianBlur(glow)), np.float32) / 255.0
        gc = np.array(glow_col or color, np.float32) / 255.0
        a_g = np.clip(gm * 1.6, 0, 1)
        rgb = rgb + gc * a_g[..., None] * 0.9 * (1 - m[..., None])
        a = np.clip(m + a_g * 0.9 * (1 - m), 0, 1)
    # 合成暗影（在字與光暈之下）
    a_all = a + sh * (1 - a)
    rgb = rgb / np.maximum(a_all[..., None], 1e-4)
    a = a_all
    blur = Image.fromarray((np.dstack([np.clip(rgb, 0, 1), a]) * 255).astype(np.uint8), 'RGBA')
    return blur


_blur_cache = {}


def blur_of(im, r):
    k = (id(im), r)
    if k not in _blur_cache:
        _blur_cache[k] = im.filter(ImageFilter.GaussianBlur(r))
    return _blur_cache[k]


def draw_text(img, t, t0, t1, text, path, size, color=(240, 236, 228), y=0.5, track=0.12, weight=None,
              fin=0.6, fout=0.5, zoom=(1.0, 1.05), blur_in=True, glow=0, glow_col=None, gradient=None, x=0.5,
              punch=False, alpha=1.0):
    if t < t0 or t > t1:
        return
    lt = t - t0
    d = t1 - t0
    a = smooth(lt / fin) if fin > 0 else 1.0
    if fout > 0:
        a *= smooth((t1 - t) / fout)
    a *= alpha
    if a <= 0.003:
        return
    k = lt / d
    s = lerp(zoom[0], zoom[1], k)
    if punch:
        s *= 1 + 0.25 * math.exp(-lt * 9)
    im = text_img(text, path, size, color, track, weight, glow, glow_col, gradient)
    if blur_in and lt < fin:
        r = (1 - smooth(lt / fin)) * 14
        if r > 0.8:
            im = blur_of(im, int(r))
    if abs(s - 1) > 0.002:
        im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.BILINEAR)
    arr = np.asarray(im, np.float32) / 255.0
    px = int(W * x - im.width / 2)
    py = int(H * y - im.height / 2)
    _blit(img, arr, px, py, a)


def _blit(img, arr, px, py, a):
    h, w = arr.shape[:2]
    x0, y0 = max(0, px), max(0, py)
    x1, y1 = min(W, px + w), min(H, py + h)
    if x1 <= x0 or y1 <= y0:
        return
    sub = arr[y0 - py:y1 - py, x0 - px:x1 - px]
    al = sub[..., 3:4] * a
    img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - al) + sub[..., :3] * al


def seal(img, t, t0, t1, char, x, y, size=90):
    if t < t0 or t > t1:
        return
    a = smooth((t - t0) / 0.3) * smooth((t1 - t) / 0.5)
    s = 1 + 0.6 * math.exp(-(t - t0) * 14)
    box = int(size * 1.25)
    im = Image.new('RGBA', (box, box), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([2, 2, box - 3, box - 3], radius=10, fill=(178, 34, 28, 255))
    f = font(KAI, int(size * 0.8))
    d.text((box / 2, box / 2), char, font=f, fill=(248, 232, 215, 255), anchor='mm')
    # 印泥斑駁
    n = np.random.default_rng(3).random((box, box))
    arr = np.asarray(im, np.float32) / 255.0
    arr[..., 3] *= (n > 0.08)
    sz = int(box * s)
    im2 = Image.fromarray((arr * 255).astype(np.uint8), 'RGBA').resize((sz, sz), Image.BILINEAR)
    _blit(img, np.asarray(im2, np.float32) / 255.0, int(W * x - sz / 2), int(H * y - sz / 2), a)


# ---------------- 分鏡 ----------------
WHITE = (242, 238, 230)
GREY = (175, 172, 165)
GOLD = (240, 205, 140)
FLASHES = [7.5, 22.0, 23.2, 24.4, 25.6, 26.8, 28.0, 29.2, 38.0, 51.0, 52.2, 53.4, 54.6, 58.2, 85.0]


MONTAGE = [  # 上高山、入深林、窮迴谿、幽泉怪石、無遠不到、披草而坐、傾壺而醉
    ('climb', (0.80, 0.34, 1.8), (0.78, 0.24, 1.95), dict(temp=0.05)),
    ('bamboo', (0.25, 0.30, 1.7), (0.38, 0.30, 1.8), dict(exp=1.25, sat=0.9)),
    ('pavilion', (0.80, 0.72, 1.9), (0.70, 0.70, 2.0), dict()),
    ('boat', (0.68, 0.30, 1.9), (0.60, 0.32, 2.0), dict()),
    ('summit', (0.45, 0.55, 1.3), (0.45, 0.55, 1.15), dict()),
    ('dusk', (0.84, 0.62, 2.0), (0.84, 0.60, 1.8), dict(exp=1.15)),
    ('dusk', (0.76, 0.52, 2.5), (0.77, 0.52, 2.2), dict(exp=1.2, temp=0.12)),
]


def scene_bg(t):
    if t < 3.0:
        return None
    if t < 7.5:
        # 長安新星：金光燦爛
        lt = t - 3.0
        img = move('summit', t, 3.0, 7.5, (0.42, 0.34, 2.2), (0.42, 0.36, 1.7))
        img = grade(img, exp=1.05, sat=1.1, temp=0.08)
        rays(img, W * 0.5, H * 0.3, t, (1.0, 0.8, 0.5), 0.35)
        return img * smooth(lt / 1.5)
    if t < 11.5:
        # 被貶千里：竹林冷雨
        img = move('bamboo', t, 7.5, 11.5, (0.5, 0.52, 1.1), (0.5, 0.58, 1.35))
        img = grade(img, exp=0.85, sat=0.45, temp=-0.12, contrast=1.1)
        mist(img, t, 0.75, 0.25, 0.35, (0.6, 0.66, 0.72), 30, 1)
        particles(img, t, 'rain', 1, 380, 0.9)
        return img
    if t < 16.6:
        # 恆惴慄：逼近孤身背影
        img = move('bamboo', t, 11.5, 16.6, (0.5, 0.56, 2.2), (0.5, 0.58, 2.6), shake=0.0015)
        img = grade(img, exp=0.7, sat=0.35, temp=-0.15, contrast=1.15)
        particles(img, t, 'rain', 2, 260, 0.6)
        return img
    if t < 22.0:
        # 開始遊走：舟行江上
        img = move('boat', t, 16.6, 22.0, (0.30, 0.52, 1.35), (0.55, 0.48, 1.1))
        img = grade(img, exp=1.0, sat=0.8, temp=0.03)
        mist(img, t, 0.55, 0.18, 0.45, (0.92, 0.93, 0.95), 55, 2)
        return img
    if t < 30.4:
        idx = min(6, int((t - 22.0) / 1.2))
        t0 = 22.0 + idx * 1.2
        name, a, b, g = MONTAGE[idx]
        img = grade(move(name, t, t0, t0 + 1.2, a, b, ease=False), **g)
        lt = t - t0
        if lt < 0.12:
            img = mblur(img, 40 * (1 - lt / 0.12))
        return img
    if t < 33.0:
        # 醉臥夢中
        lt = t - 30.4
        img = move('dusk', t, 30.4, 33.0, (0.7, 0.5, 1.5), (0.7, 0.5, 1.7), rot=(0.0, 0.02))
        img = grade(gblur(img, 10 + 6 * math.sin(lt * 2)), exp=1.15, sat=0.7, tint=(1.08, 0.92, 1.02))
        particles(img, t, 'dust', 5, 140, 0.8)
        return img
    if t < 38.0:
        # 以為看遍了：拉遠
        img = move('boat', t, 33.0, 38.0, (0.6, 0.45, 1.6), (0.5, 0.5, 1.0))
        img = grade(img, exp=0.95, sat=0.55, temp=0.02)
        mist(img, t, 0.5, 0.2, 0.3, (0.9, 0.9, 0.9), 35, 3)
        return img
    if t < 43.5:
        img = np.zeros((H, W, 3), np.float32)
        if 39.0 < t < 43.3:
            # 驚鴻一瞥：幽暗中浮現的怪特之山
            k = smooth((t - 39.0) / 2.5) * smooth((43.3 - t) / 0.8)
            p = move('pavilion', t, 39.0, 43.3, (0.63, 0.40, 2.1), (0.63, 0.38, 1.8))
            img = grade(p, exp=0.4, sat=0.3, temp=-0.05, contrast=1.3) * k
        return img
    if t < 47.0:
        img = np.zeros((H, W, 3), np.float32)
        k = smooth((t - 43.5) / 3.5)
        d = np.sqrt((_xx - W / 2) ** 2 + ((_yy - H / 2) * 1.6) ** 2)
        img += (np.exp(-(d / (200 + 600 * k)) ** 2) * 0.07 * k)[..., None] * np.array([1, 0.95, 0.85])
        return img
    if t < 51.0:
        # 坐法華西亭，望西山：由人物背影推向遠山
        lt = t - 47.0
        img = move('pavilion', t, 47.0, 51.0, (0.40, 0.55, 1.25), (0.58, 0.45, 1.6))
        img = grade(img, exp=1.05, sat=1.05, temp=0.05)
        rays(img, W * 0.75, H * 0.05, t, (1.0, 0.85, 0.6), 0.45)
        return img * smooth(lt / 1.0)
    if t < 52.2:
        img = move('boat', t, 51.0, 52.2, (0.35, 0.72, 1.6), (0.25, 0.68, 1.9), ease=False)
        return grade(img, exp=1.0, sat=0.95)
    if t < 53.4:
        img = move('climb', t, 52.2, 53.4, (0.30, 0.58, 1.5), (0.36, 0.56, 1.7), ease=False, shake=0.004)
        return grade(img, sat=0.95, contrast=1.1)
    if t < 54.6:
        img = move('climb', t, 53.4, 54.6, (0.65, 0.70, 1.7), (0.60, 0.68, 1.9), ease=False, shake=0.005)
        img = grade(img, exp=0.8, sat=0.6, tint=(1.35, 0.8, 0.45), contrast=1.2)
        particles(img, t, 'embers', 7, 260, 1.0)
        add_glow(img, W * 0.5, H * 1.05, 700, (1.0, 0.4, 0.1), 0.5)
        return img
    if t < 58.2:
        # 窮山之高：仰望峭壁，鏡頭上搖
        k = (t - 54.6) / 3.6
        img = move('climb', t, 54.6, 58.2, (0.83, 0.62, 2.2), (0.83, 0.22, 2.0), shake=0.001)
        img = grade(img, exp=1.0 + 0.3 * k, sat=1.0, temp=0.06)
        rays(img, W * 0.8, -H * 0.1, t, (1.0, 0.9, 0.7), 0.35 * k)
        if t > 57.6:
            img *= 1 - smooth((t - 57.6) / 0.3)
        return img
    if t < 61.5:
        # 登頂：全景
        img = move('summit', t, 58.2, 61.5, (0.6, 0.45, 1.35), (0.55, 0.5, 1.1))
        img = grade(img, exp=1.05, sat=1.1, temp=0.04)
        rays(img, W * 0.42, H * 0.28, t, (1.0, 0.8, 0.5), 0.3)
        mist(img, t, 0.8, 0.2, 0.25, (1.0, 0.92, 0.82), 25, 4)
        return img
    if t < 65.5:
        # 數州之土壤，皆在衽席之下：俯瞰雲海
        img = move('summit', t, 61.5, 65.5, (0.18, 0.70, 1.8), (0.42, 0.72, 1.6))
        img = grade(img, exp=1.05, sat=1.1, temp=0.05)
        mist(img, t, 0.7, 0.3, 0.35, (1.0, 0.93, 0.85), 45, 5)
        return img
    if t < 70.5:
        # 悠悠乎、洋洋乎：從人物背影拉遠
        img = move('summit', t, 65.5, 70.5, (0.80, 0.40, 2.0), (0.5, 0.5, 1.0))
        img = grade(img, exp=1.05, sat=1.1, temp=0.06)
        rays(img, W * 0.42, H * 0.28, t, (1.0, 0.8, 0.5), 0.3 * smooth((t - 65.5) / 3))
        particles(img, t, 'dust', 9, 90, 0.5)
        return img
    if t < 75.0:
        # 蒼然暮色，自遠而至
        k = smooth((t - 70.5) / 4.5)
        img = move('dusk', t, 70.5, 75.0, (0.55, 0.45, 1.1), (0.62, 0.5, 1.25))
        img = grade(img, exp=1.05, sat=1.05)
        return darken_from_top(img, k * 0.85)
    if t < 84.0:
        # 夜：心凝形釋
        k = smooth((t - 75.0) / 2.0)
        img = move('dusk', t, 75.0, 84.0, (0.60, 0.50, 1.3), (0.63, 0.52, 1.45))
        img = grade(img, exp=lerp(0.55, 0.45, k), sat=0.55, temp=-0.25, tint=(0.8, 0.88, 1.2), contrast=1.1)
        sky_mask = np.clip((H * 0.42 - _yy) / (H * 0.1), 0, 1)[..., None]
        stars = np.zeros_like(img)
        particles(stars, t, 'stars', 11, 420, k)
        img += stars * sky_mask
        add_glow(img, W * 0.2, H * 0.2, 160, (0.8, 0.88, 1.0), 0.35 * k)
        mist(img, t, 0.68, 0.15, 0.3 * k, (0.5, 0.58, 0.75), 20, 6)
        if t > 83.0:
            img *= 1 - smooth((t - 83.0) / 1.0)
        return img
    if t < 85.0:
        return np.zeros((H, W, 3), np.float32)
    if t < 98.0:
        img = move('summit', t, 85.0, 98.0, (0.5, 0.5, 1.25), (0.5, 0.5, 1.05))
        img = grade(gblur(img, 6), exp=0.32, sat=0.7, temp=0.1)
        particles(img, t, 'dust', 13, 140, 0.6)
        if t > 97.0:
            img *= 1 - smooth((t - 97.0) / 1.0)
        return img
    return np.zeros((H, W, 3), np.float32)


def overlay_text(img, t):
    S, K, KR = SERIF, KAI, KAI_R
    # 開場
    draw_text(img, t, 1.2, 3.4, '唐 · 永貞元年', S, 40, GREY, y=0.5, track=0.5, weight=400)
    draw_text(img, t, 3.6, 7.3, '他，曾是長安最耀眼的新星', S, 64, WHITE, weight=600)
    draw_text(img, t, 7.5, 11.3, '一夜之間　被貶千里', S, 92, WHITE, y=0.34, weight=900, fin=0.15, zoom=(1.08, 1.0),
              punch=True, glow=10, glow_col=(120, 140, 170))
    draw_text(img, t, 8.4, 11.3, '永州司馬', S, 40, GREY, y=0.45, track=0.6, weight=500)
    # 原文一
    draw_text(img, t, 11.8, 16.4, '自余為僇人，居是州，恆惴慄。', K, 84, WHITE, y=0.28, track=0.08)
    draw_text(img, t, 12.6, 16.4, '自從我成了罪人，住在這裏，常常憂懼不安', S, 34, GREY, y=0.39, weight=400)
    # 遊走
    draw_text(img, t, 16.8, 21.8, '於是，他開始漫無目的地遊走', S, 60, WHITE, weight=600)
    draw_text(img, t, 17.6, 21.8, '施施而行　漫漫而遊', K, 44, GOLD, y=0.62, track=0.3)
    words = [('上高山', 22.0), ('入深林', 23.2), ('窮迴谿', 24.4), ('幽泉怪石', 25.6), ('無遠不到', 26.8),
             ('披草而坐', 28.0), ('傾壺而醉', 29.2)]
    for w, t0 in words:
        draw_text(img, t, t0, t0 + 1.2, w, K, 150, WHITE, track=0.18, fin=0.08, fout=0.15, zoom=(1.0, 1.06),
                  punch=True, blur_in=False, glow=12, glow_col=(60, 50, 40))
    draw_text(img, t, 30.5, 33.0, '醉則更相枕以臥，臥而夢', K, 70, (250, 235, 235), track=0.1, fin=0.8,
              glow=16, glow_col=(200, 150, 160))
    # 以為看遍
    draw_text(img, t, 33.2, 37.9, '他以為，永州的山水，他都看遍了', S, 60, WHITE, weight=600, y=0.46)
    draw_text(img, t, 34.0, 37.9, '以為凡是州之山水有異態者，皆我有也', K, 40, GOLD, y=0.6, track=0.1)
    # 轉折
    draw_text(img, t, 38.0, 40.4, '而未始知——', K, 64, GREY, y=0.42, fin=0.2, track=0.2)
    draw_text(img, t, 38.6, 43.2, '西山之怪特', K, 128, WHITE, y=0.54, fin=0.8, track=0.35, glow=18,
              glow_col=(90, 80, 70), zoom=(1.0, 1.08))
    draw_text(img, t, 43.6, 46.9, '元和四年　九月二十八日', S, 58, WHITE, weight=500, track=0.25, fin=0.8)
    draw_text(img, t, 47.4, 50.9, '坐法華西亭，望西山，始指異之。', K, 70, WHITE, y=0.74, track=0.1,
              glow=10, glow_col=(40, 30, 30))
    # 動作
    acts = [('緣染溪', 51.0), ('斫榛莽', 52.2), ('焚茅茷', 53.4)]
    for w, t0 in acts:
        draw_text(img, t, t0, t0 + 1.2, w, K, 160, WHITE, track=0.25, fin=0.06, fout=0.15, punch=True,
                  blur_in=False, glow=14, glow_col=(0, 0, 0) if w != '焚茅茷' else (255, 110, 30))
    draw_text(img, t, 54.6, 57.6, '窮山之高而止', K, 120, WHITE, track=0.3, fin=0.1, fout=0.3, punch=True,
              zoom=(1.0, 1.15), glow=14, glow_col=(60, 40, 20))
    # 登頂
    draw_text(img, t, 58.2, 61.4, '攀援而登，箕踞而遨', K, 88, WHITE, y=0.76, track=0.1, fin=0.2, punch=True,
              glow=14, glow_col=(90, 60, 30))
    draw_text(img, t, 61.6, 65.4, '則凡數州之土壤，皆在衽席之下', K, 74, WHITE, y=0.74, track=0.08,
              glow=14, glow_col=(90, 60, 30))
    draw_text(img, t, 62.3, 65.4, '好幾個州的土地，都在我的座席之下', S, 32, (235, 225, 205), y=0.83, weight=400)
    draw_text(img, t, 65.6, 70.4, '悠悠乎與顥氣俱，而莫得其涯', K, 70, WHITE, y=0.30, track=0.08,
              glow=14, glow_col=(90, 60, 30))
    draw_text(img, t, 66.8, 70.4, '洋洋乎與造物者遊，而不知其所窮', K, 70, WHITE, y=0.76, track=0.08,
              glow=14, glow_col=(90, 60, 30))
    # 暮色
    draw_text(img, t, 70.7, 74.9, '蒼然暮色，自遠而至', K, 76, WHITE, y=0.42, track=0.12, fin=1.0)
    draw_text(img, t, 71.8, 74.9, '至無所見，而猶不欲歸。', K, 60, (230, 210, 220), y=0.56, track=0.12, fin=1.0)
    draw_text(img, t, 75.4, 78.8, '心凝形釋，與萬化冥合。', K, 84, (225, 232, 245), track=0.18, fin=1.2,
              glow=20, glow_col=(90, 120, 190))
    draw_text(img, t, 76.4, 78.8, '心神凝聚，形體消散，與萬物融為一體', S, 32, (170, 185, 210), y=0.62, weight=400)
    draw_text(img, t, 79.2, 83.8, '然後知吾嚮之未始遊', K, 78, (235, 238, 245), y=0.40, track=0.15, fin=1.0)
    draw_text(img, t, 80.6, 83.8, '遊於是乎', K, 78, (235, 238, 245), y=0.56, x=0.46, track=0.15, fin=0.8)
    draw_text(img, t, 81.6, 83.8, '始', K, 150, GOLD, y=0.56, x=0.625, fin=0.5, punch=True, glow=30,
              glow_col=(255, 170, 60))
    # 片名
    gold_grad = ((255, 244, 214), (236, 196, 120), (180, 128, 60), (240, 206, 140))
    draw_text(img, t, 85.0, 97.8, '始得西山宴遊記', K, 170, GOLD, y=0.45, track=0.12, fin=0.25, fout=1.0,
              zoom=(1.12, 1.0), gradient=gold_grad, glow=26, glow_col=(200, 120, 40), punch=True)
    seal(img, t, 86.0, 97.8, '柳', 0.5, 0.635, 70)
    draw_text(img, t, 86.4, 97.8, '唐　柳宗元', S, 42, (220, 205, 180), y=0.735, track=0.6, weight=500, fout=1.0)
    draw_text(img, t, 91.0, 94.3, '真正的遊，從這一刻開始', S, 44, WHITE, y=0.84, weight=500, track=0.2)
    draw_text(img, t, 94.5, 97.8, '你的「西山」，在哪裏？', S, 48, GOLD, y=0.84, weight=700, track=0.2, fout=1.0)
    # 彩蛋
    draw_text(img, t, 99.0, 101.6, '是歲，元和四年也。', K, 54, GREY, track=0.3, fin=0.8, fout=0.8)


def frame(i):
    t = i / FPS
    img = scene_bg(t)
    if img is None:
        img = np.zeros((H, W, 3), np.float32)
    else:
        img = img * VIGNETTE
    overlay_text(img, t)
    # 重擊閃白
    for f in FLASHES:
        if 0 <= t - f < 0.35:
            k = math.exp(-(t - f) * 14)
            img = img + (1 - img) * (k * (0.85 if f in (58.2, 85.0, 7.5) else 0.45))
    img = img + grain(t) * 0.022
    img[:BAR] = 0
    img[H - BAR:] = 0
    return (np.clip(img, 0, 1) * 255).astype(np.uint8).tobytes()


def main():
    frames = range(int(DUR * FPS))
    if len(sys.argv) > 1 and sys.argv[1] == 'still':
        for s in sys.argv[2:]:
            t = float(s)
            buf = frame(int(t * FPS))
            Image.frombytes('RGB', (W, H), buf).save(f'still_{s}.png')
        return
    with Pool(int(os.environ.get('JOBS', os.cpu_count()))) as p:
        for buf in p.imap(frame, frames, chunksize=4):
            sys.stdout.buffer.write(buf)


if __name__ == '__main__':
    main()
