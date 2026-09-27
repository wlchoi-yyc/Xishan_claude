# 預告片配樂：全部以程式合成（無取樣、無版權問題）
# 用法：python3 music.py out.wav
import sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 44100
DUR = 102.0
N = int(SR * DUR)
rng = np.random.default_rng(7)
L = np.zeros(N)
R = np.zeros(N)
# 乾聲與送去殘響的聲部分開
RL = np.zeros(N)
RR = np.zeros(N)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def n2f(name):
    # 'D3', 'F#4', 'Bb2'
    base = NOTE[name[0]]
    rest = name[1:]
    if rest.startswith('#'):
        base += 1
        rest = rest[1:]
    elif rest.startswith('b'):
        base -= 1
        rest = rest[1:]
    return midi(12 * (int(rest) + 1) + base)


def put(sig, t, gain=1.0, pan=0.0, rev=0.3):
    i = int(t * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    gl = gain * np.cos((pan + 1) * np.pi / 4)
    gr = gain * np.sin((pan + 1) * np.pi / 4)
    L[i:i + len(sig)] += sig * gl
    R[i:i + len(sig)] += sig * gr
    RL[i:i + len(sig)] += sig * gl * rev
    RR[i:i + len(sig)] += sig * gr * rev


def tt(d):
    return np.arange(int(d * SR)) / SR


def lp(x, fc, order=2):
    sos = signal.butter(order, min(fc, SR / 2 - 100), 'low', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def hp(x, fc, order=2):
    sos = signal.butter(order, fc, 'high', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], 'band', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def env_adsr(n, a, r, total):
    e = np.ones(n)
    na = max(1, int(a * SR))
    nr = max(1, int(r * SR))
    e[:na] = np.linspace(0, 1, na)
    if nr < n:
        e[-nr:] *= np.linspace(1, 0, nr)
    return e


def saw(f, t, harm=12, detune=0.0):
    out = np.zeros_like(t)
    ph = rng.uniform(0, 2 * np.pi)
    for k in range(1, harm + 1):
        if f * k > SR / 2 - 1000:
            break
        out += np.sin(2 * np.pi * k * f * (1 + detune) * t + ph * k) / k
    return out


# ---------- 樂器 ----------

def taiko(t0, gain=1.0, pitch=1.0, pan=0.0):
    t = tt(1.6)
    f = (48 + 90 * np.exp(-t * 30)) * pitch
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 5.5)
    skin = lp(rng.standard_normal(len(t)), 900) * np.exp(-t * 40) * 0.8
    s = np.tanh((body + skin) * 2.2) * 0.8
    put(s, t0, gain, pan, rev=0.35)


def small_drum(t0, gain=0.4, pan=0.0):
    t = tt(0.4)
    f = 180 * np.exp(-t * 10) + 120
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 18)
    s += bp(rng.standard_normal(len(t)), 800, 5000) * np.exp(-t * 35) * 0.5
    put(s, t0, gain, pan, rev=0.25)


def braam(t0, notes, gain=1.0, length=6.0, bright=1.0):
    t = tt(length)
    s = np.zeros_like(t)
    for n in notes:
        f = n2f(n)
        for d in (-0.004, 0.0, 0.005):
            s += saw(f, t, harm=30, detune=d)
    s /= len(notes) * 3
    # 銅管式亮度衰減：亮部快速消失
    bright_part = hp(s, 400) * np.exp(-t * 2.2) * bright
    dark = lp(s, 700) * np.exp(-t * 0.7)
    x = np.tanh((bright_part * 1.6 + dark * 1.8) * 2.0)
    x *= np.minimum(1, t / 0.015)
    x *= np.minimum(1, (length - t) / 1.0)
    put(x, t0, gain * 0.55, -0.15, rev=0.5)
    put(x, t0 + 0.012, gain * 0.55, 0.15, rev=0.5)


def sub_boom(t0, gain=1.0, length=4.0):
    t = tt(length)
    f = 30 + 45 * np.exp(-t * 3)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.1)
    s *= np.minimum(1, t / 0.005)
    put(np.tanh(s * 1.5), t0, gain, 0, rev=0.1)


