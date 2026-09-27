# 預告片畫面：程式生成水墨山水 + 文字動畫，輸出 1920x1080 30fps 原始影格到 stdout
# 用法：python3 video.py | ffmpeg -f rawvideo -pix_fmt rgb24 -s 1920x1080 -r 30 -i - ...
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


# ---------------- 噪聲與山形 ----------------

def noise1d(n, scale, rng):
    pts = rng.standard_normal(int(n / scale) + 4)
    xs = np.arange(n) / scale
    i = xs.astype(int)
    f = xs - i
    f = f * f * (3 - 2 * f)
    return pts[i] * (1 - f) + pts[i + 1] * f


def fbm1d(n, rng, base=600.0, oct=7, ridged=True):
    out = np.zeros(n)
    amp = 1.0
    sc = base
    tot = 0
    for _ in range(oct):
        v = noise1d(n, sc, rng)
        if ridged:
            v = 1 - np.abs(v)
        out += v * amp
        tot += amp
        amp *= 0.5
        sc /= 2.1
    return out / tot


def noise2d(w, h, sx, sy, rng):
    small = rng.random((max(2, int(h / sy)), max(2, int(w / sx)))).astype(np.float32)
    im = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    return np.asarray(im, np.float32) / 255.0


def mountain_layer(seed, w, h, top, amp, tone, fade, peaks=None, texture=0.25, base=600):
    """回傳灰階 RGBA 圖：山脊之下填色，底部漸隱入霧。tone: 0 黑 ~ 1 白"""
    rng = np.random.default_rng(seed)
    ridge = fbm1d(w, rng, base=base)
    ridge = (ridge - ridge.min()) / (ridge.max() - ridge.min() + 1e-9)
    y = top + (1 - ridge) * amp
    if peaks:
        xs = np.arange(w)
        for px, py, pw, sharp in peaks:
            prof = np.exp(-np.abs((xs - px) / pw) ** sharp)
            y = np.minimum(y, lerp(y, py + (1 - ridge) * amp * 0.25, prof))
    yy = np.arange(h)[:, None].astype(np.float32)
    d = yy - y[None, :]
    alpha = np.clip(d / 1.5 + 0.5, 0, 1)
    fadek = np.clip(d / fade, 0, 1)
    alpha *= 1 - fadek ** 1.4 * 0.97
    # 皴法紋理：垂直拉長的噪聲
    tex = noise2d(w, h, 6, 60, rng) * 0.6 + noise2d(w, h, 25, 180, rng) * 0.4
    col = tone + (tex - 0.5) * texture * (1 - fadek) + fadek * 0.35
    # 山脊邊緣稍深，像墨線
    col -= np.exp(-np.clip(d, 0, None) / 6.0) * 0.12
    col = np.clip(col, 0, 1)
    rgba = np.zeros((h, w, 4), np.uint8)
    g = (col * 255).astype(np.uint8)
    rgba[..., 0] = g
    rgba[..., 1] = g
    rgba[..., 2] = g
    rgba[..., 3] = (alpha * 255).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def trees_layer(seed, w, h, ground, tone, count=70, hmin=500, hmax=1100):
    """松樹剪影：樹幹 + 一層層橫向的墨點松針"""
    rng = np.random.default_rng(seed)
    im = Image.new('L', (w, h), 0)
    dr = ImageDraw.Draw(im)
    for _ in range(count):
        x = rng.uniform(0, w)
        th = rng.uniform(hmin, hmax)
        tw = rng.uniform(6, 18)
        lean = rng.uniform(-60, 60)
        top_x = x + lean
        dr.polygon([(x - tw, ground + 40), (x + tw, ground + 40), (top_x + tw * 0.25, ground - th),
                    (top_x - tw * 0.25, ground - th)], fill=255)
        tiers = int(rng.integers(4, 8))
        for k in range(tiers):
            f = 0.35 + 0.65 * (k + rng.uniform(0, 0.6)) / tiers
            yy = ground - th * f
            xx = x + lean * f
            span = th * rng.uniform(0.12, 0.28) * (1.25 - f * 0.8)
            side = rng.choice([-1, 1])
            # 枝條
            bx = xx + side * span * rng.uniform(0.6, 1.0)
            dr.line([(xx, yy + 10), (bx, yy - 6)], fill=255, width=max(2, int(tw * 0.35)))
            # 松針：橫向扁平的小點群
            for _ in range(int(span / 6)):
                px = xx + side * rng.uniform(-0.3, 1.1) * span
                py = yy + rng.uniform(-span * 0.12, span * 0.08)
                rw = rng.uniform(10, 34)
                rh = rng.uniform(3, 8)
                dr.ellipse([px - rw, py - rh, px + rw, py + rh], fill=255)
    # 地面與草叢
    dr.rectangle([0, ground, w, h], fill=255)
    for _ in range(w // 3):
        gx = rng.uniform(0, w)
        gh = rng.uniform(20, 110)
        dr.line([(gx, ground + 5), (gx + rng.uniform(-25, 25), ground - gh)], fill=255, width=2)
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(1.0)), np.uint8)
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[..., :3] = int(tone * 255)
    rgba[..., 3] = a
    return Image.fromarray(rgba, 'RGBA')


