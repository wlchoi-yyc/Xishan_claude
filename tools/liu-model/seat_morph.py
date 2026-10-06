# 坐石時長袍底面貼平石面：加入形變目標 SeatFlat。
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
x, y, z = Ps.T; dz = z - hips[2]; h = y - SEAT_H
u = 1 / SCALE   # 1 米（遊戲）＝ u 模型單位
# 只影響：石面範圍內（左右 ±0.24 米、臀後 0.22 米至臀前 0.13 米）、朝下的長袍底面、離石面 13 厘米以內
foot = (1 - sst(0.20 * u, 0.24 * u, np.abs(x - hips[0]))) * sst(-0.26 * u, -0.20 * u, dz) * (1 - sst(0.10 * u, 0.14 * u, dz))
down = sst(0.15, 0.45, -Ns[:, 1])
near = np.where(h >= 0, 1 - sst(0.05 * u, 0.13 * u, h), 1.0)
w = foot * down * near
dW = np.zeros_like(Ps); dW[:, 1] = -h * w            # 坐姿空間中：向石面移動
dW[:, 1] -= 0.002 * u * (w > 0.5)                     # 稍為壓進石面 2 毫米，不留細縫
# 換回綁定姿勢的位移：坐姿位置 = B·(v + d)，所以 d = B₃ₓ₃⁻¹·ΔW
D = np.einsum('vij,vj->vi', np.linalg.inv(B[:, :3, :3]), dW)
mi = np.where(np.abs(D).max(1) > 1e-6)[0].astype(np.uint32)
print('seat flatten verts', len(mi), 'max move (m)', round(float(np.abs(dW[:, 1]).max() * SCALE), 3))

# ---- 加入形變目標（附加在二進位尾端）----
binb = g.bin
def add_view(data):
    while len(binb) % 4: binb.append(0)
    j['bufferViews'].append({'buffer': 0, 'byteOffset': len(binb), 'byteLength': len(data)}); binb.extend(data)
    return len(j['bufferViews']) - 1
names_t = mesh.setdefault('extras', {}).setdefault('targetNames', [])
if 'SeatFlat' in names_t: sys.exit('SeatFlat already present')
iv = add_view(mi.tobytes()); vv = add_view(D[mi].astype(np.float32).tobytes())
j['accessors'].append({'componentType': 5126, 'count': len(P), 'type': 'VEC3',
                       'min': np.minimum(D[mi].min(0), 0).astype(float).tolist(), 'max': np.maximum(D[mi].max(0), 0).astype(float).tolist(),
                       'sparse': {'count': len(mi), 'indices': {'bufferView': iv, 'componentType': 5125}, 'values': {'bufferView': vv}}})
prim.setdefault('targets', []).append({'POSITION': len(j['accessors']) - 1})
names_t.append('SeatFlat'); mesh['weights'] = list(mesh.get('weights', [])) + [0]
while len(binb) % 4: binb.append(0)
j['buffers'][0]['byteLength'] = len(binb)
js = json.dumps(j, separators=(',', ':'), ensure_ascii=False).encode()
while len(js) % 4: js += b' '
with open(path, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binb)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(binb), 0x004E4942)); f.write(bytes(binb))
print('wrote', path, os.path.getsize(path), 'bytes; morph targets', names_t)