def cymbal(t0, gain=0.3, length=5.0):
    t = tt(length)
    s = hp(rng.standard_normal(len(t)), 3500) * np.exp(-t * 1.2)
    s2 = hp(rng.standard_normal(len(t)), 3500) * np.exp(-t * 1.2)
    i = int(t0 * SR)
    n = min(len(t), N - i)
    L[i:i + n] += s[:n] * gain
    R[i:i + n] += s2[:n] * gain
    RL[i:i + n] += s[:n] * gain * 0.4
    RR[i:i + n] += s2[:n] * gain * 0.4


def whoosh(t_hit, length=2.5, gain=0.5):
    # 反向鈸：在 t_hit 到頂
    t = tt(length)
    e = (t / length) ** 3
    s = rng.standard_normal(len(t))
    lo = lp(s, 1500)
    hi = hp(s, 2000)
    k = t / length
    x = (lo * (1 - k) + hi * k) * e
    put(x, t_hit - length, gain, 0, rev=0.4)


def riser(t0, t1, gain=0.5):
    d = t1 - t0
    t = tt(d)
    k = t / d
    # 上升的 Shepard 式音調
    s = np.zeros_like(t)
    for base in (110, 220, 440):
        f = base * 2 ** (k * 1.5)
        s += np.sin(2 * np.pi * np.cumsum(f) / SR)
    s = s / 3 * 0.35
    noise = rng.standard_normal(len(t))
    # 分段調整截止頻率
    out = np.zeros_like(t)
    blk = 2048
    b, a = signal.butter(2, 300 / (SR / 2), 'low')
    zi = signal.lfilter_zi(b, a) * 0
    for i in range(0, len(t), blk):
        fc = 300 + 9000 * k[i] ** 2
        b, a = signal.butter(2, fc / (SR / 2), 'low')
        out[i:i + blk], zi = signal.lfilter(b, a, noise[i:i + blk], zi=zi)
    x = (s + out * 0.5) * k ** 2.2
    put(x, t0, gain, 0, rev=0.5)


def guqin(t0, note, gain=0.5, pan=0.0, length=4.0, slide=0.0, rev=0.5):
    # Karplus-Strong 撥弦 + 輕微滑音（古琴的「吟猱」）
    f = n2f(note)
    n = int(length * SR)
    Nd = int(round(SR / f))
    x = np.zeros(n)
    burst = lp(rng.standard_normal(Nd), 3500)
    x[:Nd] = burst
    g = 0.996
    a = np.zeros(Nd + 2)
    a[0] = 1
    a[Nd] = -g / 2
    a[Nd + 1] = -g / 2
    y = signal.lfilter([1.0], a, x)
    t = tt(length)
    # 滑音：以重取樣近似
    if slide:
        rate = 1 + slide * (1 - np.exp(-t * 3)) + 0.004 * np.sin(2 * np.pi * 5 * t) * (t > 0.4)
        pos = np.cumsum(rate)
        pos = pos[pos < n - 1]
        y = np.interp(pos, np.arange(n), y)
        t = t[: len(y)]
    y = lp(y, 2600) * np.exp(-t * 0.9)
    y /= np.max(np.abs(y)) + 1e-9
    put(y, t0, gain, pan, rev=rev)


def dizi(t0, note, length, gain=0.25, pan=0.1):
    t = tt(length)
    f = n2f(note)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.3) / 0.4, 0, 1)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    s = np.sin(ph) + 0.25 * np.sin(2 * ph) + 0.08 * np.sin(3 * ph)
    breath = bp(rng.standard_normal(len(t)), f * 0.8, min(f * 4, 15000)) * 0.12
    e = env_adsr(len(t), 0.08, min(0.5, length * 0.4), length)
    put((s + breath) * e, t0, gain, pan, rev=0.6)


def pad(t0, notes, length, gain=0.2, cutoff=1800, attack=1.5, release=1.5):
    t = tt(length)
    s = np.zeros_like(t)
    for n in notes:
        f = n2f(n)
        for d in (-0.006, -0.002, 0.003, 0.007):
            s += saw(f, t, harm=16, detune=d)
    s = lp(s / (len(notes) * 4), cutoff)
    e = env_adsr(len(t), attack, release, length)
    put(s * e, t0, gain, -0.3, rev=0.6)
    put(np.roll(s, 331) * e, t0, gain, 0.3, rev=0.6)