def mist_layer(seed, w, h, y0, thick, strength):
    rng = np.random.default_rng(seed)
    n = noise2d(w, h, 220, 60, rng) * 0.6 + noise2d(w, h, 70, 25, rng) * 0.4
    yy = np.arange(h)[:, None]
    band = np.exp(-((yy - y0) / thick) ** 2)
    a = np.clip(band * (n * 1.6 - 0.3) * strength, 0, 1)
    rgba = np.zeros((h, w, 4), np.uint8)
    rgba[..., :3] = 235
    rgba[..., 3] = (a * 255).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def sky(top, bottom, horizon_glow=0.0, hy=0.7):
    yy = np.linspace(0, 1, H)[:, None]
    v = lerp(top, bottom, yy ** 0.8) + horizon_glow * np.exp(-((yy - hy) / 0.18) ** 2)
    v = np.clip(np.repeat(v, W, 1), 0, 1)
    g = (v * 255).astype(np.uint8)
    return Image.fromarray(np.dstack([g, g, g, np.full_like(g, 255)]), 'RGBA')


# ---------------- 場景（背景層預先生成） ----------------
LW, LH = 3400, 1500


@lru_cache(None)
def scene_layers(name):
    if name == 'yongzhou':  # 陰鬱永州
        return dict(sky=sky(0.55, 0.78), layers=[
            (mountain_layer(11, LW, LH, 420, 260, 0.62, 380), 0.15),
            (mist_layer(12, LW, LH, 760, 120, 0.8), 0.25),
            (mountain_layer(13, LW, LH, 560, 300, 0.42, 420), 0.35),
            (mist_layer(14, LW, LH, 900, 140, 0.9), 0.5),
            (mountain_layer(15, LW, LH, 760, 330, 0.2, 500, base=450), 0.7),
            (mist_layer(16, LW, LH, 1150, 160, 0.8), 0.9),
        ])
    if name == 'wander':  # 遊走山水
        return dict(sky=sky(0.7, 0.9), layers=[
            (mountain_layer(21, LW, LH, 380, 380, 0.66, 360, base=380), 0.15),
            (mist_layer(22, LW, LH, 750, 110, 0.8), 0.25),
            (mountain_layer(23, LW, LH, 520, 420, 0.45, 420, base=330), 0.4),
            (mist_layer(24, LW, LH, 980, 140, 0.9), 0.55),
            (mountain_layer(25, LW, LH, 760, 380, 0.18, 500, base=260), 0.8),
        ])
    if name == 'forest':
        return dict(sky=sky(0.6, 0.8), layers=[
            (mountain_layer(31, LW, LH, 450, 300, 0.6, 400), 0.15),
            (mist_layer(32, LW, LH, 850, 200, 1.0), 0.3),
            (trees_layer(33, LW, LH, 1250, 0.45, 45, 450, 850), 0.6),
            (mist_layer(34, LW, LH, 1150, 150, 0.7), 0.7),
            (trees_layer(35, LW, LH, 1480, 0.12, 16, 1000, 1450), 1.0),
        ])
    if name == 'xishan':  # 西山：一座孤高怪特的山
        return dict(sky=sky(0.45, 0.85, 0.25, 0.55), layers=[
            (mountain_layer(41, LW, LH, 820, 160, 0.55, 300,
                            peaks=[(1700, 180, 260, 1.3), (1450, 420, 150, 1.6), (2000, 380, 170, 1.5)]), 0.1),
            (mist_layer(42, LW, LH, 900, 120, 1.0), 0.25),
            (mountain_layer(43, LW, LH, 950, 200, 0.3, 350, base=500), 0.45),
            (mist_layer(44, LW, LH, 1150, 150, 0.8), 0.6),
            (mountain_layer(45, LW, LH, 1150, 180, 0.12, 400, base=300), 0.85),
        ])
    if name == 'summit':  # 山頂俯瞰：眾山在下
        lay = []
        for i in range(7):
            k = i / 6
            lay.append((mountain_layer(51 + i, LW, LH, 560 + i * 95, 90 + i * 30, lerp(0.8, 0.3, k), 180 + i * 30,
                                       base=500 - i * 30, texture=0.15), 0.05 + k * 0.4))
            lay.append((mist_layer(71 + i, LW, LH, 700 + i * 100, 60 + i * 8, 0.8), 0.07 + k * 0.4))
        lay.append((mountain_layer(80, LW, LH, 1260, 120, 0.08, 400, base=900, texture=0.3), 1.0))
        return dict(sky=sky(0.5, 0.88, 0.25, 0.42), layers=lay)
    if name == 'title':
        return dict(sky=sky(0.08, 0.2), layers=[
            (mountain_layer(91, LW, LH, 760, 280, 0.3, 380), 0.2),
            (mist_layer(92, LW, LH, 1000, 160, 0.5), 0.35),
            (mountain_layer(93, LW, LH, 950, 260, 0.1, 400), 0.6),
        ])
    raise KeyError(name)


