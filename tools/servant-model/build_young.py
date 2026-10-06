# 年輕僕人（第三關法華寺外，坐在草地上、扭傷了腳）Tripo 模型（沒有骨架）：
# 自動綁骨、計算蒙皮權重、壓縮貼圖、加入口部張合和坐地動作，輸出遊戲用 GLB。
# 用法：python3 tools/servant-model/build_young.py 原始模型.glb assets/characters/young-servant.glb
# （與 build_servant.py 同一方法，只是身體量度、蒙皮分區和動作不同）
import sys, os, io, json, struct
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'liu-model'))
from glb import GLB
import anims
from anims import Pose, rx, ry, rz, sample, breathe, stand

SRC, OUT = sys.argv[1], sys.argv[2]
g = GLB(SRC); j = g.j
prim = j['meshes'][0]['primitives'][0]; A = prim['attributes']
P = g.acc(A['POSITION']).astype(np.float64) * 0.01          # 原檔以厘米為單位：轉成與柳宗元相同的單位（身高約 0.98）
NRM = g.acc(A['NORMAL']).astype(np.float32); UV = g.acc(A['TEXCOORD_0']).astype(np.float32)
IND = g.acc(prim['indices']).reshape(-1)
x, y, z = P.T

# ---------------- 1. 骨架（Mixamo 命名，按身體量度擺放；靜止時所有骨骼不旋轉）----------------
# 量度（模型高 0.98）：肩 0.735、肘 0.61、腕 0.465、髖 0.47、膝 0.27、踝 0.075（由網格橫切面量得）
J = {
    'Hips': (0, 0.50, 0.0), 'Spine': (0, 0.55, 0.0), 'Spine1': (0, 0.61, 0.0), 'Spine2': (0, 0.67, -0.008),
    'Neck': (0, 0.772, -0.015), 'Head': (0, 0.808, -0.008), 'HeadTop_End': (0, 0.98, 0.0),
}
for s, sg in (('Left', 1), ('Right', -1)):
    J.update({
        f'{s}Shoulder': (sg * 0.03, 0.74, -0.02), f'{s}Arm': (sg * 0.118, 0.735, -0.02),
        f'{s}ForeArm': (sg * 0.152, 0.612, -0.022), f'{s}Hand': (sg * 0.178, 0.465, 0.006),
        f'{s}UpLeg': (sg * 0.066, 0.47, 0.0), f'{s}Leg': (sg * 0.072, 0.27, 0.005),
        f'{s}Foot': (sg * 0.08, 0.075, -0.025), f'{s}ToeBase': (sg * 0.082, 0.02, 0.035), f'{s}Toe_End': (sg * 0.084, 0.02, 0.085),
    })
    # 手指（只供動作程式定位手掌方向，不帶權重）
    hand = np.array(J[f'{s}Hand']); d = np.array([sg * 0.05, -1, 0.05]); d /= np.linalg.norm(d)
    for f, off in (('Index', 0.012), ('Middle', 0.0), ('Ring', -0.010), ('Pinky', -0.019)):
        base = hand + d * 0.055 + np.array([0, 0, off])
        for k in range(4): J[f'{s}Hand{f}{k + 1}'] = tuple(base + d * 0.016 * k)
    tb = hand + d * 0.02 + np.array([0, 0, 0.02])
    for k in range(4): J[f'{s}HandThumb{k + 1}'] = tuple(tb + (d + np.array([0, 0, 0.6])) * 0.012 * k)
PARENT = {'Hips': None, 'Spine': 'Hips', 'Spine1': 'Spine', 'Spine2': 'Spine1', 'Neck': 'Spine2', 'Head': 'Neck', 'HeadTop_End': 'Head'}
for s in ('Left', 'Right'):
    PARENT.update({f'{s}Shoulder': 'Spine2', f'{s}Arm': f'{s}Shoulder', f'{s}ForeArm': f'{s}Arm', f'{s}Hand': f'{s}ForeArm',
                   f'{s}UpLeg': 'Hips', f'{s}Leg': f'{s}UpLeg', f'{s}Foot': f'{s}Leg', f'{s}ToeBase': f'{s}Foot', f'{s}Toe_End': f'{s}ToeBase'})
    for f in ('Index', 'Middle', 'Ring', 'Pinky', 'Thumb'):
        for k in range(4): PARENT[f'{s}Hand{f}{k + 1}'] = f'{s}Hand' if k == 0 else f'{s}Hand{f}{k}'