def drone(t0, t1, notes, gain=0.25, cutoff=500, fade=3.0):
    pad(t0, notes, t1 - t0, gain=gain, cutoff=cutoff, attack=fade, release=fade)


def bell(t0, note, gain=0.12, pan=0.0):
    t = tt(4.0)
    f = n2f(note)
    s = (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * f * 2.76 * t) * np.exp(-t * 2)
         + 0.2 * np.sin(2 * np.pi * f * 5.4 * t) * np.exp(-t * 4)) * np.exp(-t * 1.2)
    put(s, t0, gain, pan, rev=0.8)


def tick(t0, gain=0.25):
    t = tt(0.05)
    s = hp(rng.standard_normal(len(t)), 4000) * np.exp(-t * 200)
    s += np.sin(2 * np.pi * 2400 * t) * np.exp(-t * 150) * 0.5
    put(s, t0, gain, 0.2, rev=0.2)


def heartbeat(t0, gain=0.8):
    for dt, g in ((0, 1.0), (0.22, 0.7)):
        t = tt(0.5)
        s = np.sin(2 * np.pi * (45 + 30 * np.exp(-t * 20)) * t) * np.exp(-t * 12)
        put(s, t0 + dt, gain * g, 0, rev=0.1)


def rain(t0, t1, gain=0.08):
    t = tt(t1 - t0)
    s = bp(rng.standard_normal(len(t)), 1500, 9000)
    s2 = bp(rng.standard_normal(len(t)), 1500, 9000)
    e = env_adsr(len(t), 1.5, 2.0, t1 - t0)
    i = int(t0 * SR)
    L[i:i + len(t)] += s * e * gain
    R[i:i + len(t)] += s2 * e * gain


# ---------- 編排 ----------
BEAT = 0.6  # 100 BPM

# 0–16.5 永州：陰鬱
drone(0.0, 17.5, ['D2', 'A2', 'D3'], gain=0.30, cutoff=380, fade=3.0)
for t0, n in ((1.2, 'D4'), (3.0, 'A3'), (4.6, 'C4'), (5.6, 'D4')):
    guqin(t0, n, 0.35, pan=-0.2, slide=0.02 if n == 'D4' else 0.0)
whoosh(7.5, 2.0, 0.35)
braam(7.5, ['D1', 'A1', 'D2', 'F2'], gain=1.0, length=5.0)
taiko(7.5, 1.0)
sub_boom(7.5, 0.7)
rain(7.5, 17.0, 0.05)
for t0, n in ((11.6, 'F4'), (12.4, 'D4'), (13.4, 'C4'), (14.3, 'A3'), (15.4, 'D4')):
    guqin(t0, n, 0.35, pan=0.1, slide=-0.015 if n == 'A3' else 0.0)

# 16.6–30.4 四處遊走：節奏建立
g0 = 16.6
ost = ['D4', 'A3', 'C4', 'A3', 'D4', 'F4', 'C4', 'A3']
for k in range(23):
    t0 = g0 + k * BEAT
    lvl = min(1.0, 0.35 + k * 0.04)
    if k % 2 == 0:
        taiko(t0, 0.55 * lvl, pitch=1.0)
    if k >= 8:
        small_drum(t0 + BEAT / 2, 0.25 * lvl, pan=0.3)
    guqin(t0, ost[k % 8], 0.20 * lvl, pan=-0.3, length=1.5, rev=0.3)
    guqin(t0 + BEAT / 2, ost[(k + 3) % 8], 0.13 * lvl, pan=0.3, length=1.2, rev=0.3)
pad(16.6, ['D3', 'F3', 'A3'], 5.4, gain=0.15, cutoff=900)
pad(22.0, ['Bb2', 'D3', 'F3'], 4.2, gain=0.18, cutoff=1100, attack=0.5)
pad(26.2, ['C3', 'E3', 'G3'], 4.4, gain=0.18, cutoff=1200, attack=0.5)
# 蒙太奇字卡重擊
for t0 in (22.0, 23.2, 24.4, 25.6, 26.8, 28.0, 29.2):
    taiko(t0, 0.9, pitch=1.1)
    sub_boom(t0, 0.3, 1.5)
whoosh(30.4, 1.2, 0.3)

