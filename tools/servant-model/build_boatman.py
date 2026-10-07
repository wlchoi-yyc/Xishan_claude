# 船家（第四關湘江渡口，戴斗笠、披蓑衣）Tripo 模型（沒有骨架）：
# 自動綁骨、計算蒙皮權重（斗笠跟頭、蓑衣跟上背、手指可以屈曲握篙）、壓縮貼圖、加入口部張合和撐船動作，輸出遊戲用 GLB。
# 用法：python3 tools/servant-model/build_boatman.py 原始模型.glb assets/characters/boatman.glb   （約一分鐘）
#       POSE_ONLY=1 …：只解算動作並列出握篙誤差、竹篙與船舷的距離，不寫檔（調整撐船姿勢時用）
# （與 build_young.py 同一方法；手臂姿勢改用會避開蓑衣的搜尋，見 solve_arm）
import sys, os, io, json, struct
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'liu-model'))
from glb import GLB
import anims
from anims import Pose, rx, ry, rz, sample, hinge, orient_hand, local_rot
from rig import qaxis, qrot, qinv

SRC, OUT = sys.argv[1], sys.argv[2]
g = GLB(SRC); j = g.j
prim = j['meshes'][0]['primitives'][0]; A = prim['attributes']
P = g.acc(A['POSITION']).astype(np.float64) * 0.01          # 原檔以厘米為單位（含斗笠高 0.98）
NRM = g.acc(A['NORMAL']).astype(np.float32); UV = g.acc(A['TEXCOORD_0']).astype(np.float32)
IND = g.acc(prim['indices']).reshape(-1)
x, y, z = P.T

def img(i):
    bv = j['bufferViews'][j['images'][i]['bufferView']]; o = bv.get('byteOffset', 0)
    return Image.open(io.BytesIO(bytes(g.bin[o:o + bv['byteLength']]))).convert('RGB')
mat = j['materials'][0]
col_img = img(j['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source'])
nrm_img = img(j['textures'][mat['normalTexture']['index']]['source'])
_t = np.asarray(col_img, np.float64) / 255
C = _t[np.clip((UV[:, 1] * _t.shape[0]).astype(int), 0, _t.shape[0] - 1), np.clip((UV[:, 0] * _t.shape[1]).astype(int), 0, _t.shape[1] - 1)]
r_, g_, b_ = C.T
with np.errstate(all='ignore'):
    straw = (r_ > 0.55) & (g_ > 0.42) & (b_ < 0.33) & (g_ / r_ > 0.68)          # 斗笠、蓑衣（草黃色）
skinc = (r_ > 0.5) & (r_ - g_ > 0.17) & (g_ - b_ > 0.08)                        # 皮膚

# ---------------- 1. 骨架（Mixamo 命名；靜止時所有骨骼不旋轉）----------------
# 量度（模型高 0.98，連斗笠）：肩 0.605、肘 0.53、腕 0.466（A 字姿勢，手臂向外斜約 45°）、髖 0.36、膝 0.20、踝 0.065
J = {
    'Hips': (0, 0.40, 0.0), 'Spine': (0, 0.45, 0.0), 'Spine1': (0, 0.51, 0.0), 'Spine2': (0, 0.57, -0.005),
    'Neck': (0, 0.725, -0.01), 'Head': (0, 0.775, -0.01), 'HeadTop_End': (0, 0.96, 0.0),
}
HAND_U = {}; HAND_V = {}
# 手指：四指各自分開。量度以手的座標表示：t 沿手指方向、zc 前後位置（食指在前）
FINGERS = {'Index': (0.017, 0.046, 0.082), 'Middle': (0.0, 0.048, 0.088), 'Ring': (-0.013, 0.046, 0.083), 'Pinky': (-0.026, 0.042, 0.072)}
for s, sg in (('Left', 1), ('Right', -1)):
    W = np.array([sg * 0.253, 0.466, 0.0])
    u = np.array([sg * 0.331, -0.944, 0.0]); u /= np.linalg.norm(u)      # 手指方向
    v = np.array([sg * 0.944, 0.331, 0.0])                                # 手背朝向（向外）
    HAND_U[s], HAND_V[s] = u, v
    J.update({
        f'{s}Shoulder': (sg * 0.03, 0.62, -0.005), f'{s}Arm': (sg * 0.105, 0.605, -0.005),
        f'{s}ForeArm': (sg * 0.19, 0.53, 0.0), f'{s}Hand': tuple(W),
        f'{s}UpLeg': (sg * 0.065, 0.36, 0.0), f'{s}Leg': (sg * 0.068, 0.20, 0.005),
        f'{s}Foot': (sg * 0.07, 0.065, -0.01), f'{s}ToeBase': (sg * 0.072, 0.015, 0.05), f'{s}Toe_End': (sg * 0.074, 0.015, 0.09),
    })
    for f, (zc, t1, tip) in FINGERS.items():
        seg = (tip - t1) / 3
        for k in range(4):
            off = 0.0 if f == 'Middle' else zc
            J[f'{s}Hand{f}{k + 1}'] = tuple(W + u * (t1 + seg * k) + np.array([0, 0, off]))
    # 拇指：在手的前方（+z），由 t≈0.02 伸到 0.052
    for k, tt in enumerate((0.022, 0.036, 0.046, 0.054)): J[f'{s}HandThumb{k + 1}'] = tuple(W + u * tt + np.array([0, 0, 0.03]) - v * 0.008)