def render_scene(name, t, cam_x=0.0, cam_y=0.0, zoom=1.0):
    """cam_x, cam_y 以像素計（遠景乘上視差係數）。回傳灰階 numpy（0~1）"""
    sc = scene_layers(name)
    canvas = sc['sky'].copy()
    for img, par in sc['layers']:
        z = 1 + (zoom - 1) * (0.3 + par)
        # 以畫面中心為基準縮放
        cx = LW / 2 + cam_x * par
        cy = LH / 2 - 180 + cam_y * par
        x0 = cx - W / 2 / z
        y0 = cy - H / 2 / z
        # 霧層隨時間飄動
        if id(img) in _mist_ids(name):
            x0 += t * 25 * (0.5 + par)
        layer = img.transform((W, H), Image.AFFINE, (1 / z, 0, x0, 0, 1 / z, y0), resample=Image.BILINEAR)
        canvas.alpha_composite(layer)
    return np.asarray(canvas.convert('L'), np.float32) / 255.0


@lru_cache(None)
def _mist_ids(name):
    # 霧層的 RGB 全是 235，藉此辨認
    return frozenset(id(img) for img, _ in scene_layers(name)['layers']
                     if np.asarray(img)[..., 0].min() >= 235)


# ---------------- 調色 ----------------

def gradmap(gray, stops):
    """stops: [(pos, (r,g,b)), ...] 灰階映射成顏色"""
    lut = np.zeros((256, 3), np.float32)
    xs = np.linspace(0, 1, 256)
    ps = [s[0] for s in stops]
    for c in range(3):
        lut[:, c] = np.interp(xs, ps, [s[1][c] for s in stops])
    idx = np.clip(gray * 255, 0, 255).astype(np.uint8)
    return lut[idx] / 255.0


