# 劇情動作：以「角色座標」（+X 角色左方、+Y 上、+Z 前方）描述每節骨骼相對父骨骼的轉動。
import numpy as np
from rig import qmul, qinv, qaxis, qrot
import itertools

FPS = 24
def rx(d): return qaxis([1, 0, 0], np.radians(d))
def ry(d): return qaxis([0, 1, 0], np.radians(d))
def rz(d): return qaxis([0, 0, 1], np.radians(d))
def chain(*qs):
    """依次套用：chain(a, b) = 先 a 後 b。"""
    q = np.array([0, 0, 0, 1.0])
    for o in qs: q = qmul(o, q)
    return q
def slerp(a, b, t):
    d = np.dot(a, b)
    if d < 0: b = -b; d = -d
    if d > 0.9995: r = a + (b - a) * t; return r / np.linalg.norm(r)
    th = np.arccos(d); return (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)
def ease(t): return t * t * (3 - 2 * t)

FINGERS = [f'{s}Hand{f}{i}' for s in ('Left', 'Right') for f in ('Index', 'Middle', 'Ring', 'Pinky') for i in (1, 2, 3)]

class Rig:
    def __init__(s, Wpos, Wrot, rest_local, parent, hips_t):
        s.Wpos, s.Wrot, s.rest, s.parent = Wpos, Wrot, rest_local, parent
        s.hips_t = np.array(hips_t, float)
        s.bones = [b for b in Wpos if b in rest_local and parent.get(b) is not None and b not in ('Armature',) and not b.startswith('tripo')]
        s.base = {}
    def Wp(s, b):
        p = s.parent[b]
        return s.Wrot[p] if p in s.Wrot else np.array([0, 0, 0, 1.0])
    def local(s, b, R):  # L' = Wp^-1 · R · Wb
        return qmul(qinv(s.Wp(b)), qmul(R, s.Wrot[b]))
    def R_from_local(s, b, L):
        return qmul(s.Wp(b), qmul(L, qinv(s.Wrot[b])))
    def set_idle_base(s, idle0):
        for b in s.bones:
            L = idle0.get(b, s.rest[b])
            s.base[b] = s.R_from_local(b, L)
    def fk(s, p, want=None):
        out = {}
        def get(b):
            if b in out: return out[b]
            L = s.local(b, p.R[b]); t = s.hips_t + p.t if b == 'Hips' else s.rest_t[b]
            pb = s.parent[b]
            if pb not in s.bones: out[b] = (t, L)
            else: pt, pr = get(pb); out[b] = (pt + qrot(pr, t), qmul(pr, L))
            return out[b]
        for b in (want or s.bones): get(b)
        return out
    def dir(s, b, child):
        v = s.Wpos[child] - s.Wpos[b]; return v / np.linalg.norm(v)

class Pose:
    def __init__(s, rig, R=None, t=None):
        s.rig = rig; s.R = dict(R if R is not None else rig.base); s.t = np.zeros(3) if t is None else np.array(t, float)
    def copy(s): return Pose(s.rig, s.R, s.t.copy())
    def r(s, b, *ops):
        s.R[b] = qmul(chain(*ops), s.R[b]); return s
    def set(s, b, *ops):
        s.R[b] = chain(*ops); return s
    def move(s, dx=0, dy=0, dz=0): s.t = s.t + [dx, dy, dz]; return s

def blend(a, b, t):
    p = a.copy()
    for k in a.R: p.R[k] = slerp(a.R[k], b.R[k], t)
    p.t = a.t + (b.t - a.t) * t
    return p

