# 坐姿長袍：加入形變目標 SeatFlat。
# (一) 撫平大腿上的長袍：站立時長袍的直摺紋，坐下後大腿變成橫向，摺紋便疊成一圈圈厚重的波浪；
#      坐姿時把臀部至膝蓋（及膝前轉角）的布面平滑，令布料像真實衣料一樣平順地搭在腿上、由膝蓋垂下。
# (二) 長袍底面貼平石面：
# 坐姿時大腿略向前斜，臀下的長袍向後向上彎起，平頂石只碰到大腿下方，臀部後面便露出楔形空隙。
# 這裏按坐姿（SeatedIdle 第一格）計算長袍底面每個頂點要移到的高度，換算回綁定姿勢的位移，
# 存成形變目標；遊戲在坐姿時把它開到 1，長袍便像布料一樣平鋪在石面上。
# 用法：python3 tools/liu-model/seat_morph.py assets/characters/liu-zongyuan.glb
import sys, os, json, struct, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb import GLB
from rig import qmul, qrot

SCALE = 1.85                 # 遊戲中的放大倍數（js/liu-character.js）
SEAT_H = 0.44 / SCALE        # 石面高度（遊戲中 0.44 米），轉為模型單位
path = sys.argv[1]
g = GLB(path); j = g.j
mesh = j['meshes'][0]; prim = mesh['primitives'][0]; A = prim['attributes']
P = g.acc(A['POSITION']).astype(np.float64); N = g.acc(A['NORMAL']).astype(np.float64)
Jt = g.acc(A['JOINTS_0']).astype(int); Wt = g.acc(A['WEIGHTS_0']).astype(np.float64)
names = [n['name'] for n in j['nodes']]
par = {c: i for i, n in enumerate(j['nodes']) for c in n.get('children', [])}

# ---- SeatedIdle 第一格的骨骼姿勢 ----
local = {i: [np.array(n.get('translation', [0, 0, 0]), float), np.array(n.get('rotation', [0, 0, 0, 1]), float)] for i, n in enumerate(j['nodes'])}
anim = next(a for a in j['animations'] if a['name'] == 'SeatedIdle')
for ch in anim['channels']:
    s = anim['samplers'][ch['sampler']]; v = g.acc(s['output'])[0].astype(float)
    if ch['target']['path'] == 'rotation': local[ch['target']['node']][1] = v
    elif ch['target']['path'] == 'translation': local[ch['target']['node']][0] = v
def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
Wm = {}
def world(i):
    if i in Wm: return Wm[i]
    t, r = local[i]; M = np.eye(4); M[:3, :3] = qmat(r); M[:3, 3] = t
    Wm[i] = (world(par[i]) @ M) if i in par else M
    return Wm[i]