PAL = {
    'cold': [(0, (8, 12, 18)), (0.45, (60, 72, 82)), (0.8, (150, 162, 168)), (1, (205, 212, 214))],
    'rain': [(0, (5, 8, 14)), (0.5, (45, 55, 66)), (1, (140, 150, 160))],
    'paper': [(0, (22, 18, 16)), (0.4, (92, 84, 72)), (0.8, (200, 190, 168)), (1, (238, 230, 210))],
    'dream': [(0, (30, 20, 28)), (0.5, (140, 110, 120)), (1, (245, 225, 215))],
    'dawn': [(0, (10, 14, 26)), (0.45, (70, 70, 90)), (0.75, (200, 160, 130)), (1, (255, 225, 180))],
    'fire': [(0, (20, 5, 0)), (0.4, (120, 40, 10)), (0.8, (240, 140, 60)), (1, (255, 220, 160))],
    'gold': [(0, (14, 16, 26)), (0.35, (58, 62, 80)), (0.72, (205, 150, 95)), (1, (250, 220, 170))],
    'dusk': [(0, (6, 5, 18)), (0.4, (42, 30, 70)), (0.7, (140, 72, 90)), (1, (220, 140, 110))],
    'night': [(0, (2, 4, 12)), (0.4, (14, 24, 50)), (0.8, (60, 85, 130)), (1, (150, 180, 220))],
    'ink': [(0, (4, 4, 6)), (0.5, (30, 28, 30)), (1, (90, 80, 70))],
}


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


