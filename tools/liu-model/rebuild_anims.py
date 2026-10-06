# 只重新產生柳宗元的動作，其餘（網格、蒙皮、口部形變、貼圖）原封不動沿用遊戲中的 GLB。
# 原始 Tripo 骨架模型不在倉庫內，因此修改 anims.py 之後用這個程式更新動作。
# 用法：python3 tools/liu-model/rebuild_anims.py assets/characters/liu-zongyuan.glb [輸出.glb]
import sys, os, json, struct, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb import GLB
from rig import world
import anims

SRC = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else SRC
g = GLB(SRC); j = g.j
W, par = world(j)
skin = j['skins'][0]
jnames = [j['nodes'][k]['name'].replace('mixamorig:', '') for k in skin['joints']]
node_of = {j['nodes'][i]['name'].replace('mixamorig:', ''): i for i in range(len(j['nodes']))}
prim = j['meshes'][0]['primitives'][0]; A = prim['attributes']
P = g.acc(A['POSITION']).astype(np.float64)
Jt = g.acc(A['JOINTS_0']).astype(np.int32); Wt = g.acc(A['WEIGHTS_0']).astype(np.float64)

# 長袍頂點：與 build.py 相同的判斷（主要跟腿／髖移動、在鞋子以上）
ji = {n: i for i, n in enumerate(jnames)}
legset = [ji[n] for n in ['Hips', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg']]
footset = [ji[n] for n in ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']]
legW = sum(Wt[:, k] * np.isin(Jt[:, k], legset + footset) for k in range(4))
dom = Jt[np.arange(len(Jt)), Wt.argmax(1)]
x, y, z = P.T
inner = np.hypot(x - np.where(x > 0, 0.07, -0.07), z) < 0.05
robe = (legW > 0.5) & (y > 0.035) & ~((y < 0.10) & inner) & ~np.isin(dom, footset)
hand_of = {s: np.where(np.isin(dom, [ji[n] for n in jnames if n.startswith(s + 'Hand')]))[0] for s in ('Left', 'Right')}

rest_local = {n: np.array(j['nodes'][i].get('rotation', [0, 0, 0, 1]), float) for n, i in node_of.items()}
Wpos = {n: W[i][0] for n, i in node_of.items()}; Wrot = {n: W[i][1] for n, i in node_of.items()}
parent_name = {n: (j['nodes'][par[i]]['name'].replace('mixamorig:', '') if i in par else None) for n, i in node_of.items()}
rig = anims.Rig(Wpos, Wrot, rest_local, parent_name, j['nodes'][node_of['Hips']]['translation'])
rig.rest_t = {n: np.array(j['nodes'][i].get('translation', [0, 0, 0]), float) for n, i in node_of.items()}
rig.set_idle_base({})            # 以模型本身的靜止姿勢為基準（不再沿用 Tripo 待機的垂肩）
ibm_m = g.acc(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
rig.skin = dict(P=P, J=Jt, W=Wt, ibm=ibm_m, joints=jnames, robe=np.where(robe)[0], hand=hand_of)
clips = anims.build_all(rig)

# ---- 重建二進位：沿用網格、蒙皮、形變、貼圖的資料，換上新動作 ----
out_bin = bytearray(); bviews = []; accs = []; view_map = {}
def add_view(data, target=None):
    while len(out_bin) % 4: out_bin.append(0)
    bv = {'buffer': 0, 'byteOffset': len(out_bin), 'byteLength': len(data)}
    if target: bv['target'] = target
    out_bin.extend(data); bviews.append(bv); return len(bviews) - 1
def copy_view(i):
    if i not in view_map:
        bv = j['bufferViews'][i]; o = bv.get('byteOffset', 0)
        n = add_view(bytes(g.bin[o:o + bv['byteLength']]), bv.get('target'))
        for k in ('byteStride',):
            if k in bv: bviews[n][k] = bv[k]
        view_map[i] = n
    return view_map[i]
acc_map = {}
def copy_acc(i):
    if i not in acc_map:
        a = json.loads(json.dumps(j['accessors'][i]))
        if 'bufferView' in a: a['bufferView'] = copy_view(a['bufferView'])
        if 'sparse' in a:
            a['sparse']['indices']['bufferView'] = copy_view(a['sparse']['indices']['bufferView'])
            a['sparse']['values']['bufferView'] = copy_view(a['sparse']['values']['bufferView'])
        accs.append(a); acc_map[i] = len(accs) - 1
    return acc_map[i]
mesh = json.loads(json.dumps(j['meshes'][0])); pr = mesh['primitives'][0]
pr['attributes'] = {k: copy_acc(v) for k, v in pr['attributes'].items()}
pr['indices'] = copy_acc(pr['indices'])
pr['targets'] = [{k: copy_acc(v) for k, v in t.items()} for t in pr.get('targets', [])]
skins = [{'joints': skin['joints'], 'inverseBindMatrices': copy_acc(skin['inverseBindMatrices'])}]
images = [{'mimeType': im['mimeType'], 'bufferView': copy_view(im['bufferView'])} for im in j['images']]
def add_acc(arr, ctype, typ, minmax=False):
    arr = np.ascontiguousarray(arr)
    a = {'bufferView': add_view(arr.tobytes()), 'componentType': ctype, 'count': len(arr), 'type': typ}
    if minmax: a['min'] = arr.reshape(len(arr), -1).min(0).astype(float).tolist(); a['max'] = arr.reshape(len(arr), -1).max(0).astype(float).tolist()
    accs.append(a); return len(accs) - 1
animations = []
for name, tracks in clips.items():
    ch, sm = [], []
    for (n, path), (t, v) in tracks.items():
        ia = add_acc(np.asarray(t, np.float32), 5126, 'SCALAR', minmax=True)
        oa = add_acc(np.asarray(v, np.float32), 5126, 'VEC4' if path == 'rotation' else 'VEC3')
        sm.append({'input': ia, 'output': oa, 'interpolation': 'LINEAR'})
        ch.append({'sampler': len(sm) - 1, 'target': {'node': node_of[n], 'path': path}})
    animations.append({'name': name, 'channels': ch, 'samplers': sm})
out = dict(j); out.update(meshes=[mesh], skins=skins, images=images, accessors=accs, bufferViews=bviews,
                         animations=animations, buffers=[{'byteLength': len(out_bin)}])
js = json.dumps(out, separators=(',', ':'), ensure_ascii=False).encode()
while len(js) % 4: js += b' '
while len(out_bin) % 4: out_bin.append(0)
with open(OUT, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out_bin)))
    f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
    f.write(struct.pack('<II', len(out_bin), 0x004E4942)); f.write(out_bin)
print('wrote', OUT, os.path.getsize(OUT), 'bytes; clips', [a['name'] for a in animations])
