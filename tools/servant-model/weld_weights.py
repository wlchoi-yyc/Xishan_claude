# 修正老僕臉上的「裂痕」：模型沿貼圖接縫把同一位置的頂點分成幾份，自動蒙皮時各份得到的骨骼權重不同，
# 轉頭、說話時接縫兩邊移動不一致，網格就被撕開。這裏把同一位置的頂點權重取平均，令接縫兩邊永遠一起移動。
# 用法：python3 tools/servant-model/weld_weights.py assets/characters/old-servant.glb
import sys, os, struct, json
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'liu-model'))
from glb import GLB

path = sys.argv[1]
g = GLB(path); j = g.j
A = j['meshes'][0]['primitives'][0]['attributes']
P = g.acc(A['POSITION']); J = g.acc(A['JOINTS_0']).astype(np.int64); W = g.acc(A['WEIGHTS_0']).astype(np.float64)
nj = len(j['skins'][0]['joints']); n = len(P)
F = np.zeros((n, nj))
for k in range(4): np.add.at(F, (np.arange(n), J[:, k]), W[:, k])
_, inv = np.unique(np.round(P.astype(np.float64), 5), axis=0, return_inverse=True); inv = inv.reshape(-1)
M = np.zeros((inv.max() + 1, nj)); np.add.at(M, inv, F); M /= np.bincount(inv)[:, None]
F = M[inv]
top = np.argsort(-F, 1, kind='stable')[:, :4]
Wt = np.take_along_axis(F, top, 1); Wt /= Wt.sum(1, keepdims=True)
Jt = np.where(Wt > 0, top, 0)

def write(acc_i, arr):
    acc = j['accessors'][acc_i]; bv = j['bufferViews'][acc['bufferView']]
    o = bv.get('byteOffset', 0) + acc.get('byteOffset', 0); b = arr.tobytes()
    assert len(b) <= bv['byteLength'] and bv.get('byteStride') in (None, arr.itemsize * arr.shape[1])
    g.bin[o:o + len(b)] = b
write(A['JOINTS_0'], Jt.astype(np.uint8 if j['accessors'][A['JOINTS_0']]['componentType'] == 5121 else np.uint16))
write(A['WEIGHTS_0'], Wt.astype(np.float32))

# 只改了二進位內容，長度不變：照原樣寫回
with open(path, 'rb') as f: raw = f.read()
jl = struct.unpack_from('<I', raw, 12)[0]; bo = 20 + jl + 8
out = bytearray(raw); out[bo:bo + len(g.bin)] = bytes(g.bin)
with open(path, 'wb') as f: f.write(out)
print('welded skin weights for', n, 'vertices at', inv.max() + 1, 'positions')