NAMES = list(J.keys()); JI = {n: i for i, n in enumerate(NAMES)}
JP = {n: np.array(v, float) for n, v in J.items()}

# ---------------- 2. 自動蒙皮 ----------------
def seg_dist(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)
def sst(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
SEG = {'Hips': ('Hips', 'Spine'), 'Spine': ('Spine', 'Spine1'), 'Spine1': ('Spine1', 'Spine2'), 'Spine2': ('Spine2', 'Neck'),
       'Neck': ('Neck', 'Head'), 'Head': ('Head', 'HeadTop_End')}
for s in ('Left', 'Right'):
    SEG.update({f'{s}Shoulder': (f'{s}Shoulder', f'{s}Arm'), f'{s}Arm': (f'{s}Arm', f'{s}ForeArm'), f'{s}ForeArm': (f'{s}ForeArm', f'{s}Hand'),
                f'{s}Hand': (f'{s}Hand', f'{s}HandMiddle4'), f'{s}UpLeg': (f'{s}UpLeg', f'{s}Leg'), f'{s}Leg': (f'{s}Leg', f'{s}Foot'),
                f'{s}Foot': (f'{s}Foot', f'{s}ToeBase'), f'{s}ToeBase': (f'{s}ToeBase', f'{s}Toe_End')})
DEF = list(SEG.keys())
D = np.stack([seg_dist(P, JP[a], JP[b]) for a, b in SEG.values()], 1)   # 每個頂點到每節骨的距離
allow = np.zeros_like(D, bool)
col = {n: i for i, n in enumerate(DEF)}
side = np.where(x >= 0, 'Left', 'Right')
arm = ((np.abs(x) > 0.135) & (y > 0.38) & (y < 0.75)) | ((np.abs(x) > 0.108) & (y > 0.645) & (y < 0.775))   # 手最低約 0.40；袖口以上與上衣相連
head = y > 0.80
trous = (y < 0.31) & ~arm            # 0.31 以下兩條褲管分開
skirt = (y >= 0.31) & (y < 0.47) & ~arm   # 上衣下襬與褲頭
torso = ~(arm | head | trous | skirt)
for i in range(len(P)):
    s = side[i]
    if arm[i]: names = [f'{s}Shoulder', f'{s}Arm', f'{s}ForeArm', f'{s}Hand'] + (['Spine2'] if y[i] > 0.68 else [])
    elif head[i]: names = ['Head', 'Neck']
    elif trous[i]: names = [f'{s}UpLeg', f'{s}Leg', f'{s}Foot', f'{s}ToeBase']
    elif torso[i]: names = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder']
    else: names = []
    for n in names: allow[i, col[n]] = True
Wd = np.where(allow, 1.0 / (D ** 2 + 1e-5) ** 2, 0.0)
# 衣襬：與柳宗元長袍相同的髖↔大腿平滑分配（左右過渡，不會在兩腿之間裂開）
h = sst(0.40, 0.49, y); kk = sst(0.26, 0.40, y); sx = sst(-0.05, 0.05, x)
# 上衣下襬、腰帶垂下的帶子與褲頭混在同一高度：以顏色貼圖分辨（褲子較深，亮度約 52–92）。
# 褲子跟大腿；上衣和腰帶跟盆骨，只有前襟下緣部分跟大腿（坐下時搭在腿上，不會被大腿穿過）。
import io as _io
_mat = j['materials'][0]; _src = j['textures'][_mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']
_bv = j['bufferViews'][j['images'][_src]['bufferView']]; _o = _bv.get('byteOffset', 0)
_tex = np.asarray(Image.open(_io.BytesIO(bytes(g.bin[_o:_o + _bv['byteLength']]))).convert('RGB'), np.float64)
_c = _tex[np.clip((UV[:, 1] * _tex.shape[0]).astype(int), 0, _tex.shape[0] - 1), np.clip((UV[:, 0] * _tex.shape[1]).astype(int), 0, _tex.shape[1] - 1)]
vlum = _c @ [0.299, 0.587, 0.114]
trouser_col = (vlum > 52) & (vlum < 92)
for i in np.where(skirt)[0]:
    if not trouser_col[i]:
        Wd[i] = 0
        f = 0.6 * sst(0.0, 0.06, z[i]) * sst(0.44, 0.34, y[i])        # 前襟下緣：部分跟大腿
        Wd[i, col['Hips']] = 1 - f
        Wd[i, col['LeftUpLeg']] = f * sx[i]; Wd[i, col['RightUpLeg']] = f * (1 - sx[i])
        continue
    Wd[i] = 0
    Wd[i, col['Hips']] = h[i]
    Wd[i, col['LeftUpLeg']] = (1 - h[i]) * kk[i] * sx[i]; Wd[i, col['RightUpLeg']] = (1 - h[i]) * kk[i] * (1 - sx[i])
    Wd[i, col['LeftLeg']] = (1 - h[i]) * (1 - kk[i]) * sx[i]; Wd[i, col['RightLeg']] = (1 - h[i]) * (1 - kk[i]) * (1 - sx[i])
Wd /= Wd.sum(1, keepdims=True) + 1e-12
# 沿網格相鄰頂點平滑三次，關節處彎曲時不會有硬摺痕
tri = IND.reshape(-1, 3)
nb = [[] for _ in range(len(P))]
for a, b, c in tri: nb[a] += [b, c]; nb[b] += [a, c]; nb[c] += [a, b]
nb = [np.unique(v) for v in nb]
for _ in range(3):
    Wn = Wd.copy()
    for i in range(len(P)):
        if len(nb[i]): Wn[i] = 0.5 * Wd[i] + 0.5 * Wd[nb[i]].mean(0)
    Wd = Wn
# 原模型沿貼圖接縫把同一位置的頂點分成幾份；權重必須一致，否則轉頭、說話時接縫被撕開，臉上出現裂痕
_, weld = np.unique(np.round(P, 5), axis=0, return_inverse=True); weld = weld.reshape(-1)
Wm = np.zeros((weld.max() + 1, Wd.shape[1])); np.add.at(Wm, weld, Wd); Wd = (Wm / np.bincount(weld)[:, None])[weld]
top = np.argsort(-Wd, 1, kind='stable')[:, :4]
Wt = np.take_along_axis(Wd, top, 1); Wt /= Wt.sum(1, keepdims=True)
Jt = np.vectorize(lambda c: JI[DEF[c]])(top).astype(np.uint8)
print('skin: arm', arm.sum(), 'head', head.sum(), 'trousers', trous.sum(), 'skirt', skirt.sum(), 'torso', torso.sum())

# ---------------- 3. 口部張合（形變）與唇縫 ----------------
LIP = 0.836
wx = 1 - sst(0.012, 0.030, np.abs(x)); wz = sst(0.035, 0.055, z)
w_low = (1 - sst(LIP - 0.0012, LIP + 0.0006, y)) * sst(0.79, 0.81, y)
w_up = sst(LIP - 0.0004, LIP + 0.0012, y) * (1 - sst(LIP + 0.003, LIP + 0.007, y))
DM = np.zeros_like(P)
DM[:, 1] = (-0.0055 * w_low + 0.0008 * w_up) * wx * wz
DM[:, 2] = -0.0012 * w_low * wx * wz
mi = np.where(np.abs(DM).max(1) > 1e-6)[0].astype(np.uint32)
print('mouth morph verts', len(mi))

def img(i):
    bv = j['bufferViews'][j['images'][i]['bufferView']]; o = bv.get('byteOffset', 0)
    return Image.open(io.BytesIO(bytes(g.bin[o:o + bv['byteLength']]))).convert('RGB')
mat = j['materials'][0]
col_img = img(j['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source'])
nrm_img = img(j['textures'][mat['normalTexture']['index']]['source'])
dr = ImageDraw.Draw(col_img); TW, TH = col_img.size; nseg = 0
for t in tri:
    py_ = P[t, 1]
    if not (py_.min() < LIP < py_.max()) or np.abs(P[t, 0]).max() > 0.017 or P[t, 2].min() < 0.045: continue
    pts = []
    for a_, b_ in ((0, 1), (1, 2), (2, 0)):
        ya, yb = py_[a_], py_[b_]
        if (ya - LIP) * (yb - LIP) < 0:
            k = (LIP - ya) / (yb - ya); uv = UV[t[a_]] + k * (UV[t[b_]] - UV[t[a_]])
            xm = abs(P[t[a_], 0] + k * (P[t[b_], 0] - P[t[a_], 0])); pts.append((uv[0] * TW, uv[1] * TH, xm))
    if len(pts) == 2:
        f = 1 - min(1, (pts[0][2] + pts[1][2]) / 2 / 0.017)
        c = tuple(int(v) for v in (70 + 60 * (1 - f), 30 + 40 * (1 - f), 30 + 40 * (1 - f)))
        dr.line([pts[0][:2], pts[1][:2]], fill=c, width=max(2, int(6 * f))); nseg += 1
print('lip seam segments', nseg)

# ---------------- 4. 動作 ----------------
Wpos = {n: JP[n] for n in NAMES}; Wrot = {n: np.array([0, 0, 0, 1.0]) for n in NAMES}
rest_local = {n: np.array([0, 0, 0, 1.0]) for n in NAMES}
parent_name = {n: (PARENT[n] or 'Armature') for n in NAMES}
rig = anims.Rig(Wpos, Wrot, rest_local, parent_name, JP['Hips'])
rig.rest_t = {n: (JP[n] - JP[PARENT[n]] if PARENT[n] else JP[n]) for n in NAMES}
rig.set_idle_base({})
ibm = np.stack([np.eye(4) for _ in NAMES])
for n, i in JI.items(): ibm[i][:3, 3] = -JP[n]
dom = Jt[np.arange(len(Jt)), Wt.argmax(1)]
rig.skin = dict(P=P, J=Jt.astype(np.int32), W=Wt, ibm=ibm, joints=NAMES, robe=np.where(skirt)[0],
                hand={s: np.where(np.isin(dom, [JI[f'{s}Hand']]))[0] for s in ('Left', 'Right')})
# 坐在草地上：右腿向前伸直，左膝屈起（扭傷的左腳踝在身前），左手按在左腳踝上，右手撐在身後地上。
from anims import hinge, reach, curl, orient_hand
S = Pose(rig)
GROUND_HIPS = 0.105                       # 盆骨離地高度（臀部厚度）
S.move(0, GROUND_HIPS - JP['Hips'][1], 0.0)
S.r('Spine', rx(-4)); S.r('Spine1', rx(6)); S.r('Spine2', rx(5)); S.r('Neck', rx(-4)); S.r('Head', rx(-6))
def foot_at(p, side):
    o = rig.fk(p, [f'{side}Foot', f'{side}ToeBase', f'{side}Toe_End']); return o[f'{side}Foot'][0], o[f'{side}Toe_End'][0]
# 右腿伸直（膝微曲），腳跟着地、腳尖向上
best = None
for th in range(-96, -78, 2):
    for kn in range(-16, 1, 2):
        q = S.copy(); q.set('RightUpLeg', rx(th), ry(-4)); q.set('RightLeg', hinge(rig, 'RightLeg', kn))
        a_, _ = foot_at(q, 'Right'); c = abs(a_[1] - 0.06) + 0.2 * abs(kn + 6)
        if best is None or c < best[0]: best = (c, th, kn)
S.set('RightUpLeg', rx(best[1]), ry(-4)); S.set('RightLeg', hinge(rig, 'RightLeg', best[2])); S.set('RightFoot', rx(-30), ry(-12))   # 腳尖自然向上微微外翻
# 左膝屈起，腳掌平放在地上（腳踝離地約 0.075、在身前約 0.24）
best = None
for th in range(-150, -100, 2):
    for kn in range(-150, -90, 2):
        q = S.copy(); q.set('LeftUpLeg', rx(th), ry(6), rz(-6)); q.set('LeftLeg', hinge(rig, 'LeftLeg', kn))
        a_, _ = foot_at(q, 'Left'); c = abs(a_[1] - 0.075) + abs(a_[2] - 0.24)
        if best is None or c < best[0]: best = (c, th, kn)
S.set('LeftUpLeg', rx(best[1]), ry(6), rz(-6)); S.set('LeftLeg', hinge(rig, 'LeftLeg', best[2]))
bestf = None
for ang in range(-80, 81, 2):   # 腳掌放平：腳尖與腳踝同高（減去腳掌厚度）
    q = S.copy(); q.set('LeftFoot', rx(ang)); o = rig.fk(q, ['LeftFoot', 'LeftToe_End'])
    d_ = abs(o['LeftToe_End'][0][1] - 0.02)
    if bestf is None or d_ < bestf[0]: bestf = (d_, ang)
S.set('LeftFoot', rx(bestf[1]))
print('legs: left thigh/knee', best, 'left foot', bestf)
o = rig.fk(S, ['LeftFoot', 'LeftLeg', 'RightFoot'])
print('left ankle', np.round(o['LeftFoot'][0], 3), 'left knee', np.round(o['LeftLeg'][0], 3), 'right ankle', np.round(o['RightFoot'][0], 3))
# 左手按在左腳踝上方（小腿外側），右手撐在身後右方地上
ank = o['LeftFoot'][0]; knee = o['LeftLeg'][0]
lt = ank + (knee - ank) * 0.22 + np.array([0.045, 0.02, 0.0])
print('left hand', reach(S, 'Left', lt, {0: 0, 3: 0}))
d_ = knee - ank; d_ /= np.linalg.norm(d_)
orient_hand(S, 'Left', -d_ + np.array([-0.4, 0, 0.2]), [-1, -0.2, 0]); curl(S, 'Left', 22)
print('right hand', reach(S, 'Right', np.array([-0.2, 0.06, -0.13]), {0: 0, 3: 0}))
orient_hand(S, 'Right', [-0.25, -0.15, -1], [0, -1, 0]); curl(S, 'Right', 10)
def rub(p, t):     # 輕輕揉腳踝：前臂微微前後移動
    w = np.sin(2 * np.pi * t / 1.4)
    p.r('LeftForeArm', hinge(rig, 'LeftForeArm', 3.5 * w)); p.r('LeftHand', rx(4 * w))
def both(*fs):
    def f(p, t):
        for g_ in fs: g_(p, t)
    return f
clips = {
    'Idle': sample(rig, [(0, S), (4.2, S)], fx=both(breathe(0.7, 4.2, 0), rub)),
    'Talk': sample(rig, [(0, S), (4.0, S)], fx=breathe(0.7, 4, 1.4)),   # 說話時停手、輕輕點頭
}
clips['SeatedIdle'] = clips['Idle']; clips['SeatedTalk'] = clips['Talk']

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
# 節點：0 Armature、1 網格、之後是骨骼
nodes = [{'name': 'Armature', 'children': [1, 2 + JI['Hips']]}, {'name': 'YoungServant_Body', 'mesh': 0, 'skin': 0}]
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
out = {'asset': {'version': '2.0', 'generator': 'Tripo + xishan build_young.py'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes,
       'meshes': [{'name': 'YoungServant_Body', 'weights': [0], 'extras': {'targetNames': ['MouthOpen']},
                   'primitives': [{'attributes': attrs, 'indices': indices, 'material': 0, 'targets': [{'POSITION': morph_acc}]}]}],
       'skins': [{'joints': [2 + JI[n] for n in NAMES], 'inverseBindMatrices': ibm_acc}],
       'materials': [{'name': 'YoungServant_Cloth', 'doubleSided': True,
                      'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0.0, 'roughnessFactor': 0.85},
                      'normalTexture': {'index': 1, 'scale': 0.8}}],
       'textures': [{'sampler': 0, 'source': 0}, {'sampler': 0, 'source': 1}],
       'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
       'images': images, 'accessors': accs, 'bufferViews': bviews, 'animations': animations, 'buffers': [{'byteLength': len(out_bin)}]}
js = json.dumps(out, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(out_bin) % 4: out_bin.append(0)
with open(OUT, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out_bin)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(out_bin), 0x004E4942)); f.write(out_bin)
print('wrote', OUT, os.path.getsize(OUT), 'bytes; clips', list(clips))