# 30.4–33 醉臥夢中：朦朧
pad(30.4, ['D3', 'A3', 'E4'], 3.4, gain=0.18, cutoff=1400, attack=0.3)
for i, n in enumerate(['A4', 'E4', 'D4', 'A4', 'E5']):
    guqin(30.5 + i * 0.5, n, 0.18, pan=(-1) ** i * 0.5, length=3.0, rev=0.9)

# 33–38 以為看遍山水
pad(33.0, ['D3', 'F3', 'A3', 'C4'], 5.2, gain=0.2, cutoff=1300, attack=0.8, release=0.2)
for k in range(8):
    taiko(33.0 + k * BEAT, 0.35 + 0.05 * k)
whoosh(38.0, 2.5, 0.45)

# 38 驟停——「而未始知西山之怪特」
sub_boom(38.0, 1.0, 5.0)
braam(38.0, ['D1', 'Ab1', 'D2'], gain=0.7, length=3.5, bright=0.6)
t = tt(5.5)
tone = np.sin(2 * np.pi * n2f('A5') * t) * env_adsr(len(t), 1.0, 2.0, 5.5) * 0.03
put(tone, 38.5, 1.0, 0, rev=0.6)
for t0 in (40.6, 41.6, 42.6):
    heartbeat(t0, 0.9)

# 43.5–47 元和四年九月二十八日：時鐘
for k in range(14):
    tick(43.5 + k * 0.5 - (0.12 * k * k / 14 if k > 7 else 0), 0.22)
drone(43.5, 58.0, ['D2', 'A2'], gain=0.25, cutoff=450, fade=1.5)

# 47–51 始指異之：西山出現
riser(47.0, 57.6, 0.55)
bell(47.0, 'A5', 0.12)
bell(48.2, 'D6', 0.10, pan=0.3)
pad(47.0, ['D3', 'A3', 'E4'], 4.2, gain=0.16, cutoff=1500, attack=1.0)

# 51–57.6 緣染溪、斫榛莽、焚茅茷、窮山之高
g1 = 51.0
for k in range(11):
    t0 = g1 + k * BEAT
    taiko(t0, 0.8, pitch=1.0 + 0.02 * k)
    small_drum(t0 + BEAT / 2, 0.35, pan=-0.3)
    small_drum(t0 + BEAT * 0.75, 0.2, pan=0.3)
    for j in range(4):
        guqin(t0 + j * BEAT / 4, ['D4', 'D4', 'A4', 'D5'][j], 0.12, pan=0.4 - 0.25 * j, length=0.8, rev=0.2)
for t0 in (51.0, 52.2, 53.4, 54.6):
    braam(t0, ['D1', 'A1', 'D2'], gain=0.55, length=1.4)
pad(51.0, ['D3', 'A3', 'D4'], 6.6, gain=0.18, cutoff=2200, attack=0.2, release=0.1)
for k in range(8):
    taiko(55.8 + k * 0.225, 0.5 + 0.06 * k, pitch=1.2)

# 58.2 登頂：大爆發
whoosh(58.2, 0.6, 0.4)
braam(58.2, ['D1', 'A1', 'D2', 'F#2', 'A2'], gain=1.25, length=6.0)
taiko(58.2, 1.2)
sub_boom(58.2, 1.0, 5.0)
cymbal(58.2, 0.22, 6.0)
prog = [(58.2, ['D3', 'F#3', 'A3', 'D4'], 3.3), (61.5, ['G2', 'B3', 'D4', 'G4'], 4.0),
        (65.5, ['B2', 'D4', 'F#4', 'B4'], 2.5), (68.0, ['A2', 'C#4', 'E4', 'A4'], 2.6)]
for t0, ch, d in prog:
    pad(t0, ch, d + 0.4, gain=0.28, cutoff=2600, attack=0.25, release=0.5)
    pad(t0, [ch[0][:-1] + str(int(ch[0][-1]) - 1)], d + 0.4, gain=0.2, cutoff=300, attack=0.1, release=0.5)
for k in range(21):
    t0 = 58.2 + k * BEAT
    if t0 >= 70.5:
        break
    if k % 2 == 0:
        taiko(t0, 0.55)
    small_drum(t0 + BEAT / 2, 0.14, pan=0.4)
