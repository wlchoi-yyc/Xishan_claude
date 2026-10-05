# 柳宗元 Tripo 模型：修正蒙皮、壓縮貼圖、加入劇情動作，輸出遊戲用 GLB。
import json, struct, io, sys, numpy as np
from PIL import Image
from glb import GLB
from rig import qmul, qinv, qrot, qaxis, world
import anims

SRC, OUT = sys.argv[1], sys.argv[2]
g = GLB(SRC); j = g.j
W, par = world(j)
skin = j['skins'][0]
jnames = [j['nodes'][k]['name'].replace('mixamorig:', '') for k in skin['joints']]
node_of = {j['nodes'][i]['name'].replace('mixamorig:', ''): i for i in range(len(j['nodes']))}
prim = j['meshes'][0]['primitives'][0]
A = prim['attributes']
P = g.acc(A['POSITION']); Jt = g.acc(A['JOINTS_0']).astype(np.int32); Wt = g.acc(A['WEIGHTS_0']).astype(np.float64)

# ---------------- 1. 長袍重新蒙皮 ----------------
ji = {n: i for i, n in enumerate(jnames)}
legset = {ji[n] for n in ['Hips', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg']}
dom = Jt[np.arange(len(Jt)), Wt.argmax(1)]
footset = {ji[n] for n in ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']}
legW = sum(Wt[:, k] * np.isin(Jt[:, k], list(legset | footset)) for k in range(4))
x, y, z = P[:, 0], P[:, 1], P[:, 2]
# 褲管：貼近腿軸、在衣襬以下
lx = np.where(x > 0, 0.07, -0.07)
inner = np.hypot(x - lx, z) < 0.05
robe = (legW > 0.5) & (y > 0.035) & ~((y < 0.10) & inner)
robe &= ~np.isin(dom, list(footset))
def sstep(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
h = sstep(0.40, 0.53, y)              # 腰帶以上跟髖
k = sstep(0.17, 0.40, y)              # 大腿 / 小腿分配
s = sstep(-0.075, 0.075, x)           # 左右平滑過渡，避免衣襬裂開
comp = {
    'Hips': h,
    'LeftUpLeg': (1 - h) * k * s, 'RightUpLeg': (1 - h) * k * (1 - s),
    'LeftLeg': (1 - h) * (1 - k) * s, 'RightLeg': (1 - h) * (1 - k) * (1 - s),
}
idx = np.where(robe)[0]
newJ = Jt.copy(); newW = Wt.copy()
# 只把原屬腿／髖的權重部分替換，保留袖子等其他骨骼的份量
nonleg = np.zeros(len(P))
for kk in range(4):
    nonleg += Wt[:, kk] * ~np.isin(Jt[:, kk], list(legset | footset))
for v in idx:
    cand = {}
    for kk in range(4):
        b = Jt[v, kk]
        if b not in legset and b not in footset and Wt[v, kk] > 0: cand[b] = cand.get(b, 0) + Wt[v, kk]
    rest = 1 - sum(cand.values())
    for n, arr in comp.items(): cand[ji[n]] = cand.get(ji[n], 0) + rest * arr[v]
    top = sorted(cand.items(), key=lambda t: -t[1])[:4]
    tot = sum(w for _, w in top)
    for kk in range(4):
        if kk < len(top): newJ[v, kk], newW[v, kk] = top[kk][0], top[kk][1] / tot
        else: newJ[v, kk], newW[v, kk] = 0, 0
print('robe verts reweighted', len(idx), 'of', len(P))

# ---------------- 2. 重建緩衝 ----------------
out_bin = bytearray(); bviews = []; accs = []
def add_view(data, target=None):
    while len(out_bin) % 4: out_bin.append(0)
    bv = {'buffer': 0, 'byteOffset': len(out_bin), 'byteLength': len(data)}
    if target: bv['target'] = target
    out_bin.extend(data); bviews.append(bv); return len(bviews) - 1
def add_acc(arr, ctype, typ, target=None, minmax=False, normalized=False):
    arr = np.ascontiguousarray(arr)
    a = {'bufferView': add_view(arr.tobytes(), target), 'componentType': ctype, 'count': len(arr), 'type': typ}
    if normalized: a['normalized'] = True
    if minmax:
        a['min'] = arr.reshape(len(arr), -1).min(0).astype(float).tolist(); a['max'] = arr.reshape(len(arr), -1).max(0).astype(float).tolist()
    accs.append(a); return len(accs) - 1

newattrs = {
    'POSITION': add_acc(P.astype(np.float32), 5126, 'VEC3', 34962, True),
    'NORMAL': add_acc(g.acc(A['NORMAL']).astype(np.float32), 5126, 'VEC3', 34962),
    'TEXCOORD_0': add_acc(g.acc(A['TEXCOORD_0']).astype(np.float32), 5126, 'VEC2', 34962),
    'JOINTS_0': add_acc(newJ.astype(np.uint8), 5121, 'VEC4', 34962),
    'WEIGHTS_0': add_acc(newW.astype(np.float32), 5126, 'VEC4', 34962),
}
ind = g.acc(prim['indices']).reshape(-1)
indices = add_acc(ind.astype(np.uint16 if ind.max() < 65535 else np.uint32), 5123 if ind.max() < 65535 else 5125, 'SCALAR', 34963)
ibm = add_acc(g.acc(skin['inverseBindMatrices']).astype(np.float32), 5126, 'MAT4')

# ---------------- 3. 貼圖：4096 → 2048 / 1024 ----------------
def img(i):
    bv = j['bufferViews'][j['images'][i]['bufferView']]; o = bv.get('byteOffset', 0)
    return Image.open(io.BytesIO(bytes(g.bin[o:o + bv['byteLength']]))).convert('RGB')
def jpg(im, size, q):
    b = io.BytesIO(); im.resize((size, size), Image.LANCZOS).save(b, 'JPEG', quality=q, optimize=True, progressive=False); return b.getvalue()
mat = j['materials'][0]
nrm_src = mat['normalTexture']['index']; col_src = mat['pbrMetallicRoughness']['baseColorTexture']['index']
images = [
    {'mimeType': 'image/jpeg', 'bufferView': add_view(jpg(img(j['textures'][col_src]['source']), 2048, 84))},
    {'mimeType': 'image/jpeg', 'bufferView': add_view(jpg(img(j['textures'][nrm_src]['source']), 1024, 90))},
]
material = {'name': 'Liu_Robe', 'doubleSided': True,
            'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0.0, 'roughnessFactor': 0.82},
            'normalTexture': {'index': 1, 'scale': 0.8}}

# ---------------- 4. 動畫 ----------------
rest_local = {}
for n, i in node_of.items():
    nd = j['nodes'][i]; rest_local[n] = np.array(nd.get('rotation', [0, 0, 0, 1]), float)
Wpos = {n: W[i][0] for n, i in node_of.items()}
Wrot = {n: W[i][1] for n, i in node_of.items()}
parent_name = {n: (j['nodes'][par[i]]['name'].replace('mixamorig:', '') if i in par else None) for n, i in node_of.items()}

# Tripo 呼吸待機：取出原始軌道
src = j['animations'][0]
def sampler_data(ch):
    s = src['samplers'][ch['sampler']]; return g.acc(s['input']).reshape(-1), g.acc(s['output'])
idle_tracks = {}
for ch in src['channels']:
    n = j['nodes'][ch['target']['node']]['name'].replace('mixamorig:', '')
    if ch['target']['path'] == 'scale': continue
    if ch['target']['path'] == 'translation' and n != 'Hips': continue
    idle_tracks[(n, ch['target']['path'])] = sampler_data(ch)

rig = anims.Rig(Wpos, Wrot, rest_local, parent_name, j['nodes'][node_of['Hips']]['translation'])
rig.rest_t = {n: np.array(j['nodes'][i].get('translation', [0, 0, 0]), float) for n, i in node_of.items()}
# 以待機第一格作為站姿基準
idle0 = {n: v[1][0] for (n, p), v in idle_tracks.items() if p == 'rotation'}
rig.set_idle_base(idle0)
clips = anims.build_all(rig)

animations = []
def add_clip(name, tracks):
    ch, sm = [], []
    for (n, path), (t, v) in tracks.items():
        ia = add_acc(np.asarray(t, np.float32), 5126, 'SCALAR', minmax=True)
        oa = add_acc(np.asarray(v, np.float32), 5126, 'VEC4' if path == 'rotation' else 'VEC3')
        sm.append({'input': ia, 'output': oa, 'interpolation': 'LINEAR'})
        ch.append({'sampler': len(sm) - 1, 'target': {'node': node_of[n], 'path': path}})
    animations.append({'name': name, 'channels': ch, 'samplers': sm})
if 'Idle' not in clips: add_clip('Idle', {k: (t, v) for k, (t, v) in idle_tracks.items()})
for name, tracks in clips.items(): add_clip(name, tracks)

# ---------------- 5. 輸出 ----------------
nodes = j['nodes']
mesh_node = next(i for i, n in enumerate(nodes) if 'mesh' in n)
nodes[mesh_node]['name'] = 'Liu_Body'
out = {
    'asset': {'version': '2.0', 'generator': 'Tripo + xishan build.py'},
    'scene': 0, 'scenes': j['scenes'], 'nodes': nodes,
    'meshes': [{'name': 'Liu_Body', 'primitives': [{'attributes': newattrs, 'indices': indices, 'material': 0}]}],
    'skins': [{'joints': skin['joints'], 'inverseBindMatrices': ibm}],
    'materials': [material], 'textures': [{'sampler': 0, 'source': 0}, {'sampler': 0, 'source': 1}],
    'samplers': [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}],
    'images': images, 'accessors': accs, 'bufferViews': bviews, 'animations': animations,
    'buffers': [{'byteLength': len(out_bin)}],
}
js = json.dumps(out, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(out_bin) % 4: out_bin.append(0)
total = 12 + 8 + len(js) + 8 + len(out_bin)
with open(OUT, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(out_bin), 0x004E4942)); f.write(out_bin)
print('wrote', OUT, total, 'bytes;', 'clips:', [a['name'] for a in animations])