PARENT = {'Hips': None, 'Spine': 'Hips', 'Spine1': 'Spine', 'Spine2': 'Spine1', 'Neck': 'Spine2', 'Head': 'Neck', 'HeadTop_End': 'Head'}
for s in ('Left', 'Right'):
    PARENT.update({f'{s}Shoulder': 'Spine2', f'{s}Arm': f'{s}Shoulder', f'{s}ForeArm': f'{s}Arm', f'{s}Hand': f'{s}ForeArm',
                   f'{s}UpLeg': 'Hips', f'{s}Leg': f'{s}UpLeg', f'{s}Foot': f'{s}Leg', f'{s}ToeBase': f'{s}Foot', f'{s}Toe_End': f'{s}ToeBase'})
    for f in ('Index', 'Middle', 'Ring', 'Pinky', 'Thumb'):
        for k in range(4): PARENT[f'{s}Hand{f}{k + 1}'] = f'{s}Hand' if k == 0 else f'{s}Hand{f}{k}'
NAMES = list(J.keys()); JI = {n: i for i, n in enumerate(NAMES)}
JP = {n: np.array(v, float) for n, v in J.items()}

# ---------------- 2. 自動蒙皮 ----------------
# 斗笠是獨立網格，但蓑衣、身體、袖子連成一片，只能按顏色和位置分區（DEBUG_CLASS=1 以顏色顯示各區，方便檢查）。
def seg_dist(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)
def sst(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
SEG = {'Hips': ('Hips', 'Spine'), 'Spine': ('Spine', 'Spine1'), 'Spine1': ('Spine1', 'Spine2'), 'Spine2': ('Spine2', 'Neck'),
       'Neck': ('Neck', 'Head'), 'Head': ('Head', 'HeadTop_End')}
for s in ('Left', 'Right'):
    SEG.update({f'{s}Shoulder': (f'{s}Shoulder', f'{s}Arm'), f'{s}Arm': (f'{s}Arm', f'{s}ForeArm'), f'{s}ForeArm': (f'{s}ForeArm', f'{s}Hand'),
                f'{s}Hand': (f'{s}Hand', f'{s}HandMiddle1'), f'{s}UpLeg': (f'{s}UpLeg', f'{s}Leg'), f'{s}Leg': (f'{s}Leg', f'{s}Foot'),
                f'{s}Foot': (f'{s}Foot', f'{s}ToeBase'), f'{s}ToeBase': (f'{s}ToeBase', f'{s}Toe_End')})
    for f in list(FINGERS) + ['Thumb']:
        for k in (1, 2, 3): SEG[f'{s}Hand{f}{k}'] = (f'{s}Hand{f}{k}', f'{s}Hand{f}{k + 1}')
DEF = list(SEG.keys()); col = {n: i for i, n in enumerate(DEF)}
D = np.stack([seg_dist(P, JP[a], JP[b]) for a, b in SEG.values()], 1)
allow = np.zeros_like(D, bool)
side = np.where(x >= 0, 'Left', 'Right')

hat = straw & (y > 0.83)
hand = (skinc | straw) & (np.abs(x) > 0.19) & (y < 0.49)        # 部分手背顏色偏黃，也算手
cape = straw & ~hat & ~hand & (y > 0.43) & (y < 0.82)
tie = ~straw & (y > 0.70) & (y < 0.78) & (z > 0.05) & (C.sum(1) < 0.9)          # 蓑衣領口的繫帶
head = ~straw & ~tie & (y > 0.70)
sleeve = ~straw & ~hand & (np.abs(x) > 0.105) & (y > 0.43) & (y < 0.67)
legs = ~cape & (y < 0.185)
skirt = ~straw & ~sleeve & ~hand & (y >= 0.185) & (y < 0.44)
torso = ~(hat | cape | hand | tie | head | sleeve | legs | skirt)
for i in range(len(P)):
    s = side[i]
    if sleeve[i]: names = [f'{s}Shoulder', f'{s}Arm', f'{s}ForeArm']
    elif hand[i]: names = [f'{s}ForeArm', f'{s}Hand']
    elif head[i]: names = ['Head', 'Neck']
    elif legs[i]: names = [f'{s}UpLeg', f'{s}Leg', f'{s}Foot', f'{s}ToeBase']
    elif torso[i]: names = ['Hips', 'Spine', 'Spine1', 'Spine2', 'LeftShoulder', 'RightShoulder']
    else: names = ['Hips']
    for n in names: allow[i, col[n]] = True
Wd = np.where(allow, 1.0 / (D ** 2 + 1e-5) ** 2, 0.0)
def only(mask, name): Wd[mask] = 0; Wd[mask, col[name]] = 1
only(hat, 'Head'); only(tie, 'Spine2'); only(skirt, 'Hips')
# 蓑衣：整件跟上背（硬挺的草衣），領口一圈稍跟頸部
# 兩側（手臂上方）的蓑衣部分跟上臂：手臂向前伸時，兩側草衣被手臂帶起，袖子不會穿出；前襟中間和背後不動
Wd[cape] = 0
nk = sst(0.74, 0.79, y) * 0.5
ARM_CAPE = float(os.environ.get('ARM_CAPE', 0.75))
wa = ARM_CAPE * sst(0.06, 0.20, np.abs(x)) * sst(0.70, 0.57, y) * (0.55 + 0.45 * sst(-0.15, 0.0, z))
for s_, sg_ in (('Left', 1), ('Right', -1)):
    m_ = cape & (side == s_)
    Wd[m_, col[f'{s_}Arm']] = wa[m_]
    Wd[m_, col['Spine2']] = (1 - wa[m_]) * (1 - nk[m_]); Wd[m_, col['Neck']] = (1 - wa[m_]) * nk[m_]
# 手：按到手腕距離分成手掌與四指三節（手指分開，可屈曲握篙）；拇指跟手掌
for s, sg in (('Left', 1), ('Right', -1)):
    m = np.where(hand & (side == s))[0]
    Wh = JP[f'{s}Hand']; u = HAND_U[s]
    t = (P[m] - Wh) @ u
    Wd[m] = 0
    near_wrist = sst(-0.03, 0.0, t)
    Wd[m, col[f'{s}ForeArm']] = 1 - near_wrist
    zc = np.array([v[0] for v in FINGERS.values()]); fn = list(FINGERS)
    thumb = (P[m, 2] > 0.025) & (t < 0.054) & (t > 0.004)
    for k, i in enumerate(m):
        if thumb[k]:
            w1 = sst(0.014, 0.026, t[k]); w2 = sst(0.032, 0.040, t[k])
            Wd[i, col[f'{s}Hand']] = (1 - w1) * near_wrist[k]; Wd[i, col[f'{s}ForeArm']] = (1 - w1) * (1 - near_wrist[k])
            Wd[i, col[f'{s}HandThumb1']] = w1 * (1 - w2); Wd[i, col[f'{s}HandThumb2']] = w1 * w2; continue
        if t[k] < 0.03:
            Wd[i, col[f'{s}Hand']] = near_wrist[k]; continue
        f = fn[int(np.argmin(np.abs(zc - P[i, 2])))]
        zc_, t1, tip = FINGERS[f]; seg = (tip - t1) / 3
        b = [t1 - 0.004, t1 + seg - 0.002, t1 + 2 * seg - 0.002]
        w1 = sst(b[0] - 0.006, b[0] + 0.004, t[k]); w2 = sst(b[1] - 0.003, b[1] + 0.003, t[k]); w3 = sst(b[2] - 0.003, b[2] + 0.003, t[k])
        Wd[i, col[f'{s}Hand']] = 1 - w1
        Wd[i, col[f'{s}Hand{f}1']] = w1 * (1 - w2); Wd[i, col[f'{s}Hand{f}2']] = w2 * (1 - w3); Wd[i, col[f'{s}Hand{f}3']] = w3
Wd /= Wd.sum(1, keepdims=True) + 1e-12
# 沿網格相鄰頂點平滑（斗笠、蓑衣、手指不平滑，保持硬挺／分節）
tri = IND.reshape(-1, 3)
nb = [[] for _ in range(len(P))]
for a, b, c in tri: nb[a] += [b, c]; nb[b] += [a, c]; nb[c] += [a, b]
nb = [np.unique(v) for v in nb]
fixed = hat | cape | tie | skirt | hand
for _ in range(3):
    Wn = Wd.copy()
    for i in np.where(~fixed)[0]:
        if len(nb[i]): Wn[i] = 0.5 * Wd[i] + 0.5 * Wd[nb[i]].mean(0)
    Wd = Wn
# 蓑衣內側與袖子上緣在網格上連在一起：靠近袖子（3 厘米內）的蓑衣逐漸改跟袖子，手臂前伸時不會拉出一條條長三角形
from scipy.spatial import cKDTree
_sl = np.where(sleeve)[0]; _cp_i = np.where(cape)[0]
_d, _nn = cKDTree(P[_sl]).query(P[_cp_i])
_f = (1 - sst(0.004, float(os.environ.get('SLEEVE_BLEND', 0.03)), _d))[:, None]
Wd[_cp_i] = (1 - _f) * Wd[_cp_i] + _f * Wd[_sl[_nn]]
print('cape verts blended toward sleeve', int((_f > 0.05).sum()))
# 貼圖接縫上同一位置的頂點權重必須一致，否則轉頭、說話時會撕裂
_, weld = np.unique(np.round(P, 5), axis=0, return_inverse=True); weld = weld.reshape(-1)
Wm = np.zeros((weld.max() + 1, Wd.shape[1])); np.add.at(Wm, weld, Wd); Wd = (Wm / np.bincount(weld)[:, None])[weld]
top = np.argsort(-Wd, 1, kind='stable')[:, :4]
Wt = np.take_along_axis(Wd, top, 1); Wt /= Wt.sum(1, keepdims=True)
Jt = np.vectorize(lambda c: JI[DEF[c]])(top).astype(np.uint8)
print('skin: hat', hat.sum(), 'cape', cape.sum(), 'hand', hand.sum(), 'head', head.sum(), 'sleeve', sleeve.sum(),
      'torso', torso.sum(), 'skirt', skirt.sum(), 'legs', legs.sum(), 'tie', tie.sum())

# ---------------- 3. 口部張合（形變）----------------
# 臉部網格很疏（唇線一帶只有幾個大三角形），沒有口縫可以張開：把唇線以下到下巴的部分平滑地向下、略向後移，
# 貼圖上原有的唇色隨之拉闊，看來就像張口。只按位置計算（不按顏色），貼圖接縫兩邊的頂點移動一致，不會撕裂。
LIP = float(os.environ.get('LIP', 0.806))
wx = 1 - sst(0.012, 0.034, np.abs(x)); wz = sst(0.03, 0.055, z)
w_low = (1 - sst(LIP - 0.006, LIP + 0.001, y)) * sst(0.770, 0.784, y)
DM = np.zeros_like(P)
DM[:, 1] = -0.0042 * w_low * wx * wz
DM[:, 2] = -0.0012 * w_low * wx * wz
mi = np.where(np.abs(DM).max(1) > 1e-6)[0].astype(np.uint32)
print('mouth morph verts', len(mi))

# ---------------- 4. 動作 ----------------
Wpos = {n: JP[n] for n in NAMES}; Wrot = {n: np.array([0, 0, 0, 1.0]) for n in NAMES}
rest_local = {n: np.array([0, 0, 0, 1.0]) for n in NAMES}
parent_name = {n: (PARENT[n] or 'Armature') for n in NAMES}
rig = anims.Rig(Wpos, Wrot, rest_local, parent_name, JP['Hips'])
rig.rest_t = {n: (JP[n] - JP[PARENT[n]] if PARENT[n] else JP[n]) for n in NAMES}
rig.set_idle_base({})
ibm = np.stack([np.eye(4) for _ in NAMES])
for n, i in JI.items(): ibm[i][:3, 3] = -JP[n]

def nrm(v): v = np.asarray(v, float); return v / np.linalg.norm(v)
# 握篙：篙的中心在掌心內側；以手的靜止座標表示（遊戲中用同一數值把竹篙放在手中）
GRIP_T, GRIP_N = 0.056, -0.021
GRIP = {s: HAND_U[s] * GRIP_T + HAND_V[s] * GRIP_N for s in ('Left', 'Right')}
POLE_LOCAL = {'Left': np.array([0, 0, 1.0]), 'Right': np.array([0, 0, 1.0])}   # 篙軸（拇指一方向上）

def fist(p, side, k=1.0):
    """四指圍着竹篙屈曲（左手繞 -z、右手繞 +z 軸，以靜止座標計）。"""
    ax = [0, 0, -1] if side == 'Left' else [0, 0, 1]
    for f in FINGERS:
        for i, d in ((1, 62), (2, 78), (3, 45)):
            local_rot(p, f'{side}Hand{f}{i}', qaxis(ax, np.radians(d * k)))
    for i, d in ((1, 55), (2, 50)): local_rot(p, f'{side}HandThumb{i}', qaxis(ax, np.radians(d * k)))
def relax(p, side, k=1.0):
    ax = [0, 0, -1] if side == 'Left' else [0, 0, 1]
    for f in FINGERS:
        for i, d in ((1, 12), (2, 18), (3, 10)): local_rot(p, f'{side}Hand{f}{i}', qaxis(ax, np.radians(d * k)))

def hand_world(p, side):
    o = rig.fk(p, [f'{side}Hand', f'{side}ForeArm']); return o[f'{side}Hand'], o[f'{side}ForeArm']
def grip_of(p, side):
    (hp, hq), _ = hand_world(p, side)
    return hp + qrot(hq, GRIP[side]), qrot(hq, POLE_LOCAL[side])

# 蓑衣內側的形狀（以上背 Spine2 為座標）：每個方位角、每個高度的內側半徑，以及衣襬高度。
# 擺動作時手臂（袖子約 3.5 厘米粗）必須留在蓑衣之內，或從衣襬下方伸出，否則袖子會穿出草衣。
TH_N = 36
_cp = P[cape] - JP['Spine2'] * [1, 0, 1]
_th = ((np.arctan2(_cp[:, 0], _cp[:, 2]) + np.pi) / (2 * np.pi) * TH_N).astype(int) % TH_N
_r = np.hypot(_cp[:, 0], _cp[:, 2]); _yb = np.clip(((_cp[:, 1] - 0.40) / 0.01).astype(int), 0, 44)
CAPE_IN = np.full((TH_N, 45), np.nan); CAPE_HEM = np.full(TH_N, 0.40)
for tb in range(TH_N):
    mt = _th == tb
    if mt.any(): CAPE_HEM[tb] = np.percentile(_cp[mt, 1], 3)
    for yb in range(45):
        mm = mt & (_yb == yb)
        if mm.sum() >= 2: CAPE_IN[tb, yb] = np.percentile(_r[mm], 10)
CAPE_OUT = np.full((TH_N, 45), np.nan)
for tb in range(TH_N):
    for yb in range(45):
        mm = (_th == tb) & (_yb == yb)
        if mm.sum() >= 2: CAPE_OUT[tb, yb] = np.percentile(_r[mm], 95)
    row = CAPE_OUT[tb]; ok = ~np.isnan(row)
    if ok.any(): CAPE_OUT[tb] = np.interp(np.arange(45), np.where(ok)[0], row[ok])
for tb in range(TH_N):                       # 空格以同一方位相鄰高度補上
    row = CAPE_IN[tb]; ok = ~np.isnan(row)
    if ok.any(): CAPE_IN[tb] = np.interp(np.arange(45), np.where(ok)[0], row[ok])
def cape_violation(o, side):
    s2p, s2q = o['Spine2']; a_, e_, h_ = o[f'{side}Arm'][0], o[f'{side}ForeArm'][0], o[f'{side}Hand'][0]
    v = 0.0
    for pt, tube in [(e_ + (h_ - e_) * t, 0.032) for t in (0.35, 0.6)]:
        lp = qrot(qinv(s2q), pt - s2p)
        th = int((np.arctan2(lp[0], lp[2]) + np.pi) / (2 * np.pi) * TH_N) % TH_N
        yy = lp[1] + JP['Spine2'][1]
        if yy < CAPE_HEM[th] - 0.01: continue
        if ARM_CAPE * sst(0.06, 0.20, abs(lp[0])) * sst(0.70, 0.57, yy) * (0.55 + 0.45 * sst(-0.15, 0.0, lp[2])) > 0.3: continue   # 這裏的蓑衣會被手臂帶起
        rin = CAPE_IN[th, int(np.clip((yy - 0.40) / 0.01, 0, 44))]
        v += max(0.0, np.hypot(lp[0], lp[2]) + tube - rin)
    # 前臂也不可穿過身體
    hp_, hq_ = o['Hips']
    for t in (0.3, 0.6):
        lp = qrot(qinv(hq_), e_ + (h_ - e_) * t - hp_)
        if -0.25 < lp[1] < 0.2: v += max(0.0, 0.145 - np.hypot(lp[0], lp[2]))
    return v

def pole_in_cape(pt, o, r_pole=0.016):
    """竹篙或握篙的手若藏在蓑衣裏面（在衣襬以上、又不在草衣外面），回傳深度。"""
    s2p, s2q = o['Spine2']
    lp = qrot(qinv(s2q), pt - s2p)
    th = int((np.arctan2(lp[0], lp[2]) + np.pi) / (2 * np.pi) * TH_N) % TH_N
    yy = lp[1] + JP['Spine2'][1]
    if yy < CAPE_HEM[th] - 0.008: return 0.0
    return max(0.0, CAPE_OUT[th, int(np.clip((yy - 0.40) / 0.01, 0, 44))] + r_pole + 0.01 - np.hypot(lp[0], lp[2]))

BOUNDS = [(-60, 60), (-30, 45), (-20, 115), (-25, 75), (0, 140)]
def solve_arm(p, side, target, x0=None, pref=(0, 0, 0, 0, 30)):
    """手腕到 target，同時避開蓑衣與身體（arm() 的五個參數：自轉、側舉、前舉、內收、屈肘）。"""
    want = ['Spine2', 'Hips', f'{side}Arm', f'{side}ForeArm', f'{side}Hand']
    def cost(xx):
        q = p.copy(); anims.arm(q, side, *xx); o = rig.fk(q, want)
        return np.linalg.norm(o[f'{side}Hand'][0] - target) + 2.0 * cape_violation(o, side) + 0.00012 * sum(abs(a - b) for a, b in zip(xx, pref))
    if x0 is None:
        import itertools
        grid = itertools.product((-30, 0, 30), range(-30, 46, 15), range(-20, 116, 15), range(-25, 76, 15), range(0, 141, 20))
        best = list(min(grid, key=cost))
    else: best = list(x0)
    step = [15, 8, 10, 8, 10] if x0 is None else [6, 4, 4, 4, 4]
    cb = cost(best)
    for _ in range(7):
        for i in range(5):
            for d in (-step[i], step[i]):
                xx = best.copy(); xx[i] = float(np.clip(xx[i] + d, *BOUNDS[i]))
                c = cost(xx)
                if c < cb: best, cb = xx, c
        step = [max(0.5, st / 2) for st in step]
    anims.arm(p, side, *best)
    return best

def place_grip(p, side, G, a, x0=None, iters=4, allow_grid=True):
    """把手放到竹篙上：掌心中心落在 G，拇指沿篙軸 a 向上，手指順着前臂方向圍着竹篙。"""
    G = np.asarray(G, float); a = nrm(a)
    o = rig.fk(p, [f'{side}Arm']); fdir = nrm(G - o[f'{side}Arm'][0])
    for _ in range(iters):
        uu = nrm(fdir - a * (fdir @ a))
        vv = np.cross(a, uu) if side == 'Left' else np.cross(uu, a)
        wrist = G - (uu * GRIP_T + vv * GRIP_N)
        x0 = solve_arm(p, side, wrist, x0)
        if allow_grid and np.linalg.norm(hand_world(p, side)[0][0] - wrist) > 0.012: x0 = solve_arm(p, side, wrist, None)
        orient_hand(p, side, uu, -vv)
        (hp, _), (ep, _) = hand_world(p, side)
        fdir = nrm(hp - ep)
    g_, ax_ = grip_of(p, side)
    o = rig.fk(p, ['Spine2', 'Hips', f'{side}Arm', f'{side}ForeArm', f'{side}Hand'])
    print(f'  grip {side}: err {np.linalg.norm(g_ - G) * 100:.2f}cm axis {np.degrees(np.arccos(np.clip(ax_ @ a, -1, 1))):.1f}deg '
          f'cape/body overlap {cape_violation(o, side) * 100:.2f}cm arm {np.round(x0, 1)}')
    return x0, np.linalg.norm(g_ - G) + 2 * cape_violation(o, side) + 2 * pole_in_cape(G, o, 0.03)

def grip_on_line(p, side, Q, a, s_range, x0=None):
    """手可以沿竹篙滑動：在篙上 s_range 範圍內找一個手最容易握到的位置。"""
    import itertools
    want = ['Spine2', 'Hips', f'{side}Arm', f'{side}ForeArm', f'{side}Hand']
    table = []
    for xx in itertools.product((-20, 0, 20), range(-30, 46, 15), range(-20, 116, 15), range(-25, 76, 15), range(0, 141, 20)):
        q = p.copy(); anims.arm(q, side, *xx); o = rig.fk(q, want)
        table.append((list(map(float, xx)), o[f'{side}Hand'][0], cape_violation(o, side)))
    sh = rig.fk(p, [f'{side}Arm'])[f'{side}Arm'][0]
    best = None
    for s_ in s_range:
        q = p.copy(); G = Q + a * s_
        wr = G - nrm(G - sh) * 0.05
        seed = min(table, key=lambda r: np.linalg.norm(r[1] - wr) + 2 * r[2])[0]
        for sd in ([seed, list(x0)] if x0 is not None else [seed]):
            q = p.copy()
            xx, err = place_grip(q, side, G, a, sd, iters=2, allow_grid=False)
            # 與上一個關鍵姿勢相近的手臂角度較好（動作連貫）
            if x0 is not None: err += 0.0002 * sum(abs(u_ - v_) for u_, v_ in zip(xx, x0))
            if best is None or err < best[0]: best = (err, s_, xx)
    xx, err = place_grip(p, side, Q + a * best[1], a, best[2], allow_grid=False)
    print(f'    -> {side} at s={best[1]:+.3f}')
    return xx

def base_pose(): return Pose(rig)

# 站立：右手自然垂下（由 A 字姿勢放下），左手在身旁握着插在水中的竹篙
IDLE_GRIP = [float(v) for v in os.environ.get('IDLE_GRIP', '0.25,0.44,0.09').split(',')]
def idle_pose():
    p = base_pose()
    p.set('RightArm', rz(30), rx(-4)); p.set('RightForeArm', hinge(rig, 'RightForeArm', 12)); relax(p, 'Right')
    a = nrm([-0.13, 1, 0.02])
    print('Idle:')
    place_grip(p, 'Left', IDLE_GRIP, a)
    fist(p, 'Left')
    return p, a
IDLE, IDLE_AXIS = idle_pose()

# 撐船：上身向右（竹篙一方）轉，左手在上、右手在下握篙，篙底插在身後右方水中。
# 撐船時船家面向船外（遊戲中轉身向江面），竹篙斜放身前：篙頂在左上、篙底斜向右下方（船尾）插入水中。
# 雙手都在身前、各在自己一側，不必交叉（蓑衣下手臂很短，越過身體中線會穿出草衣）。
# 每個關鍵姿勢定出竹篙的直線（經過 Q、方向 a），雙手沿篙滑到最容易握的位置。
def _v(name, default): return np.array([float(v) for v in os.environ.get(name, default).split(',')])
ROW_Q = [_v('Q0', '0.0,0.47,0.20'), _v('Q1', '-0.03,0.455,0.20')]
ROW_A = [nrm(_v('A0', '0.10,0.12,-0.07')), nrm(_v('A1', '0.11,0.11,-0.075'))]
TW0, TW1 = float(os.environ.get('TW0', 6)), float(os.environ.get('TW1', 2))
def row_pose(k, x0=(None, None)):
    """k = 0：下篙（篙較直）；k = 1：推到盡頭（上身向右、略前傾，雙手壓低移向右方，篙底斜向船尾）。"""
    p = base_pose()
    tw_ = TW0 + (TW1 - TW0) * k; lean = 3 + 7 * k; side_ = -2 * k
    p.set('Spine', ry(tw_), rx(lean * 0.3), rz(side_)); p.set('Spine1', ry(tw_), rx(lean * 0.35), rz(side_)); p.set('Spine2', ry(tw_ * 0.8), rx(lean * 0.35))
    p.set('Neck', ry(-tw_ * 0.6), rx(-lean * 0.3)); p.set('Head', ry(-tw_ * 0.5), rx(-lean * 0.2))
    p.set('LeftUpLeg', rx(-3 * k)); p.set('RightUpLeg', rx(-3 * k))
    PRO = float(os.environ.get('PRO', 12))            # 雙手向前時肩膀也稍向前（袖子背面不會被拉長）
    p.set('LeftShoulder', ry(-PRO)); p.set('RightShoulder', ry(PRO))
    Q = ROW_Q[0] + (ROW_Q[1] - ROW_Q[0]) * k; a = nrm(ROW_A[0] + (ROW_A[1] - ROW_A[0]) * k)
    xl = grip_on_line(p, 'Left', Q, a, np.arange(0.04, 0.221, 0.03), x0[0])
    xr = grip_on_line(p, 'Right', Q, a, np.arange(-0.17, 0.011, 0.03), x0[1])
    fist(p, 'Left'); fist(p, 'Right')
    return p, (xl, xr)
print('Row plant:'); ROW0, _x0 = row_pose(0.0)
print('Row mid:'); ROWM, _xm = row_pose(0.5, _x0)
print('Row push:'); ROW1, _ = row_pose(1.0, _xm)
ROW_T = 2 * np.pi / 1.6     # 與遊戲原有撐船節奏相同（約 3.9 秒一篙）

def breathe(amp, period, head=0.0):
    def fx(p, t):
        w = np.sin(2 * np.pi * t / period)
        p.r('Spine1', rx(-1.0 * amp * w)); p.r('Spine2', rx(-0.7 * amp * w))
        if head: p.r('Head', rx(head * np.sin(2 * np.pi * t / period + 1)))
    return fx
def nod(p, t):
    p.r('Head', rx(2.2 * max(0, np.sin(2 * np.pi * t / 1.3)) ** 2))

clips = {
    'Idle': sample(rig, [(0, IDLE), (4.4, IDLE)], fx=breathe(0.8, 4.4)),
    'Talk': sample(rig, [(0, IDLE), (3.9, IDLE)], fx=lambda p, t: (breathe(0.8, 3.9)(p, t), nod(p, t))),
    # 下篙 → 用力推（較慢）→ 收篙回到前面（較快）
    'Row': sample(rig, [(0, ROW0), (ROW_T * 0.29, ROWM), (ROW_T * 0.58, ROW1), (ROW_T * 0.79, ROWM), (ROW_T, ROW0)]),
    'PoleRest': sample(rig, [(0, ROW0), (4.4, ROW0)], fx=breathe(0.8, 4.4)),
}

# 檢查：竹篙在船舷的位置（遊戲中放大 1.78 倍；船家站在離船中線 0.32 米，船舷在 0.75 米）
SC = 1.78
def pole_report(name, p, two):
    """竹篙在船舷高度的位置：Idle 時船家面向碼頭，篙在左方（+x）；撐船時面向船外，篙在前方（+z）。"""
    if two:
        gl, _ = grip_of(p, 'Left'); gr, _ = grip_of(p, 'Right'); a = nrm(gl - gr); g0 = gr
    else:
        g0, a = grip_of(p, 'Left')
    gun = (0.17 / SC)                        # 船舷比腳底高約 0.17 米
    k = (g0[1] - gun) / a[1]; at = g0 - a * k
    out_, along = (at[0], at[2]) if not two else (at[2], -at[0])
    print(f'  {name}: pole at gunwale height: {out_ * SC:.2f} m outward (hull side at 0.43 m), {along * SC:.2f} m along')
pole_report('Idle', IDLE, False)
for kk in np.linspace(0, 1, 5):
    bp = anims.blend(ROW0, ROWM, kk * 2) if kk <= 0.5 else anims.blend(ROWM, ROW1, kk * 2 - 1); pole_report(f'Row k={kk:.2f}', bp, True)
    gl, al = grip_of(bp, 'Left'); gr, ar = grip_of(bp, 'Right'); ln = nrm(gl - gr)
    o = rig.fk(bp)
    print(f'     hand/pole misalignment L {np.degrees(np.arccos(np.clip(al @ ln, -1, 1))):.1f} R {np.degrees(np.arccos(np.clip(ar @ ln, -1, 1))):.1f} deg;'
          f' grip gap {np.linalg.norm(gl - gr) * 100:.1f}cm; overlap L {cape_violation(o, "Left") * 100:.2f} R {cape_violation(o, "Right") * 100:.2f}cm;'
          f' pole hidden in cape {max(pole_in_cape(gr + (gl - gr) * t, o) for t in np.linspace(-0.2, 1.15, 10)) * 100:.2f}cm')
if os.environ.get('POSE_ONLY'): sys.exit(0)

# ---------------- 5. 輸出 ----------------
out_bin = bytearray(); bviews = []; accs = []
def add_view(data, target=None):
    while len(out_bin) % 4: out_bin.append(0)
    bv = {'buffer': 0, 'byteOffset': len(out_bin), 'byteLength': len(data)}
    if target: bv['target'] = target
    out_bin.extend(data); bviews.append(bv); return len(bviews) - 1
def add_acc(arr, ctype, typ, target=None, minmax=False):
    arr = np.ascontiguousarray(arr)
    a = {'bufferView': add_view(arr.tobytes(), target), 'componentType': ctype, 'count': len(arr), 'type': typ}
    if minmax: a['min'] = arr.reshape(len(arr), -1).min(0).astype(float).tolist(); a['max'] = arr.reshape(len(arr), -1).max(0).astype(float).tolist()
    accs.append(a); return len(accs) - 1
attrs = {'POSITION': add_acc(P.astype(np.float32), 5126, 'VEC3', 34962, True), 'NORMAL': add_acc(NRM, 5126, 'VEC3', 34962),
         'TEXCOORD_0': add_acc(UV, 5126, 'VEC2', 34962), 'JOINTS_0': add_acc(Jt, 5121, 'VEC4', 34962),
         'WEIGHTS_0': add_acc(Wt.astype(np.float32), 5126, 'VEC4', 34962)}
if os.environ.get('DEBUG_CLASS'):
    cls_col = np.zeros((len(P), 4), np.float32); cls_col[:, 3] = 1
    for m_, c_ in ((hat, (1, 1, 0)), (cape, (1, 0.6, 0)), (hand, (1, 0.7, 0.7)), (head, (0.9, 0.5, 0.4)), (sleeve, (0, 0.4, 1)),
                   (torso, (0, 0.8, 0.2)), (skirt, (0.5, 0, 0.6)), (legs, (0.3, 0.3, 0.3)), (tie, (1, 0, 0))):
        cls_col[m_, :3] = c_
    attrs['COLOR_0'] = add_acc(cls_col, 5126, 'VEC4', 34962)
indices = add_acc(IND.astype(np.uint16 if IND.max() < 65535 else np.uint32), 5123 if IND.max() < 65535 else 5125, 'SCALAR', 34963)
ibm_acc = add_acc(np.stack([m.T.reshape(-1) for m in ibm]).astype(np.float32), 5126, 'MAT4')
mi_v = add_view(mi.tobytes()); mv_v = add_view(DM[mi].astype(np.float32).tobytes())
accs.append({'componentType': 5126, 'count': len(P), 'type': 'VEC3', 'min': np.minimum(DM[mi].min(0), 0).tolist(), 'max': np.maximum(DM[mi].max(0), 0).tolist(),
             'sparse': {'count': len(mi), 'indices': {'bufferView': mi_v, 'componentType': 5125}, 'values': {'bufferView': mv_v}}})
morph_acc = len(accs) - 1
def jpg(im, size, q):
    b = io.BytesIO(); im.resize((size, size), Image.LANCZOS).save(b, 'JPEG', quality=q, optimize=True); return b.getvalue()
images = [{'mimeType': 'image/jpeg', 'bufferView': add_view(jpg(col_img, 2048, 84))},
          {'mimeType': 'image/jpeg', 'bufferView': add_view(jpg(nrm_img, 1024, 90))}]
nodes = [{'name': 'Armature', 'children': [1, 2 + JI['Hips']]}, {'name': 'Boatman_Body', 'mesh': 0, 'skin': 0}]
for n in NAMES:
    nd = {'name': 'mixamorig:' + n, 'translation': rig.rest_t[n].astype(float).tolist()}
    kids = [2 + JI[c] for c in NAMES if PARENT[c] == n]
    if kids: nd['children'] = kids
    nodes.append(nd)
animations = []
for name, tracks in clips.items():
    ch, sm = [], []
    for (n, path), (t, v) in tracks.items():
        ia = add_acc(np.asarray(t, np.float32), 5126, 'SCALAR', minmax=True)
        oa = add_acc(np.asarray(v, np.float32), 5126, 'VEC4' if path == 'rotation' else 'VEC3')
        sm.append({'input': ia, 'output': oa, 'interpolation': 'LINEAR'})
        ch.append({'sampler': len(sm) - 1, 'target': {'node': 2 + JI[n], 'path': path}})
    animations.append({'name': name, 'channels': ch, 'samplers': sm})
extras = {'grip': {s: GRIP[s].tolist() for s in GRIP}, 'poleAxis': {s: POLE_LOCAL[s].tolist() for s in POLE_LOCAL},
          'rowPeriod': ROW_T, 'note': '握篙點與篙軸以手骨的本地座標表示（js/boatman-character.js）'}
out = {'asset': {'version': '2.0', 'generator': 'Tripo + xishan build_boatman.py', 'extras': extras}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes,
       'meshes': [{'name': 'Boatman_Body', 'weights': [0], 'extras': {'targetNames': ['MouthOpen']},
                   'primitives': [{'attributes': attrs, 'indices': indices, 'material': 0, 'targets': [{'POSITION': morph_acc}]}]}],
       'skins': [{'joints': [2 + JI[n] for n in NAMES], 'inverseBindMatrices': ibm_acc}],
       'materials': [{'name': 'Boatman_Cloth', 'doubleSided': True,
                      'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0.0, 'roughnessFactor': 0.88},
                      'normalTexture': {'index': 1, 'scale': 0.8}}],
       'textures': [{'sampler': 0, 'source': 0}, {'sampler': 0, 'source': 1}],
       'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
       'images': images, 'accessors': accs, 'bufferViews': bviews, 'animations': animations, 'buffers': [{'byteLength': len(out_bin)}]}
if os.environ.get('DEBUG_CLASS'): del out['materials'][0]['pbrMetallicRoughness']['baseColorTexture']
js = json.dumps(out, separators=(',', ':'), ensure_ascii=False).encode()
while len(js) % 4: js += b' '
while len(out_bin) % 4: out_bin.append(0)
with open(OUT, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out_bin)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(out_bin), 0x004E4942)); f.write(out_bin)
print('wrote', OUT, os.path.getsize(OUT), 'bytes; clips', list(clips))