skin = j['skins'][0]
ibm = g.acc(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
S = np.stack([world(k) @ ibm[n] for n, k in enumerate(skin['joints'])])     # 每節骨的蒙皮矩陣
B = np.einsum('vk,vkij->vij', Wt, S[Jt])                                     # 每個頂點的混合矩陣（線性蒙皮）
Ps = np.einsum('vij,vj->vi', B[:, :3, :3], P) + B[:, :3, 3]                  # 坐姿位置
Ns = np.einsum('vij,vj->vi', B[:, :3, :3], N); Ns /= np.linalg.norm(Ns, axis=1, keepdims=True)
hips = world(names.index('mixamorig:Hips'))[:3, 3]

def sst(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

# ---- (一) 撫平大腿上的長袍 ----
names_j = [j['nodes'][k]['name'].replace('mixamorig:', '') for k in skin['joints']]
ji = {n: i for i, n in enumerate(names_j)}
legset = [ji[n] for n in ['Hips', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg']]
footset = [ji[n] for n in ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']]
legW = sum(Wt[:, k] * np.isin(Jt[:, k], legset + footset) for k in range(4))
dom = Jt[np.arange(len(Jt)), Wt.argmax(1)]
bx, by, bz = P.T
inner = np.hypot(bx - np.where(bx > 0, 0.07, -0.07), bz) < 0.05
robe = (legW > 0.5) & (by > 0.035) & ~((by < 0.10) & inner) & ~np.isin(dom, footset)
# 範圍（綁定姿勢高度）：腰帶以下到下襬之上；上下兩端漸變，腰部保留原狀
wr = robe * sst(float(os.environ.get('SEAT_LO0', 0.06)), float(os.environ.get('SEAT_LO1', 0.14)), by) * (1 - sst(0.47, 0.52, by))
SMOOTH = float(os.environ.get('SEAT_SMOOTH', 1.0))
wr = wr * SMOOTH
# 貼圖接縫處的重複頂點按位置合併，一起移動
_, weld = np.unique(np.round(P, 5), axis=0, return_inverse=True); weld = weld.reshape(-1); nw = weld.max() + 1
Q = np.zeros((nw, 3)); np.add.at(Q, weld, Ps); Q /= np.bincount(weld, minlength=nw)[:, None]
Wr = np.zeros(nw); np.maximum.at(Wr, weld, wr)
# 長袍前襟是幾層重疊的布，摺紋其實是一層層分開的布邊，沿網格平滑無法令它們合成一片。
# 改用「局部曲面擬合」：每點取半徑 R 內的布面點，擬合二次曲面，再把該點投影到曲面上；
# 重疊的布層和波浪都被壓成同一片平順的布面，大腿的圓弧則保留。
from scipy.spatial import cKDTree
R = float(os.environ.get('SEAT_R', 0.12)) / SCALE
# 深色的帶子和衣邊（按顏色貼圖判斷）不參與擬合：它們是另一層布，之後跟着下面的布面移動、浮在面上
import io
from PIL import Image as _Im
_mt = j['materials'][0]; _ci = j['textures'][_mt['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
_bv = j['bufferViews'][j['images'][_ci]['bufferView']]; _o = _bv.get('byteOffset', 0)
_cimg = np.asarray(_Im.open(io.BytesIO(bytes(g.bin[_o:_o + _bv['byteLength']]))).convert('L'), np.float64)
_uv = g.acc(A['TEXCOORD_0'])
vlum = _cimg[np.clip((_uv[:, 1] * _cimg.shape[0]).astype(int), 0, _cimg.shape[0] - 1), np.clip((_uv[:, 0] * _cimg.shape[1]).astype(int), 0, _cimg.shape[1] - 1)]
dark_w = np.zeros(nw); np.maximum.at(dark_w, weld, (vlum < 100).astype(float))
pool = np.where(np.isin(np.arange(nw), np.unique(weld[robe])) & (dark_w < 0.5))[0]   # 擬合用的點：淺色長袍布面
Q0 = Q.copy()
act = np.where((Wr > 0.01) & (dark_w < 0.5))[0]
# 讓長袍貼着大腿：站立時長袍向前垂開的寬鬆布量，坐下後被大腿抬起，堆在腿上像個大肚子。
# 以大腿骨為軸，布面離軸太遠的點拉近到「大腿＋布料」的半徑（髖部約 9.5 厘米、膝部約 7.5 厘米）；
# 兩腿之間的布便自然垂進兩膝之間，不再鼓起。
def jpos(n): return world(names.index('mixamorig:' + n))[:3, 3]
def sst1(a_, b_, v): return sst(a_, b_, v)
pull = np.zeros_like(Q); best = np.full(nw, np.inf)
for side in ('Left', 'Right'):
    ha, kb = jpos(side + 'UpLeg'), jpos(side + 'Leg')
    ab = kb - ha; Lt = np.linalg.norm(ab); uu_ = ab / Lt
    rel = Q - ha; tt = rel @ uu_ / Lt
    perp = rel - np.outer(rel @ uu_, uu_); rr_ = np.linalg.norm(perp, axis=1) + 1e-9
    target = (0.095 - 0.02 * np.clip(tt, 0, 1)) / SCALE
    excess = np.maximum(0, rr_ - target)
    upv = np.cross(uu_, [1.0, 0, 0]); upv /= np.linalg.norm(upv)
    topness = (perp @ upv) / rr_                                     # 1＝大腿正上方，0＝側面，負＝下方
    fade = sst1(-0.05, 0.12, tt) * (1 - sst1(0.8, 1.0, tt)) * sst1(-0.2, 0.3, topness)
    mv = -(perp / rr_[:, None]) * (excess * fade)[:, None]
    closer = rr_ < best
    pull[closer] = mv[closer]; best[closer] = rr_[closer]
# 兩膝之間：布不會像鼓面般撐平，而是垂進兩腿之間，從正面看得出兩個膝頭
kL, kR = jpos('LeftLeg'), jpos('RightLeg'); hL = jpos('LeftUpLeg')
midx = (kL[0] + kR[0]) / 2; half = abs(kL[0] - kR[0]) / 2
tt_mid = np.clip((Q[:, 2] - hL[2]) / (kL[2] - hL[2]), 0, 1.2)
gap = np.clip(1 - np.abs(Q[:, 0] - midx) / half, 0, 1) ** 1.5
axis_y = hL[1] + (kL[1] - hL[1]) * np.clip(tt_mid, 0, 1)
above = sst(0.0, 0.03 / SCALE, Q[:, 1] - axis_y)
pull[:, 1] -= float(os.environ.get('SEAT_SAG', 0.09)) / SCALE * gap * above * sst(0.1, 0.4, tt_mid) * (1 - sst(1.0, 1.15, tt_mid))
# 膝下垂下的衣襬：站立時下襬很闊，坐下後圍着兩條小腿成一個大鐘形；向中間收窄，像布料從膝頭自然垂下
low = 1 - sst(0.22, 0.30, by)     # 綁定姿勢中膝以下的布
narrow = float(os.environ.get('SEAT_NARROW', 0.24))
lowW = np.zeros(nw); np.maximum.at(lowW, weld, low * robe)
pull[:, 0] -= (Q[:, 0] - midx) * narrow * lowW
SHRINK = float(os.environ.get('SEAT_SHRINK', 1.0))
Q[act] += SHRINK * Wr[act, None] * pull[act]
print('robe pulled onto thighs, max (cm)', round(float(np.linalg.norm(pull[act], axis=1).max() * SCALE * 100), 1))
for _ in range(int(os.environ.get('SEAT_PASSES', 3))):
    tree = cKDTree(Q[pool]); newQ = Q.copy()
    for i in act:
        nb = pool[tree.query_ball_point(Q[i], R)]
        if len(nb) < 12: continue
        X = Q[nb]; d2 = np.sum((X - Q[i]) ** 2, 1); wgt = np.exp(-d2 / (0.5 * R * R))
        c = (X * wgt[:, None]).sum(0) / wgt.sum()
        C = ((X - c) * wgt[:, None]).T @ (X - c)
        ev, evec = np.linalg.eigh(C); nrm = evec[:, 0]; e1, e2 = evec[:, 2], evec[:, 1]
        L = X - c; uu, vv, hh = L @ e1, L @ e2, L @ nrm
        Am = np.stack([uu * uu, uu * vv, vv * vv, uu, vv, np.ones_like(uu)], 1) * np.sqrt(wgt)[:, None]
        coef = np.linalg.lstsq(Am, hh * np.sqrt(wgt), rcond=None)[0]
        li = Q[i] - c; u0, v0 = li @ e1, li @ e2
        h0 = coef @ [u0 * u0, u0 * v0, v0 * v0, u0, v0, 1]
        newQ[i] = c + e1 * u0 + e2 * v0 + nrm * h0
    Q = Q + Wr[:, None] * (newQ - Q)
# 帶子：取最近幾個布面點的平均位移，再沿法線向外浮起 4 毫米，不與布面重疊閃爍
dk = np.where((dark_w >= 0.5) & (Wr > 0.01))[0]
if len(dk):
    tr_ = cKDTree(Q0[act]); dd_, nn_ = tr_.query(Q0[dk], k=6)
    wgt_ = 1 / (dd_ + 1e-4); disp = ((Q[act][nn_] - Q0[act][nn_]) * wgt_[..., None]).sum(1) / wgt_.sum(1)[:, None]
    Nwl = np.zeros((nw, 3)); np.add.at(Nwl, weld, Ns); Nwl /= np.linalg.norm(Nwl, axis=1, keepdims=True) + 1e-12
    Q[dk] = Q0[dk] + Wr[dk, None] * (disp + Nwl[dk] * 0.004 / SCALE)
Ps_s = np.where((wr > 0)[:, None], Q[weld], Ps)
print('robe smoothed verts', int((wr > 0.01).sum()), 'max move (m)', round(float(np.linalg.norm(Ps_s - Ps, axis=1).max() * SCALE), 3))
base = Ps.copy(); Ps = Ps_s

# ---- (二) 長袍底面貼平石面 ----
x, y, z = Ps.T; dz = z - hips[2]; h = y - SEAT_H
u = 1 / SCALE   # 1 米（遊戲）＝ u 模型單位
# 只影響：石面範圍內（左右 ±0.24 米、臀後 0.22 米至臀前 0.13 米）、朝下的長袍底面、離石面 13 厘米以內
foot = (1 - sst(0.20 * u, 0.24 * u, np.abs(x - hips[0]))) * sst(-0.26 * u, -0.20 * u, dz) * (1 - sst(0.10 * u, 0.14 * u, dz))
down = sst(0.15, 0.45, -Ns[:, 1])
near = np.where(h >= 0, 1 - sst(0.05 * u, 0.13 * u, h), 1.0)
w = foot * down * near
dW = Ps - base; dW[:, 1] += -h * w  # 坐姿空間中：撫平＋向石面移動
dW[:, 1] -= 0.002 * u * (w > 0.5)                     # 稍為壓進石面 2 毫米，不留細縫
# 換回綁定姿勢的位移：坐姿位置 = B·(v + d)，所以 d = B₃ₓ₃⁻¹·ΔW
D = np.einsum('vij,vj->vi', np.linalg.inv(B[:, :3, :3]), dW)
# 法線：布面的明暗主要由法線決定，只改位置的話摺紋的陰影仍在。按撫平後的布面重算法線，一併存入形變目標。
F = base + dW
_, fw = np.unique(np.round(P, 5), axis=0, return_inverse=True); fw = fw.reshape(-1)
Fw = np.zeros((fw.max() + 1, 3)); np.add.at(Fw, fw, F); Fw /= np.bincount(fw)[:, None]
T3 = fw[g.acc(prim['indices']).reshape(-1, 3)]
fn = np.cross(Fw[T3[:, 1]] - Fw[T3[:, 0]], Fw[T3[:, 2]] - Fw[T3[:, 0]])
Nw = np.zeros_like(Fw)
for k in range(3): np.add.at(Nw, T3[:, k], fn)
Nf = Nw[fw]; Nf /= np.linalg.norm(Nf, axis=1, keepdims=True) + 1e-12
Nf *= np.sign(np.sum(Nf * Ns, 1))[:, None] + (np.sum(Nf * Ns, 1) == 0)[:, None]   # 與原法線同一面
kN = np.clip(np.maximum(wr, w) * 1.5, 0, 1)[:, None]
Nt = Ns * (1 - kN) + Nf * kN; Nt /= np.linalg.norm(Nt, axis=1, keepdims=True)
Nb = np.einsum('vij,vj->vi', np.linalg.inv(B[:, :3, :3]), Nt); Nb /= np.linalg.norm(Nb, axis=1, keepdims=True)
DN = (Nb - N) * (kN > 0.001)
mi = np.where((np.abs(D).max(1) > 1e-6) | (np.abs(DN).max(1) > 1e-4))[0].astype(np.uint32)
print('seat morph verts', len(mi), 'max move (m)', round(float(np.abs(dW).max() * SCALE), 3))

# ---- (三) 貼圖：去掉臀部至膝蓋一段烘焙在貼圖上的摺紋陰影 ----
# Tripo 的顏色貼圖和法線貼圖都畫上了站立時的直摺紋；網格撫平之後，貼圖上的摺紋仍令大腿看似一圈圈波浪。
# 在這一段布面的貼圖範圍內，去掉大範圍的明暗（摺紋陰影），保留細緻的布紋。只做一次（記錄在 asset.extras）。
import io
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter
ex = j['asset'].setdefault('extras', {})
UV = g.acc(A['TEXCOORD_0'])
def img_of(k):
    bv = j['bufferViews'][j['images'][k]['bufferView']]; o = bv.get('byteOffset', 0)
    return Image.open(io.BytesIO(bytes(g.bin[o:o + bv['byteLength']]))).convert('RGB')
if not ex.get('seatTextureFlattened'):
    tri_i = g.acc(prim['indices']).reshape(-1, 3)
    mat = j['materials'][0]
    srcs = {'color': j['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source'],
            'normal': j['textures'][mat['normalTexture']['index']]['source']}
    new_imgs = {}
    for kind, k in srcs.items():
        im = img_of(k); TW, TH = im.size
        # 遮罩：這段布面三角形在貼圖上的位置（按權重灰階繪畫，邊緣羽化）
        mask = Image.new('L', (TW, TH), 0); dm = ImageDraw.Draw(mask)
        tw_ = wr[tri_i].mean(1)
        for t, v in zip(tri_i, tw_):
            if v < 0.05: continue
            dm.polygon([(UV[q_, 0] * TW, UV[q_, 1] * TH) for q_ in t], fill=int(255 * min(1, v * 1.2)))
        island = mask.point(lambda a: 255 if a > 0 else 0)
        mask = mask.filter(ImageFilter.GaussianBlur(TW / 1024))
        a_img = np.asarray(im, np.float64); M = np.asarray(mask, np.float64)[..., None] / 255; I = np.asarray(island, np.float64)[..., None] / 255
        # 深色的衣邊和腰帶垂下的帶子不改（顏色貼圖上明顯較暗的部分），只處理淺色布面
        cl = np.asarray(img_of(srcs['color']).resize((TW, TH)), np.float64) @ [0.299, 0.587, 0.114]
        cloth = gaussian_filter((cl > 105).astype(np.float64), TW / 1024)[..., None]
        cloth = np.clip((cloth - 0.5) * 2.5 + 0.5, 0, 1)
        I = I * (cloth > 0.5); M = M * cloth
        sig = TW / 2048 * float(os.environ.get('SEAT_TEX_SIGMA', 14))
        def blur(arr):   # 只在同一塊布面內模糊，不混入相鄰的衣邊顏色
            return np.stack([gaussian_filter(arr[..., c], sig) for c in range(arr.shape[-1])], -1)
        low = blur(a_img * I) / np.maximum(blur(np.repeat(I, 3, -1)), 1e-3)
        if kind == 'color':
            Lw = np.array([0.299, 0.587, 0.114])
            lum_low = low @ Lw; ref = np.sum((a_img @ Lw) * I[..., 0]) / max(1, I.sum())
            flat = a_img * (ref / np.maximum(lum_low, 1))[..., None]            # 大範圍的明暗拉平到平均亮度
        else:
            nrm = a_img / 127.5 - 1; nlow = low / 127.5 - 1
            hi = nrm - nlow; hi[..., 2] = 0
            n2 = np.dstack([hi[..., 0], hi[..., 1], np.sqrt(np.clip(1 - hi[..., 0] ** 2 - hi[..., 1] ** 2, 0, 1))])
            flat = (n2 + 1) * 127.5                                            # 只留布紋的細微凹凸
        out = a_img * (1 - M) + flat * M
        new_imgs[k] = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
        print('texture', kind, 'region px', int((M[..., 0] > 0.5).sum()))
    ex['seatTextureFlattened'] = True
else:
    new_imgs = {}

# ---- 加入形變目標（附加在二進位尾端）----
binb = g.bin
def add_view(data):
    while len(binb) % 4: binb.append(0)
    j['bufferViews'].append({'buffer': 0, 'byteOffset': len(binb), 'byteLength': len(data)}); binb.extend(data)
    return len(j['bufferViews']) - 1
names_t = mesh.setdefault('extras', {}).setdefault('targetNames', [])
if 'SeatFlat' in names_t:          # 重新產生：換掉舊的 SeatFlat
    k_old = names_t.index('SeatFlat'); names_t.pop(k_old); prim['targets'].pop(k_old)
    mesh['weights'] = [w_ for i_, w_ in enumerate(mesh.get('weights', [])) if i_ != k_old]
iv = add_view(mi.tobytes()); vv = add_view(D[mi].astype(np.float32).tobytes())
j['accessors'].append({'componentType': 5126, 'count': len(P), 'type': 'VEC3',
                       'min': np.minimum(D[mi].min(0), 0).astype(float).tolist(), 'max': np.maximum(D[mi].max(0), 0).astype(float).tolist(),
                       'sparse': {'count': len(mi), 'indices': {'bufferView': iv, 'componentType': 5125}, 'values': {'bufferView': vv}}})
pos_acc = len(j['accessors']) - 1
nv = add_view(DN[mi].astype(np.float32).tobytes())
j['accessors'].append({'componentType': 5126, 'count': len(P), 'type': 'VEC3',
                       'sparse': {'count': len(mi), 'indices': {'bufferView': iv, 'componentType': 5125}, 'values': {'bufferView': nv}}})
prim.setdefault('targets', []).append({'POSITION': pos_acc, 'NORMAL': len(j['accessors']) - 1})
names_t.append('SeatFlat'); mesh['weights'] = list(mesh.get('weights', [])) + [0]
for k, im in new_imgs.items():
    b_ = io.BytesIO(); im.save(b_, 'JPEG', quality=84 if k == srcs['color'] else 90, optimize=True)
    j['images'][k]['bufferView'] = add_view(b_.getvalue())
# 重組二進位：只保留仍被引用的資料（舊貼圖、舊形變不再佔空間）
used = set()
for a_ in j['accessors']:
    if 'bufferView' in a_: used.add(a_['bufferView'])
    if 'sparse' in a_: used.update([a_['sparse']['indices']['bufferView'], a_['sparse']['values']['bufferView']])
for im_ in j['images']: used.add(im_['bufferView'])
remap = {}; nb_ = bytearray(); views = []
for i_ in sorted(used):
    bv = j['bufferViews'][i_]; o = bv.get('byteOffset', 0)
    while len(nb_) % 4: nb_.append(0)
    nbv = dict(bv); nbv['byteOffset'] = len(nb_); nb_.extend(binb[o:o + bv['byteLength']])
    remap[i_] = len(views); views.append(nbv)
for a_ in j['accessors']:
    if 'bufferView' in a_: a_['bufferView'] = remap[a_['bufferView']]
    if 'sparse' in a_:
        a_['sparse']['indices']['bufferView'] = remap[a_['sparse']['indices']['bufferView']]
        a_['sparse']['values']['bufferView'] = remap[a_['sparse']['values']['bufferView']]
for im_ in j['images']: im_['bufferView'] = remap[im_['bufferView']]
j['bufferViews'] = views; binb = nb_
while len(binb) % 4: binb.append(0)
j['buffers'][0]['byteLength'] = len(binb)
js = json.dumps(j, separators=(',', ':'), ensure_ascii=False).encode()
while len(js) % 4: js += b' '
with open(path, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binb)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(binb), 0x004E4942)); f.write(bytes(binb))
print('wrote', path, os.path.getsize(path), 'bytes; morph targets', names_t)