def sample(rig, keys, loop=False, fx=None, fps=FPS):
    """keys: [(time, Pose)]；fx(pose, t) 可加入呼吸等細微擺動。"""
    T = keys[-1][0]; n = int(round(T * fps)) + 1
    times = np.linspace(0, T, n)
    frames = []
    for t in times:
        i = max(i for i, (kt, _) in enumerate(keys) if kt <= t + 1e-9)
        if i == len(keys) - 1: p = keys[-1][1].copy()
        else:
            (t0, a), (t1, b) = keys[i], keys[i + 1]
            p = blend(a, b, ease((t - t0) / (t1 - t0)))
        if fx: fx(p, t)
        frames.append(p)
    tracks = {}
    for b in rig.bones:
        q = np.array([rig.local(b, f.R[b]) for f in frames])
        for k in range(1, len(q)):
            if np.dot(q[k], q[k - 1]) < 0: q[k] = -q[k]
        if np.abs(q - q[0]).max() < 1e-4: tracks[(b, 'rotation')] = ([0.0], q[:1])
        else: tracks[(b, 'rotation')] = (times, q)
    tr = np.array([rig.hips_t + f.t for f in frames])
    tracks[('Hips', 'translation')] = (times, tr) if np.abs(tr - tr[0]).max() > 1e-5 else ([0.0], tr[:1])
    return tracks

# ---------------------------------------------------------------- 姿勢
def local_rot(p, b, q):
    """在骨骼自身座標內再轉動（Mixamo 手指以本地 X 軸屈曲）。"""
    L = p.rig.local(b, p.R[b]); p.R[b] = p.rig.R_from_local(b, qmul(L, q)); return p
def curl(p, side, amt, thumb=0):
    sg = -1 if side == 'Left' else 1
    for f in ('Index', 'Middle', 'Ring', 'Pinky'):
        for i in (1, 2, 3):
            local_rot(p, f'{side}Hand{f}{i}', qaxis([1, 0, 0], np.radians(sg * amt * (1.0 if i > 1 else .7))))
    return p

def hinge(rig, b, deg):
    """以骨骼在靜止姿勢的方向計算『向前屈曲』的鉸鏈軸。"""
    kids = {'LeftForeArm': 'LeftHand', 'RightForeArm': 'RightHand', 'LeftLeg': 'LeftFoot', 'RightLeg': 'RightFoot',
            'LeftArm': 'LeftForeArm', 'RightArm': 'RightForeArm', 'LeftHand': 'LeftHandMiddle1', 'RightHand': 'RightHandMiddle1'}
    if b in kids: c = kids[b]
    else:
        nm = b[:-1] + str(int(b[-1]) + 1); c = nm if nm in rig.Wpos else None
    d = rig.dir(b, c) if c else np.array([0, -1, 0.0])
    ax = np.cross([0, 0, 1], d)
    if np.linalg.norm(ax) < 1e-3: ax = np.array([1, 0, 0.0])
    if b.startswith('Right') and ('Hand' in b and b not in ('RightHand',)):
        pass
    return qaxis(ax, np.radians(-deg))

def tw(rig, b, deg):
    c = {'LeftArm': 'LeftForeArm', 'RightArm': 'RightForeArm', 'LeftForeArm': 'LeftHand', 'RightForeArm': 'RightHand'}[b]
    return qaxis(rig.dir(b, c), np.radians(deg))

def arm(p, side, twist, out, fwd, cross, elbow):
    """twist：上臂自轉；out：側舉；fwd：前舉；cross：水平內收；elbow：屈肘（左右對稱數值）。"""
    sg = 1 if side == 'Left' else -1; rig = p.rig
    p.set(f'{side}Arm', tw(rig, f'{side}Arm', sg * twist), rz(sg * out), rx(-fwd), ry(-sg * cross))
    p.set(f'{side}ForeArm', hinge(rig, f'{side}ForeArm', elbow))
    return p

