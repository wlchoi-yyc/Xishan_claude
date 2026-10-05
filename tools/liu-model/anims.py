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

def reach(p, side, target, prefer=None):
    """在角色座標中把手腕移到 target（粗略網格搜尋＋細化）。"""
    target = np.asarray(target, float); prefer = prefer or {}
    want = [f'{side}Hand']
    def cost(x):
        q = p.copy(); arm(q, side, *x)
        h = p.rig.fk(q, want)[f'{side}Hand'][0]
        c = np.linalg.norm(h - target)
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

def hands_on_knees(p):
    """雙手分開，掌心向下輕放在兩膝上，手指自然微曲。"""
    rig = p.rig
    for side, sg in (('Left', 1), ('Right', -1)):
        o = rig.fk(p, [f'{side}UpLeg', f'{side}Leg'])
        hip, knee = o[f'{side}UpLeg'][0], o[f'{side}Leg'][0]
        wrist = hip + (knee - hip) * 0.62 + np.array([-sg * 0.005, 0.045, 0])
        print('knee', side, reach(p, side, wrist, {0: 0, 1: 10, 3: 0}))
        d = knee - hip; d[1] = 0; d /= np.linalg.norm(d)
        orient_hand(p, side, d + np.array([0, -0.35, 0]), [0, -1, 0])
        curl(p, side, 14)
    return p

def stand(rig):
    p = Pose(rig)
    curl(p, 'Left', 12); curl(p, 'Right', 12)
    return p

def hands_behind(rig, p=None):
    """負手：雙手在背後相握，文人散步、遠眺的姿態。"""
    p = (p or stand(rig)).copy()
    for side, sg in (('Left', 1), ('Right', -1)):
        p.set(f'{side}Arm', rz(-sg * 8), rx(20))
        p.set(f'{side}ForeArm', rz(-sg * 62), rx(22))
        p.set(f'{side}Hand', rz(-sg * 15))
    return p

def seated(rig):
    """盤膝而坐：長袍覆蓋雙膝，雙手分開輕放膝上。"""
    p = stand(rig).copy()
    p.move(0, -0.395, -0.02)
    p.set('Hips', ry(0), rx(4))
    p.r('Spine', rx(4)); p.r('Spine1', rx(3))
    for side, sg in (('Left', 1), ('Right', -1)):
        p.set(f'{side}UpLeg', ry(sg * 85), rx(-80), ry(sg * 40))
        p.set(f'{side}Leg', hinge(rig, f'{side}Leg', -140))
        p.set(f'{side}Foot', rx(20))
    # 上身前傾後，頸和頭稍為抬起，平視前方
    p.r('Neck', rx(-5)); p.r('Head', rx(-6))
    hands_on_knees(p)
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
    return hp + qrot(d, [0, 0.032, 0.085]), d

def drink_keys(rig, base):
    """0：手放膝上；1：酒杯到唇；2：仰頭飲盡。回傳三個姿勢。"""
    up = base.copy(); up.r('Spine1', rx(-2))
    m, d = mouth(rig, up)
    print('drink up', reach(up, 'Right', m + np.array([-0.045, -0.115, 0.065]), {3: 10}))
    up.set('RightHand', rx(-10), rz(-10)); curl(up, 'Right', 30)
    tilt = up.copy(); tilt.r('Neck', rx(-16)); tilt.r('Head', rx(-16)); tilt.r('Spine2', rx(-5))
    m2, d2 = mouth(rig, tilt)
    print('drink tilt', reach(tilt, 'Right', m2 + np.array([-0.045, -0.095, 0.075]), {3: 10}))
    tilt.set('RightHand', rx(-30), rz(-10)); curl(tilt, 'Right', 30)
    return base, up, tilt

def build_all(rig):
    C = {}
    S = stand(rig); Sit = seated(rig); Lie = lying(rig)

    # 說話（站）：右手自然比劃，點頭
    t1 = talk_arm(rig, S.copy(), 'Right', 1.0, 0.7); t1.r('Head', rx(4)); t1.r('Spine2', ry(-4))
    t2 = talk_arm(rig, S.copy(), 'Right', 0.8, 1.2); t2.r('Head', rx(-3), ry(-4))
    t3 = talk_arm(rig, S.copy(), 'Left', 0.6, 0.8); t3.r('Head', rx(5), ry(4)); t3.r('Spine2', ry(4))
    C['Talk'] = sample(rig, [(0, S), (0.6, t1), (1.5, t2), (2.4, t1), (3.2, t3), (4.0, S)], fx=breathe(1, 4, 1.5))

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

    C['SeatedIdle'] = sample(rig, [(0, Sit), (4, Sit)], fx=breathe(1.2, 4, 1.2))
    def seated_gesture(lift, out, open_):
        q = Sit.copy(); o = rig.fk(q, ['RightHand']); w = o['RightHand'][0]
        reach(q, 'Right', w + np.array([-out, lift, 0.07]), {0: 0, 1: 10, 3: 0})
        orient_hand(q, 'Right', [-0.3 - out * 3, 0.1, 1], [0.35, 0.55 + 0.4 * open_, 0.25])
        curl(q, 'Right', 6)
        return q
    st1 = seated_gesture(0.10, 0.02, 0.6); st1.r('Head', rx(4))
    st2 = seated_gesture(0.13, 0.05, 0.9); st2.r('Head', rx(-3), ry(-5))
    C['SeatedTalk'] = sample(rig, [(0, Sit), (0.7, st1), (1.6, st2), (2.5, st1), (4.0, Sit)], fx=breathe(1, 4, 1))

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

    # 頹然就醉：身體慢慢搖晃、頭垂下
    def sway(p, t):
        w = 2 * np.pi * t / 5
        p.r('Spine', rz(5 * np.sin(w)), rx(5 + 3 * np.cos(w))); p.r('Spine2', rz(3 * np.sin(w + .6)))
        p.r('Neck', rx(10 + 4 * np.sin(w * 2))); p.r('Head', rz(-6 * np.sin(w + 1)), rx(6))
    C['DrunkSway'] = sample(rig, [(0, Sit), (5, Sit)], fx=sway)

    # 躬身致意：雙手自然垂在身旁，只彎腰點頭（不拱手，避免雙手交疊變形）
    bow = S.copy(); bow.r('Spine', rx(12)); bow.r('Spine1', rx(8)); bow.r('Head', rx(10)); bow.move(0, -0.004, -0.01)
    for side, sg in (('Left', 1), ('Right', -1)): bow.r(f'{side}Arm', rx(-6))
    C['Bow'] = sample(rig, [(0, S), (0.9, bow), (1.8, bow), (2.8, S)])

    # 遠眺：站立，雙手自然垂下，微微抬頭
    gz = S.copy(); gz.r('Head', rx(-5)); gz.r('Spine2', rx(-2))
    C['GazeIdle'] = sample(rig, [(0, gz), (6, gz)], fx=breathe(1, 6, 1))
    return C
