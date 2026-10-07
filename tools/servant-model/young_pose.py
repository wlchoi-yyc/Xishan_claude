# 年輕僕人的坐地姿勢與動作（build_young.py 及 rebuild_young_anims.py 共用）。
# 坐在草地上：右腿向前伸直，左膝屈起（扭傷的左腳踝在身前），左手按在左腳踝上方；
# 右手自然垂在身旁（與站立時相同），手剛好在地面之上——不撐在身後（撐地的手腕向後折，看來像受傷或殘疾）。
import os, sys
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'liu-model'))
from anims import Pose, rx, ry, rz, sample, breathe, hinge, reach, curl, orient_hand, skin_points

GROUND_HIPS = 0.105                       # 盆骨離地高度（臀部厚度）
ARM_DOWN = 16                             # 上臂由靜止 A 字姿勢向下轉的角度（與柳宗元站姿相同）


def seated_pose(rig, JP, body_idx=None):
    """body_idx：身體（手臂以外）頂點，用來檢查垂下的右手不會陷進身體或大腿。"""
    S = Pose(rig)
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
    S.set('RightUpLeg', rx(best[1]), ry(-4)); S.set('RightLeg', hinge(rig, 'RightLeg', best[2])); S.set('RightFoot', rx(-30), ry(-12))
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
    o = rig.fk(S, ['LeftFoot', 'LeftLeg', 'RightFoot'])
    # 左手按在左腳踝上方（小腿外側）
    ank = o['LeftFoot'][0]; knee = o['LeftLeg'][0]
    lt = ank + (knee - ank) * 0.22 + np.array([0.045, 0.02, 0.0])
    print('left hand', reach(S, 'Left', lt, {0: 0, 3: 0}))
    d_ = knee - ank; d_ /= np.linalg.norm(d_)
    orient_hand(S, 'Left', -d_ + np.array([-0.4, 0, 0.2]), [-1, -0.2, 0]); curl(S, 'Left', 22)

    # 右手：與站立時一樣自然垂下（上臂由 A 字姿勢垂下、略向前，手肘微曲，手指微屈），
    # 手掌朝向身體、手腕不折。坐在地上時垂下的手會碰到地面，所以逐步稍屈手肘，直至手比地面高出約 1 厘米；
    # 若手太貼近身體／大腿便把手臂稍為張開。
    S.set('RightArm', rz(ARM_DOWN), rx(-4))
    S.set('RightForeArm', hinge(rig, 'RightForeArm', 10))
    S.set('RightHand', rx(0))
    curl(S, 'Right', 12)
    if getattr(rig, 'skin', None) is not None and body_idx is not None:
        hand_idx = rig.skin['hand']['Right']
        for _ in range(30):
            H = skin_points(rig, S, hand_idx); B = skin_points(rig, S, body_idx)
            low = H[:, 1].min()
            near = B[(np.abs(B[:, 1] - H[:, 1].mean()) < 0.08)]
            gap = min(np.linalg.norm(near - h, axis=1).min() for h in H[::4]) if len(near) else 1.0
            if gap < 0.008: S.r('RightArm', rz(-1.5)); continue      # 太貼身：手臂稍張開
            if low < 0.010: S.r('RightForeArm', hinge(rig, 'RightForeArm', 3)); continue   # 碰地：稍屈手肘
            break
        print('right hand: lowest point above ground', round(float(low), 4), 'gap to body', round(float(gap), 4))
    return S


def rub(rig):
    def f(p, t):     # 輕輕揉腳踝：前臂微微前後移動
        w = np.sin(2 * np.pi * t / 1.4)
        p.r('LeftForeArm', hinge(rig, 'LeftForeArm', 3.5 * w)); p.r('LeftHand', rx(4 * w))
    return f


def both(*fs):
    def f(p, t):
        for g_ in fs: g_(p, t)
    return f


def young_clips(rig, JP, body_idx=None):
    S = seated_pose(rig, JP, body_idx)
    clips = {
        'Idle': sample(rig, [(0, S), (4.2, S)], fx=both(breathe(0.7, 4.2, 0), rub(rig))),
        'Talk': sample(rig, [(0, S), (4.0, S)], fx=breathe(0.7, 4, 1.4)),   # 說話時停手、輕輕點頭
    }
    clips['SeatedIdle'] = clips['Idle']; clips['SeatedTalk'] = clips['Talk']
    return clips