def reach(p, side, target, prefer=None, elbow_max=None):
    """在角色座標中把手腕移到 target（粗略網格搜尋＋細化）。elbow_max：手肘最高位置（避免抬肘）。"""
    target = np.asarray(target, float); prefer = prefer or {}
    want = [f'{side}Hand', f'{side}ForeArm']
    def cost(x):
        q = p.copy(); arm(q, side, *x)
        o = p.rig.fk(q, want); h = o[f'{side}Hand'][0]
        c = np.linalg.norm(h - target)
        if elbow_max is not None: c += 3 * max(0.0, o[f'{side}ForeArm'][0][1] - elbow_max)
        c += sum(0.0004 * abs(x[i] - v) for i, v in prefer.items())
        return c
    grid = itertools.product(range(-90, 91, 30), range(-30, 61, 15), range(-20, 151, 20), range(-30, 61, 15), range(0, 141, 20))
    best = min(grid, key=cost); best = list(best)
    step = [15, 8, 10, 8, 10]
    for _ in range(5):
        for i in range(5):
            for d in (-step[i], step[i]):
                x = best.copy(); x[i] += d
                if cost(x) < cost(best): best = x
        step = [max(1, s / 2) for s in step]
    arm(p, side, *best)
    return best

def orient_hand(p, side, f_des, n_des):
    """把手掌轉到指定方向：f_des 手指方向、n_des 掌心朝向（角色座標）。"""
    rig = p.rig; sg = 1 if side == 'Left' else -1
    H, F = f'{side}Hand', f'{side}ForeArm'
    Wr = rig.Wrot[H]
    f_loc = qrot(qinv(Wr), rig.dir(H, f'{side}HandMiddle1'))
    n_loc = qrot(qinv(Wr), [-sg, 0, 0])          # 靜止 A 字姿勢時掌心朝向大腿
    o = rig.fk(p, [H]); Wh = o[H][1]
    f_now = qrot(Wh, f_loc); n_now = qrot(Wh, n_loc)
    def frame(f, n):
        f = np.asarray(f, float); f /= np.linalg.norm(f)
        n = np.asarray(n, float); n = n - f * np.dot(n, f); n /= np.linalg.norm(n)
        return np.stack([f, n, np.cross(f, n)], 1)
    M = frame(f_des, n_des) @ frame(f_now, n_now).T
    # 旋轉矩陣 → 四元數
    w = np.sqrt(max(0, 1 + M[0, 0] + M[1, 1] + M[2, 2])) / 2
    x = np.copysign(np.sqrt(max(0, 1 + M[0, 0] - M[1, 1] - M[2, 2])) / 2, M[2, 1] - M[1, 2])
    y = np.copysign(np.sqrt(max(0, 1 - M[0, 0] + M[1, 1] - M[2, 2])) / 2, M[0, 2] - M[2, 0])
    z = np.copysign(np.sqrt(max(0, 1 - M[0, 0] - M[1, 1] + M[2, 2])) / 2, M[1, 0] - M[0, 1])
    Q = np.array([x, y, z, w])
    Dp = qmul(o[F][1], qinv(rig.Wrot[F]))       # 前臂的累積轉動
    p.R[H] = qmul(qinv(Dp), qmul(Q, qmul(Dp, p.R[H])))
    return p

def hands_on_knees(p, lift=0.045, along=0.62, fingers=14):
    lifts = lift if isinstance(lift, (tuple, list)) else (lift, lift)
    """雙手分開，掌心向下輕放在兩膝上，手指自然微曲。"""
    rig = p.rig
    for side, sg in (('Left', 1), ('Right', -1)):
        o = rig.fk(p, [f'{side}UpLeg', f'{side}Leg'])
        hip, knee = o[f'{side}UpLeg'][0], o[f'{side}Leg'][0]
        wrist = hip + (knee - hip) * along + np.array([-sg * 0.005, lifts[0 if side == 'Left' else 1], 0])
        print('knee', side, reach(p, side, wrist, {0: 0, 1: 10, 3: 0}))
        d = knee - hip; d[1] = 0; d /= np.linalg.norm(d)
        orient_hand(p, side, d + np.array([0, -0.12, 0]), [0, -1, 0])   # 手掌近乎平放在腿上
        curl(p, side, fingers)
    return p


# ---------------------------------------------------------------- 蒙皮計算（量度手與衣服的距離）
def qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