for t0 in (61.5, 65.5, 68.0):
    cymbal(t0, 0.1, 3.0)
    taiko(t0, 0.9)
melody = [(58.8, 'A5', 0.9), (59.7, 'F#5', 0.6), (60.3, 'E5', 1.0), (61.5, 'D5', 1.2), (62.7, 'B4', 0.6),
          (63.3, 'D5', 0.6), (63.9, 'E5', 1.5), (65.5, 'F#5', 0.9), (66.4, 'A5', 0.6), (67.0, 'B5', 1.0),
          (68.0, 'A5', 0.8), (68.8, 'E5', 0.6), (69.4, 'F#5', 1.1)]
for t0, n, d in melody:
    dizi(t0, n, d + 0.25, gain=0.2)

# 70.5–75 暮色
pad(70.5, ['G2', 'D3', 'A3', 'B3', 'F#4'], 5.0, gain=0.22, cutoff=1400, attack=0.4, release=2.0)
for i, n in enumerate(['F#5', 'D5', 'B4', 'A4', 'F#4']):
    guqin(70.8 + i * 0.85, n, 0.18, pan=0.3 - i * 0.15, length=3.5, rev=0.8)
dizi(72.4, 'A4', 2.2, gain=0.12)

# 75–84 心凝形釋
pad(75.0, ['D3', 'A3', 'E4', 'F#4'], 9.2, gain=0.2, cutoff=1100, attack=2.0, release=1.0)
for i in range(16):
    bell(75.3 + i * 0.55, ['D6', 'A5', 'E6', 'F#5', 'B5'][i % 5], 0.045, pan=np.sin(i) * 0.7)
bell(79.0, 'D5', 0.15)
guqin(79.0, 'D4', 0.35, length=5.0, slide=0.03)
riser(80.5, 85.0, 0.4)
whoosh(85.0, 3.0, 0.5)

# 85 片名
braam(85.0, ['D1', 'A1', 'D2', 'A2', 'F#3'], gain=1.3, length=8.0)
taiko(85.0, 1.3)
sub_boom(85.0, 1.1, 6.0)
cymbal(85.0, 0.25, 7.0)
pad(85.0, ['D3', 'A3', 'D4', 'F#4', 'A4'], 13.0, gain=0.22, cutoff=2000, attack=0.1, release=4.0)
for t0, n, d in ((86.2, 'A4', 0.7), (86.9, 'D5', 0.7), (87.6, 'E5', 1.2), (88.8, 'F#5', 0.6),
                 (89.4, 'E5', 0.6), (90.0, 'D5', 2.4)):
    dizi(t0, n, d + 0.3, gain=0.18)
taiko(91.0, 0.7)
bell(91.0, 'A5', 0.1)
taiko(94.5, 0.8)
bell(94.5, 'D6', 0.1)
guqin(94.5, 'D5', 0.25, length=4.0)

# 99 彩蛋
guqin(99.0, 'D3', 0.5, length=3.0, slide=0.03, rev=1.0)
bell(99.0, 'D5', 0.06)

# ---------- 殘響與母帶 ----------
irn = int(3.2 * SR)
ti = np.arange(irn) / SR
irL = rng.standard_normal(irn) * np.exp(-ti * 2.0)
irR = rng.standard_normal(irn) * np.exp(-ti * 2.0)
irL = lp(irL, 5000)
irR = lp(irR, 5000)
irL /= np.sqrt(np.sum(irL ** 2))
irR /= np.sqrt(np.sum(irR ** 2))
wetL = signal.oaconvolve(RL, irL)[:N]
wetR = signal.oaconvolve(RR, irR)[:N]
outL = L + wetL * 0.9
outR = R + wetR * 0.9
out = np.stack([outL, outR], 1)
out = hp(out.T, 25).T
peak = np.max(np.abs(out))
out = np.tanh(out / peak * 1.4) / np.tanh(1.4) * 0.93
# 首尾淡入淡出
fi = int(0.5 * SR)
out[:fi] *= np.linspace(0, 1, fi)[:, None]
fo = int(1.5 * SR)
out[-fo:] *= np.linspace(1, 0, fo)[:, None]
wavfile.write(sys.argv[1] if len(sys.argv) > 1 else 'music.wav', SR, (out * 32767).astype(np.int16))
print('ok')
