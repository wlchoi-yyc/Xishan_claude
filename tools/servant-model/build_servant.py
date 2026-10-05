# 老僕 Tripo 模型（沒有骨架）：自動綁骨、計算蒙皮權重、壓縮貼圖、加入口部張合和動作，輸出遊戲用 GLB。
# 用法：python3 tools/servant-model/build_servant.py 原始模型.glb assets/characters/old-servant.glb
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
J = {
    'Hips': (0, 0.50, 0.0), 'Spine': (0, 0.55, 0.0), 'Spine1': (0, 0.61, 0.0), 'Spine2': (0, 0.67, -0.005),
    'Neck': (0, 0.765, -0.015), 'Head': (0, 0.805, -0.005), 'HeadTop_End': (0, 0.98, 0.0),
}
for s, sg in (('Left', 1), ('Right', -1)):
    J.update({
        f'{s}Shoulder': (sg * 0.03, 0.745, -0.02), f'{s}Arm': (sg * 0.125, 0.735, -0.02),
        f'{s}ForeArm': (sg * 0.172, 0.595, -0.03), f'{s}Hand': (sg * 0.170, 0.465, -0.005),
        f'{s}UpLeg': (sg * 0.07, 0.48, 0.0), f'{s}Leg': (sg * 0.068, 0.27, 0.0),
        f'{s}Foot': (sg * 0.072, 0.075, -0.015), f'{s}ToeBase': (sg * 0.075, 0.02, 0.05), f'{s}Toe_End': (sg * 0.077, 0.02, 0.10),
    })
    # 手指（只供動作程式定位手掌方向，不帶權重）
    hand = np.array(J[f'{s}Hand']); d = np.array([sg * -0.12, -1, 0.05]); d /= np.linalg.norm(d)
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
arm = ((np.abs(x) > 0.132) & (y > 0.33) & (y < 0.745)) | ((np.abs(x) > 0.10) & (y > 0.66) & (y < 0.77))   # 手最低約 0.33，以下是闊褲管
head = y > 0.80
trous = (y < 0.33) & ~arm
skirt = (y >= 0.33) & (y < 0.50) & ~arm
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
h = sst(0.36, 0.50, y); kk = sst(0.27, 0.42, y); sx = sst(-0.07, 0.07, x)
for i in np.where(skirt)[0]:
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
top = np.argsort(-Wd, 1)[:, :4]
Wt = np.take_along_axis(Wd, top, 1); Wt /= Wt.sum(1, keepdims=True)
Jt = np.vectorize(lambda c: JI[DEF[c]])(top).astype(np.uint8)
print('skin: arm', arm.sum(), 'head', head.sum(), 'trousers', trous.sum(), 'skirt', skirt.sum(), 'torso', torso.sum())

# ---------------- 3. 口部張合（形變）與唇縫 ----------------
LIP = 0.8193
wx = 1 - sst(0.016, 0.040, np.abs(x)); wz = sst(0.045, 0.068, z)
w_low = (1 - sst(LIP - 0.0012, LIP + 0.0006, y)) * sst(0.74, 0.77, y)
w_up = sst(LIP - 0.0004, LIP + 0.0012, y) * (1 - sst(LIP + 0.003, LIP + 0.007, y))
DM = np.zeros_like(P)
DM[:, 1] = (-0.0075 * w_low + 0.0009 * w_up) * wx * wz
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
    if not (py_.min() < LIP < py_.max()) or np.abs(P[t, 0]).max() > 0.021 or P[t, 2].min() < 0.06: continue
    pts = []
    for a_, b_ in ((0, 1), (1, 2), (2, 0)):
        ya, yb = py_[a_], py_[b_]
        if (ya - LIP) * (yb - LIP) < 0:
            k = (LIP - ya) / (yb - ya); uv = UV[t[a_]] + k * (UV[t[b_]] - UV[t[a_]])
            xm = abs(P[t[a_], 0] + k * (P[t[b_], 0] - P[t[a_], 0])); pts.append((uv[0] * TW, uv[1] * TH, xm))
    if len(pts) == 2:
        f = 1 - min(1, (pts[0][2] + pts[1][2]) / 2 / 0.021)
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
# 原模型雙手已自然垂在身旁：不移動手臂（手與衣服在網格上相連，移動手臂會扯破衣服），只加入駝背
S = Pose(rig)
# 老人微微駝背，頭稍抬起望人
S.r('Spine1', rx(5)); S.r('Spine2', rx(4)); S.r('Neck', rx(-3)); S.r('Head', rx(-4))
clips = {
    'Idle': sample(rig, [(0, S), (4.5, S)], fx=breathe(0.7, 4.5, 0)),
    'Talk': sample(rig, [(0, S), (4.0, S)], fx=breathe(0.7, 4, 1.2)),
}
# 鞠躬：只彎上背與頸，雙臂反向補償，手的世界方向不變 → 手仍貼着衣襬，不會撕裂
bow = S.copy(); bow.r('Spine1', rx(6)); bow.r('Spine2', rx(7)); bow.r('Neck', rx(4)); bow.r('Head', rx(9))
for s_ in ('Left', 'Right'): bow.r(f'{s_}Arm', rx(-13))
clips['Bow'] = sample(rig, [(0, S), (1.1, bow), (2.1, bow), (3.3, S)])
clips['SeatedIdle'] = clips['Idle']; clips['SeatedTalk'] = clips['Talk']   # 保持介面一致（老僕只會站着）

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
nodes = [{'name': 'Armature', 'children': [1, 2 + JI['Hips']]}, {'name': 'Servant_Body', 'mesh': 0, 'skin': 0}]
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
out = {'asset': {'version': '2.0', 'generator': 'Tripo + xishan build_servant.py'}, 'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': nodes,
       'meshes': [{'name': 'Servant_Body', 'weights': [0], 'extras': {'targetNames': ['MouthOpen']},
                   'primitives': [{'attributes': attrs, 'indices': indices, 'material': 0, 'targets': [{'POSITION': morph_acc}]}]}],
       'skins': [{'joints': [2 + JI[n] for n in NAMES], 'inverseBindMatrices': ibm_acc}],
       'materials': [{'name': 'Servant_Cloth', 'doubleSided': True,
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