def skin_points(rig, p, idx):
    sk = rig.skin; o = rig.fk(p)
    S = {}
    out = np.zeros((len(idx), 3))
    for k in range(4):
        js = sk['J'][idx, k]; ws = sk['W'][idx, k]
        for jn in np.unique(js):
            if jn not in S:
                name = sk['joints'][jn]
                pos, q = o[name] if name in o else (rig.Wpos[name], rig.Wrot[name])
                M = np.eye(4); M[:3, :3] = qmat(q); M[:3, 3] = pos
                S[jn] = M @ sk['ibm'][jn]
            m = js == jn
            v = np.c_[sk['P'][idx[m]], np.ones(m.sum())]
            out[m] += ws[m, None] * (v @ S[jn].T)[:, :3]
    return out

def hand_clearance_down(rig, p, side):
    """手掌（手的頂點）比其下方 2.5 厘米範圍內的衣服高出多少（負數＝陷進去）。"""
    H = skin_points(rig, p, rig.skin['hand'][side]); R = skin_points(rig, p, rig.skin['robe'])
    worst = 1.0
    for h in H[::3]:
        # 手正下方及正上方（5 厘米內）的衣面：若有衣服蓋在手上，代表手陷進衣服裏
        near = (np.hypot(R[:, 0] - h[0], R[:, 2] - h[2]) < 0.014) & (R[:, 1] < h[1] + 0.05)
        if near.any(): worst = min(worst, h[1] - R[near, 1].max())
    return worst

def hand_clearance_side(rig, p, side):
    """站立時手與長袍側面的距離（負數＝手陷進衣服裏）。"""
    H = skin_points(rig, p, rig.skin['hand'][side]); R = skin_points(rig, p, rig.skin['robe'])
    c = rig.hips_t + p.t
    worst = 1.0
    ra = np.arctan2(R[:, 0] - c[0], R[:, 2] - c[2]); rr = np.hypot(R[:, 0] - c[0], R[:, 2] - c[2])
    for h in H[::3]:
        a = np.arctan2(h[0] - c[0], h[2] - c[2]); hr = np.hypot(h[0] - c[0], h[2] - c[2])
        m = (np.abs(R[:, 1] - h[1]) < 0.012) & (np.abs(np.angle(np.exp(1j * (ra - a)))) < 0.12)
        if m.any(): worst = min(worst, hr - rr[m].max())
    return worst

_STAND = {}
STAND_ARM_DOWN = 16   # 上臂由靜止 A 字姿勢向下轉的角度
def stand(rig):
    if 'p' in _STAND: return _STAND['p'].copy()
    p = Pose(rig)
    # 肩膀保持模型原本的高度（不垂肩）；上臂由 A 字姿勢自然垂下、略向前，手肘微曲
    for side, sg in (('Left', 1), ('Right', -1)):
        p.set(f'{side}Arm', rz(-sg * STAND_ARM_DOWN), rx(-4))
        p.set(f'{side}ForeArm', hinge(rig, f'{side}ForeArm', 10))
    curl(p, 'Left', 12); curl(p, 'Right', 12)
    # 雙手自然垂下時不要陷進長袍：逐步把手臂稍為張開，直至手離衣服約 0.8 厘米
    if getattr(rig, 'skin', None):
        for side, sg in (('Left', 1), ('Right', -1)):
            for _ in range(15):
                c = hand_clearance_side(rig, p, side)
                if c > 0.0045: break
                p.r(f'{side}Arm', rz(sg * 1.5))
            print('stand hand clearance', side, round(hand_clearance_side(rig, p, side), 4))
    _STAND['p'] = p
    return p.copy()

def hands_behind(rig, p=None):
    """負手：雙手在背後相握，文人散步、遠眺的姿態。"""
    p = (p or stand(rig)).copy()
    for side, sg in (('Left', 1), ('Right', -1)):
        p.set(f'{side}Arm', rz(-sg * 8), rx(20))
        p.set(f'{side}ForeArm', rz(-sg * 62), rx(22))
        p.set(f'{side}Hand', rz(-sg * 15))
    return p

