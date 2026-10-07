# 只重新產生年輕僕人的動作，其餘（網格、蒙皮、口部形變、貼圖）原封不動沿用遊戲中的 GLB。
# 原始 Tripo 模型不在倉庫內，因此修改 young_pose.py 之後用這個程式更新動作。
# 用法：python3 tools/servant-model/rebuild_young_anims.py assets/characters/young-servant.glb [輸出.glb]
import sys, os, json, struct
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'liu-model')); sys.path.insert(0, HERE)
from glb import GLB
import anims
from young_pose import young_clips

SRC = sys.argv[1]; OUT = sys.argv[2] if len(sys.argv) > 2 else SRC
g = GLB(SRC); j = g.j
skin = j['skins'][0]
node_of = {j['nodes'][i]['name'].replace('mixamorig:', ''): i for i in range(len(j['nodes']))}
NAMES = [j['nodes'][k]['name'].replace('mixamorig:', '') for k in skin['joints']]
JI = {n: i for i, n in enumerate(NAMES)}
PARENT = {n: None for n in NAMES}
for i, nd in enumerate(j['nodes']):
    for c in nd.get('children', []):
        cn = j['nodes'][c]['name'].replace('mixamorig:', '')
        if cn in PARENT and nd['name'].startswith('mixamorig:'): PARENT[cn] = nd['name'].replace('mixamorig:', '')
# 靜止姿勢所有骨骼不旋轉：世界位置＝沿父骨累加平移
rest_t = {n: np.array(j['nodes'][node_of[n]]['translation'], float) for n in NAMES}
JP = {}
def wp(n):
    if n not in JP: JP[n] = rest_t[n] + (wp(PARENT[n]) if PARENT[n] else 0)
    return JP[n]
for n in NAMES: wp(n)

prim = j['meshes'][0]['primitives'][0]; A = prim['attributes']
P = g.acc(A['POSITION']).astype(np.float64)
Jt = g.acc(A['JOINTS_0']).astype(np.int32); Wt = g.acc(A['WEIGHTS_0']).astype(np.float64)
dom = Jt[np.arange(len(Jt)), Wt.argmax(1)]
armset = {s: [JI[n] for n in NAMES if n.startswith(s) and ('Arm' in n or 'Hand' in n)] for s in ('Left', 'Right')}
hand = {s: np.where(np.isin(dom, [JI[f'{s}Hand']]))[0] for s in ('Left', 'Right')}
armW = sum(Wt[:, k] * np.isin(Jt[:, k], armset['Left'] + armset['Right']) for k in range(4))
body = np.where((armW < 0.05) & (P[:, 1] < 0.80))[0]       # 身體、衣服、腿（不含手臂和頭）

Wpos = {n: JP[n] for n in NAMES}; Wrot = {n: np.array([0, 0, 0, 1.0]) for n in NAMES}
rest_local = {n: np.array([0, 0, 0, 1.0]) for n in NAMES}
parent_name = {n: (PARENT[n] or 'Armature') for n in NAMES}
rig = anims.Rig(Wpos, Wrot, rest_local, parent_name, JP['Hips'])
rig.rest_t = rest_t
rig.set_idle_base({})
ibm = g.acc(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
rig.skin = dict(P=P, J=Jt, W=Wt, ibm=ibm, joints=NAMES, robe=body, hand=hand)
clips = young_clips(rig, JP, body)

# ---- 重建二進位：沿用網格、蒙皮、形變、貼圖，換上新動作 ----
out_bin = bytearray(); bviews = []; accs = []; view_map = {}; acc_map = {}
def add_view(data, target=None):
    while len(out_bin) % 4: out_bin.append(0)
    bv = {'buffer': 0, 'byteOffset': len(out_bin), 'byteLength': len(data)}
    if target: bv['target'] = target
    out_bin.extend(data); bviews.append(bv); return len(bviews) - 1
def copy_view(i):
    if i not in view_map:
        bv = j['bufferViews'][i]; o = bv.get('byteOffset', 0)
        n = add_view(bytes(g.bin[o:o + bv['byteLength']]), bv.get('target'))
        if 'byteStride' in bv: bviews[n]['byteStride'] = bv['byteStride']
        view_map[i] = n
    return view_map[i]
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