def scene_bg(t):
    """回傳 (rgb float 陣列, 是否加顆粒)"""
    if t < 3.0:
        return None
    if t < 11.5:
        lt = t - 3.0
        g = render_scene('yongzhou', t, cam_x=-400 + lt * 40, cam_y=40 - lt * 4, zoom=1.0 + lt * 0.006)
        pal = 'cold' if t < 7.5 else 'rain'
        img = gradmap(g, PAL[pal])
        img *= smooth((t - 3.0) / 2.0)
        if t >= 7.5:
            particles(img, t, 'rain', 1, 320, 0.8)
        return img
    if t < 16.6:
        lt = t - 11.5
        g = render_scene('yongzhou', t, cam_x=300 + lt * 25, cam_y=-120, zoom=1.12 - lt * 0.01)
        img = gradmap(g, PAL['rain'])
        particles(img, t, 'rain', 2, 200, 0.5)
        return img
    if t < 22.0:
        lt = t - 16.6
        g = render_scene('wander', t, cam_x=-600 + lt * 110, cam_y=-40, zoom=1.0 + lt * 0.01)
        return gradmap(g, PAL['paper'])
    if t < 30.4:
        # 蒙太奇：每 1.2 秒換一個景，快速推移
        idx = int((t - 22.0) / 1.2)
        lt = (t - 22.0) - idx * 1.2
        shots = [('wander', 'paper', -900, -200, 1.3), ('forest', 'paper', 200, 0, 1.0),
                 ('wander', 'cold', 500, 100, 1.1), ('yongzhou', 'paper', -200, -250, 1.4),
                 ('wander', 'paper', 900, -100, 1.0), ('forest', 'dawn', -600, 100, 1.1),
                 ('xishan', 'dream', 400, 150, 1.0)]
        name, pal, cx, cy, z = shots[min(idx, 6)]
        g = render_scene(name, t, cam_x=cx + lt * 260 * (1 if idx % 2 else -1), cam_y=cy, zoom=z + lt * 0.08)
        return gradmap(g, PAL[pal])
    if t < 33.0:
        lt = t - 30.4
        g = render_scene('wander', t, cam_x=200 + lt * 30, cam_y=-80, zoom=1.2 + lt * 0.02)
        im = Image.fromarray((g * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6 + 4 * math.sin(lt * 2)))
        img = gradmap(np.asarray(im, np.float32) / 255.0, PAL['dream'])
        particles(img, t, 'dust', 5, 120, 0.8)
        return img
    if t < 38.0:
        lt = t - 33.0
        g = render_scene('wander', t, cam_x=-300 - lt * 60, cam_y=-150 + lt * 20, zoom=1.0 - lt * 0.01)
        return gradmap(g, PAL['paper'])
    if t < 47.0:
        img = np.zeros((H, W, 3), np.float32)
        if t > 43.5:
            # 墨暈慢慢化開
            k = smooth((t - 43.5) / 3.5)
            d = np.sqrt((_xx - W / 2) ** 2 + ((_yy - H / 2) * 1.6) ** 2)
            img += (np.exp(-(d / (200 + 600 * k)) ** 2) * 0.07 * k)[..., None] * np.array([1, 0.95, 0.85])
        return img
    if t < 51.0:
        lt = t - 47.0
        g = render_scene('xishan', t, cam_x=-150 + lt * 25, cam_y=-40 + lt * 12, zoom=1.0 + lt * 0.035)
        img = gradmap(g, PAL['dawn'])
        add_glow(img, W * 0.52 + 20 * lt, H * 0.22, 380, (1.0, 0.75, 0.45), 0.55 * smooth(lt / 1.5))
        img *= smooth(lt / 1.2)
        return img
    if t < 54.6:
        lt = t - 51.0
        pal = 'paper' if t < 53.4 else 'fire'
        g = render_scene('forest', t, cam_x=-800 + lt * 420, cam_y=40, zoom=1.08)
        img = gradmap(g, PAL[pal])
        if t >= 53.4:
            particles(img, t, 'embers', 7, 220, 1.0)
            add_glow(img, W * 0.5, H * 1.05, 700, (1.0, 0.4, 0.1), 0.45)
        return img
    if t < 58.2:
        # 仰攀：鏡頭由下往上掃
        lt = t - 54.6
        k = smooth(lt / 3.2)
        g = render_scene('xishan', t, cam_x=0, cam_y=420 - k * 700, zoom=1.35 - k * 0.2)
        img = gradmap(g, PAL['dawn'])
        add_glow(img, W * 0.5, H * (0.9 - k * 0.8), 500, (1.0, 0.8, 0.5), 0.4 * k)
        if t > 57.6:
            img *= 1 - smooth((t - 57.6) / 0.3)
        return img
    if t < 84.0:
        lt = t - 58.2
        # 山頂俯瞰：緩慢推近，視角微微下移
        g = render_scene('summit', t, cam_x=-200 + lt * 18, cam_y=-60 + lt * 5, zoom=1.0 + lt * 0.006)
        if t < 70.5:
            img = gradmap(g, PAL['gold'])
            sun = (W * 0.78, H * 0.2 + lt * 4)
            add_glow(img, *sun, 380, (1.0, 0.8, 0.5), 0.5)
            particles(img, t, 'dust', 9, 90, 0.5)
        elif t < 75.0:
            k = smooth((t - 70.5) / 4.5)
            # 暮色「自遠而至」：遠處先暗
            a = gradmap(g, PAL['gold'])
            b = gradmap(g, PAL['dusk'])
            front = lerp(-0.2, 1.2, k)
            m = np.clip((front - _yy / H) * 3, 0, 1)[..., None]
            img = a * (1 - m) + b * m
            img *= 1 - 0.35 * k
            add_glow(img, W * 0.78, H * 0.2 + lt * 4 + k * 250, 380, (1.0, 0.55, 0.35), 0.5 * (1 - k * 0.8))
        else:
            k = smooth((t - 75.0) / 2.0)
            img = gradmap(g, PAL['dusk']) * 0.65 * (1 - k) + gradmap(g, PAL['night']) * k
            particles(img, t, 'stars', 11, 380, k)
            add_glow(img, W * 0.22, H * 0.2, 160, (0.8, 0.88, 1.0), 0.35 * k)
            if t > 83.0:
                img *= 1 - smooth((t - 83.0) / 1.0)
        return img
    if t < 85.0:
        return np.zeros((H, W, 3), np.float32)
    if t < 98.0:
        lt = t - 85.0
        g = render_scene('title', t, cam_x=-100 + lt * 15, cam_y=0, zoom=1.05 + lt * 0.004)
        img = gradmap(g, PAL['ink'])
        add_glow(img, W * 0.5, H * 0.45, 700, (0.9, 0.65, 0.3), 0.18)
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
    draw_text(img, t, 7.5, 11.3, '一夜之間　被貶千里', S, 92, WHITE, weight=900, fin=0.15, zoom=(1.08, 1.0),
              punch=True, glow=10, glow_col=(120, 140, 170))
    draw_text(img, t, 8.4, 11.3, '永州司馬', S, 40, GREY, y=0.62, track=0.6, weight=500)
    # 原文一
    draw_text(img, t, 11.8, 16.4, '自余為僇人，居是州，恆惴慄。', K, 84, WHITE, y=0.46, track=0.08)
    draw_text(img, t, 12.6, 16.4, '自從我成了罪人，住在這裏，常常憂懼不安', S, 34, GREY, y=0.60, weight=400)
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