SEAT = {}
def seated(rig):
    """坐在石上：大腿稍向下斜、小腿垂直放下，雙腿併攏；雙手自然垂在身旁。"""
    p = stand(rig).copy()
    p.r('Spine', rx(2))
    for side, sg in (('Left', 1), ('Right', -1)):
        p.set(f'{side}UpLeg', rx(-76), ry(sg * 2))
        p.set(f'{side}Leg', hinge(rig, f'{side}Leg', -76))
        p.set(f'{side}Foot', rx(0))
    # 腳掌剛好着地
    o = rig.fk(p, ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot'])
    low = min(o[n][0][1] for n in ('LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot'))
    p.move(0, 0.012 - low, 0)
    p.r('Neck', rx(-2)); p.r('Head', rx(-2))
    # 正襟危坐：雙手分開，掌心向下輕放在大腿上（不垂在身旁，免得手臂向外撐開）
    lift = [0.03, 0.03]
    for _ in range(6):
        q = p.copy(); hands_on_knees(q, tuple(lift), along=0.68, fingers=5)
        if not getattr(rig, 'skin', None): break
        cl = [hand_clearance_down(rig, q, s) for s in ('Left', 'Right')]
        print('seated hand clearance', np.round(cl, 4))
        if min(cl) > 0.002: break
        lift = [l + max(0.0, 0.004 - c) for l, c in zip(lift, cl)]
    p = q
    if getattr(rig, 'skin', None):
        # 座位：臀部正下方（盆骨左右各 7 厘米、前後各 5 厘米）長袍底面的最低點＝石面高度
        hips = rig.hips_t + p.t
        R = skin_points(rig, p, rig.skin['robe'])
        m = (np.abs(R[:, 0] - hips[0]) < 0.07) & (np.abs(R[:, 2] - hips[2]) < 0.05) & (R[:, 1] < hips[1])
        SEAT.update(top=float(R[m, 1].min()), z=float(hips[2]), hips=float(hips[1]))
        # 臀下長袍底面的前後範圍（石面要承托這一段）
        band = (np.abs(R[:, 0] - hips[0]) < 0.07) & (R[:, 1] < SEAT['top'] + 0.015) & (R[:, 1] > SEAT['top'] - 0.003) & (np.abs(R[:, 2] - hips[2]) < 0.2)
        SEAT.update(zmin=float(R[band, 2].min()), zmax=float(R[band, 2].max()))
        print('seat (model units): top', round(SEAT['top'], 4), 'hips', round(SEAT['hips'], 4), 'center z', round(SEAT['z'], 4),
              'contact z', round(SEAT['zmin'], 4), '..', round(SEAT['zmax'], 4))
    return p

def lying(rig):
    """醉臥：仰臥，右臂枕在頭下，左手放在胸前，膝微屈。"""
    p = stand(rig).copy()
    p.set('Hips', rx(-90))
    p.move(0, -0.42, 0.0)
    p.r('Spine', rx(2)); p.r('Neck', rx(-12)); p.r('Head', ry(18), rx(-8))
    p.set('LeftUpLeg', rx(-22), rz(6)); p.set('LeftLeg', hinge(rig, 'LeftLeg', -40))
    p.set('RightUpLeg', rx(-4), rz(-4)); p.set('RightLeg', hinge(rig, 'RightLeg', -8))
    p.set('LeftFoot', rx(30)); p.set('RightFoot', rx(40))
    # 右臂枕頭
    p.set('RightArm', rz(150), rx(10)); p.set('RightForeArm', hinge(rig, 'RightForeArm', 135), ry(30))
    # 左手搭在腹上
    p.set('LeftArm', rz(-10), rx(-25)); p.set('LeftForeArm', hinge(rig, 'LeftForeArm', 80), ry(-50))
    return p

def breathe(amp=1.0, period=4.0, head=0.0):
    def fx(p, t):
        w = np.sin(2 * np.pi * t / period)
        p.r('Spine1', rx(-1.2 * amp * w)); p.r('Spine2', rx(-0.8 * amp * w))
        p.r('LeftShoulder', rz(0.8 * amp * w)); p.r('RightShoulder', rz(-0.8 * amp * w))
        if head: p.r('Head', rx(head * np.sin(2 * np.pi * t / period + 1)))
    return fx

def talk_arm(rig, p, side='Right', lift=1.0, open_=1.0):
    sg = 1 if side == 'Left' else -1
    p.set(f'{side}Arm', rz(-sg * 28), rx(-32 * lift), ry(-sg * 6))
    p.set(f'{side}ForeArm', hinge(rig, f'{side}ForeArm', 85 * lift), ry(sg * 20 * open_))
    p.set(f'{side}Hand', rx(-10), rz(sg * -25 * open_))
    return p

def mouth(rig, p):
    o = rig.fk(p, ['Head']); hp, hq = o['Head']
    d = qmul(hq, qinv(rig.Wrot['Head']))
    return hp + qrot(d, [0, 0.024, 0.063]), d   # 唇部位置（由臉部網格量得）

CUP_N = 0.012   # 托杯：杯底在掌心上方的距離（模型單位；遊戲中 ×1.85），須與 js/liu-character.js 一致

def hand_frame(rig, p):
    """右手的手指方向 f、掌心朝向 n、拇指側向上 u（角色座標）及握點。"""
    H = 'RightHand'; Wr = rig.Wrot[H]
    f_loc = qrot(qinv(Wr), rig.dir(H, 'RightHandMiddle1'))
    n_loc = qrot(qinv(Wr), [1, 0, 0])
    n_loc = n_loc - f_loc * np.dot(n_loc, f_loc); n_loc /= np.linalg.norm(n_loc)
    u_loc = np.cross(f_loc, n_loc)
    o = rig.fk(p, [H, 'RightHandMiddle1'])
    q = o[H][1]
    palm = o[H][0] + (o['RightHandMiddle1'][0] - o[H][0]) * 0.55
    return qrot(q, f_loc), qrot(q, n_loc), qrot(q, u_loc), palm

def cup_bottom(rig, p):
    f, n, u, palm = hand_frame(rig, p)
    return palm + n * CUP_N, n      # 杯子的「上」= 掌心朝向

def place_cup(rig, p, bottom, f_des, n_des, elbow_max=None):
    """讓握在右手的酒杯杯底到達 bottom，手掌朝向 f_des／n_des。"""
    wrist = np.array(bottom, float) - np.array([0, 0.01, 0.03])
    for _ in range(5):
        reach(p, 'Right', wrist, {0: 0, 2: 25, 3: 0}, elbow_max)
        orient_hand(p, 'Right', f_des, n_des)
        b, _ = cup_bottom(rig, p)
        wrist = wrist + (np.asarray(bottom) - b)
    b, u = cup_bottom(rig, p)
    print('  cup error', round(float(np.linalg.norm(b - bottom)), 4), 'up', np.round(u, 2))
    curl(p, 'Right', 6)
    return p

def drink_keys(rig, base):
    """0：手放膝上；1：掌心托杯舉到唇前；2：手掌後傾，杯口貼唇、微微仰頭飲酒。"""
    up = base.copy(); up.r('Spine1', rx(-2))
    # 手肘不高於胸口（肩下約 12 厘米），袖子不會擋住臉
    sh = rig.fk(up, ['RightArm'])['RightArm'][0][1]
    m, _ = mouth(rig, up)
    f1 = np.array([1.0, 0.0, 0.3]); n1 = np.array([0.0, 1.0, 0.0])   # 手指橫放在杯底下，不擋臉
    print('drink up'); place_cup(rig, up, m + np.array([-0.005, -0.07, 0.07]), f1, n1, sh - 0.04)
    tilt = up.copy(); tilt.r('Neck', rx(-10)); tilt.r('Head', rx(-14)); tilt.r('Spine2', rx(-4))
    m2, _ = mouth(rig, tilt)
    T = rx(-35)                       # 杯口向臉傾側 35°，頭微仰配合
    # 杯底在唇前下方，杯口近邊剛好碰到下唇
    print('drink tilt'); place_cup(rig, tilt, m2 + np.array([-0.003, -0.026, 0.05]), qrot(T, f1), qrot(T, n1), sh - 0.02)
    for nm, q in (('up', up), ('tilt', tilt)):
        print('  elbow below shoulder', nm, round(float(sh - rig.fk(q, ['RightForeArm'])['RightForeArm'][0][1]), 3))
    return base, up, tilt

def build_all(rig):
    C = {}
    S = stand(rig); Sit = seated(rig); Lie = lying(rig)

    # 站立待機：端正站立，只有輕微呼吸（原模型的待機會擺動手臂和腿，顯得浮躁）
    C['Idle'] = sample(rig, [(0, S), (4.5, S)], fx=breathe(0.7, 4.5, 0))
    # 說話（站）：手不動，只有呼吸和極輕微的點頭
    C['Talk'] = sample(rig, [(0, S), (4.0, S)], fx=breathe(0.7, 4, 1.0))

    # 散步（施施而行）：雙手自然垂下輕擺、步伐從容（不再負手，避免雙手交疊變形）
    def step(ph):
        p = S.copy(); s = np.sin(ph); c = np.cos(ph)
        p.r('Spine', rx(4))
        p.r('LeftArm', rx(12 * s)); p.r('RightArm', rx(-12 * s))
        p.r('LeftForeArm', hinge(rig, 'LeftForeArm', 8 + 6 * max(0, -s)))
        p.r('RightForeArm', hinge(rig, 'RightForeArm', 8 + 6 * max(0, s)))
        p.set('LeftUpLeg', rx(-24 * s)); p.set('RightUpLeg', rx(24 * s))
        p.set('LeftLeg', hinge(rig, 'LeftLeg', -max(0, -c) * 38 - 6))
        p.set('RightLeg', hinge(rig, 'RightLeg', -max(0, c) * 38 - 6))
        p.set('LeftFoot', rx(10 * s)); p.set('RightFoot', rx(-10 * s))
        p.r('Hips', ry(5 * s)); p.r('Spine1', ry(-6 * s)); p.r('Head', ry(2 * s))
        p.move(0, -0.012 + 0.010 * abs(c), 0)
        return p
    C['Walk'] = sample(rig, [(i * 1.2 / 8, step(i * 2 * np.pi / 8)) for i in range(9)])

    # 坐下／站起：先屈膝蹲低，再盤膝坐好
    crouch = S.copy(); crouch.move(0, -0.2, -0.04)
    crouch.r('Spine', rx(16)); crouch.r('Head', rx(-10))
    for side, sg in (('Left', 1), ('Right', -1)):
        crouch.set(f'{side}UpLeg', rx(-75), ry(sg * 20)); crouch.set(f'{side}Leg', hinge(rig, f'{side}Leg', -105))
        crouch.set(f'{side}Foot', rx(30))
        crouch.set(f'{side}Arm', rz(-sg * 25), rx(-30)); crouch.set(f'{side}ForeArm', hinge(rig, f'{side}ForeArm', 35))
    low = blend(crouch, Sit, 0.6); low.r('Spine', rx(8))
    sit_keys = [(0, S), (0.7, crouch), (1.25, low), (1.8, Sit)]
    C['SitDown'] = sample(rig, sit_keys)
    C['StandUp'] = sample(rig, [(1.8 - t, p) for t, p in reversed(sit_keys)])

    # 靜坐：身體不動，只有輕微呼吸
    C['SeatedIdle'] = sample(rig, [(0, Sit), (4.5, Sit)], fx=breathe(0.8, 4.5, 0))
    def seated_gesture(lift, out, open_):
        q = Sit.copy(); o = rig.fk(q, ['RightHand']); w = o['RightHand'][0]
        reach(q, 'Right', w + np.array([-out, lift, 0.07]), {0: 0, 1: 10, 3: 0})
        orient_hand(q, 'Right', [-0.3 - out * 3, 0.1, 1], [0.35, 0.55 + 0.4 * open_, 0.25])
        curl(q, 'Right', 6)
        return q
    st1 = seated_gesture(0.10, 0.02, 0.6); st1.r('Head', rx(4))
    st2 = seated_gesture(0.13, 0.05, 0.9); st2.r('Head', rx(-3), ry(-5))
    # 坐着說話：雙手不動，只有呼吸和極輕微的點頭
    C['SeatedTalk'] = sample(rig, [(0, Sit), (4.0, Sit)], fx=breathe(0.8, 4, 1.2))

    # 舉杯飲酒：k 由劇情控制（0→2）
    d0, d1, d2 = drink_keys(rig, Sit)
    C['Drink'] = sample(rig, [(0, d0), (1.25, d1), (2.5, d2)])

    # 醉臥：由坐姿向後躺下
    lean = Sit.copy(); lean.r('Hips', rx(-35)); lean.move(0, 0, -0.06)
    lean.set('RightArm', rz(40), rx(25)); lean.set('RightForeArm', hinge(rig, 'RightForeArm', 30))
    lean.set('LeftArm', rz(-40), rx(25)); lean.set('LeftForeArm', hinge(rig, 'LeftForeArm', 30))
    C['LieDown'] = sample(rig, [(0, Sit), (0.8, lean), (2.0, Lie)])
    C['LyingIdle'] = sample(rig, [(0, Lie), (5, Lie)], fx=breathe(1.6, 5))

    # 邀請：「坐下來吧」——左手向左方攤開
    inv = Sit.copy(); inv.set('LeftArm', rz(-10), rx(-62), ry(62)); inv.set('LeftForeArm', hinge(rig, 'LeftForeArm', 20), ry(-30))
    inv.set('LeftHand', rx(-20), rz(-20)); inv.r('Head', ry(25), rx(4)); inv.r('Spine2', ry(10))
    curl(inv, 'Left', -10)
    C['Invite'] = sample(rig, [(0, Sit), (0.8, inv), (2.2, inv), (3.0, Sit)])

    # 指點遠景：「看看這山，看看遠處的水」
    pf1 = Sit.copy(); pf1.set('RightArm', rz(10), rx(-112), ry(-8)); pf1.set('RightForeArm', hinge(rig, 'RightForeArm', 8))
    pf1.set('RightHand', rx(-10)); pf1.r('Head', rx(-4))
    pf2 = pf1.copy(); pf2.r('RightArm', ry(-30)); pf2.r('Spine2', ry(-10)); pf2.r('Head', ry(-12))
    C['PointFar'] = sample(rig, [(0, Sit), (0.9, pf1), (2.4, pf2), (3.4, pf2), (4.4, Sit)])

    # 頹然就醉：身體不搖晃，只在約五秒內緩緩垂下頭，之後保持低頭、輕微呼吸
    # （片段長 60 秒，足夠覆蓋整段暮色；劇情結束時以 setIdle(null) 回到靜坐）
    droop = Sit.copy(); droop.r('Spine1', rx(3)); droop.r('Neck', rx(14)); droop.r('Head', rx(12))
    C['DrunkSway'] = sample(rig, [(0, Sit), (5.5, droop), (60, droop)], fx=breathe(0.7, 5, 0), fps=10)

    # 躬身致意：雙手自然垂在身旁，只彎腰點頭（不拱手，避免雙手交疊變形）
    bow = S.copy(); bow.r('Spine', rx(12)); bow.r('Spine1', rx(8)); bow.r('Head', rx(10)); bow.move(0, -0.004, -0.01)
    C['Bow'] = sample(rig, [(0, S), (1.1, bow), (2.1, bow), (3.3, S)])   # 手臂完全不動，只有上身前傾

    # 遠眺：站立，雙手自然垂下，微微抬頭
    gz = S.copy(); gz.r('Head', rx(-5)); gz.r('Spine2', rx(-2))
    C['GazeIdle'] = sample(rig, [(0, gz), (6, gz)], fx=breathe(0.7, 6, 0))
    return C
