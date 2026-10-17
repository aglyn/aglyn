"""
Aglyn's notification sounds, synthesized from scratch (no samples, no third-party audio).

Every person picks one in Notification settings; the console, the Apple apps and the Android
app play the same file. Run from the repo root:

    python3 tools/notification-sounds/generate.py

It writes the masters into each platform's place:
  apps/console/public/sounds/notifications/<id>.wav    the console's chime and preview
  apps/ios/Shared/Sounds/aglyn-<id>.caf                 APNs `sound`, both Apple apps (needs macOS afconvert)
  apps/android/app/src/main/res/raw/aglyn_sound_<id>.wav  the Android notification channel sound

The list and the default live in libs/aglyn/src/lib/app-utils/notification-sounds.ts; the two must
name the same ids. Pure Python 3, standard library only: 44.1 kHz mono 16-bit, DC removed,
faded in and out, levelled to one loudness with the peak capped at -1 dBFS.
"""
import math, os, random, shutil, subprocess, sys, wave, array
SR = 44100
TAU = 2 * math.pi

def buf(seconds):
    return [0.0] * int(seconds * SR)

def mix(out, src, start=0.0, gain=1.0):
    s0 = int(start * SR)
    for i, x in enumerate(src):
        j = s0 + i
        if j >= len(out):
            break
        out[j] += gain * x

def adsr(n, a, d, s, r, hold=None):
    """Attack/decay/sustain/release in seconds; hold = time before release (default: end - r)."""
    env = [0.0] * n
    total = n / SR
    hold = total - r if hold is None else hold
    for i in range(n):
        t = i / SR
        if t < a:
            v = t / a
        elif t < a + d:
            v = 1 - (1 - s) * (t - a) / d
        elif t < hold:
            v = s
        else:
            v = s * max(0.0, 1 - (t - hold) / r)
        env[i] = v
    return env

def expdecay(n, tau, attack=0.002):
    return [min((i / SR) / attack, 1.0) * math.exp(-(i / SR) / tau) for i in range(n)]

def noise(n, seed=1):
    r = random.Random(seed)
    return [r.uniform(-1, 1) for _ in range(n)]

class Biquad:
    """RBJ cookbook filter; set() may be called per block for sweeps."""
    def __init__(self, kind, f, q):
        self.kind = kind
        self.x1 = self.x2 = self.y1 = self.y2 = 0.0
        self.set(f, q)

    def set(self, f, q):
        f = max(20.0, min(f, SR * 0.45))
        w = TAU * f / SR
        c, s = math.cos(w), math.sin(w)
        al = s / (2 * q)
        if self.kind == 'lp':
            b0, b1, b2 = (1 - c) / 2, 1 - c, (1 - c) / 2
        elif self.kind == 'hp':
            b0, b1, b2 = (1 + c) / 2, -(1 + c), (1 + c) / 2
        else:  # band-pass, 0 dB peak
            b0, b1, b2 = al, 0.0, -al
        a0, a1, a2 = 1 + al, -2 * c, 1 - al
        self.b = (b0 / a0, b1 / a0, b2 / a0)
        self.a = (a1 / a0, a2 / a0)

    def __call__(self, x):
        b0, b1, b2 = self.b
        a1, a2 = self.a
        y = b0 * x + b1 * self.x1 + b2 * self.x2 - a1 * self.y1 - a2 * self.y2
        self.x2, self.x1, self.y2, self.y1 = self.x1, x, self.y1, y
        return y

def filt(src, kind, f, q, sweep=None, block=16):
    """sweep: function t -> cutoff, recomputed every `block` samples."""
    bq = Biquad(kind, f if not sweep else sweep(0), q)
    out = []
    for i, x in enumerate(src):
        if sweep and i % block == 0:
            bq.set(sweep(i / SR), q)
        out.append(bq(x))
    return out

def osc(n, freq, shape='sine', harmonics=24, vib=None):
    """freq: number or function t -> Hz. shape: sine, saw, square, tri (band-limited additive)."""
    f_of = freq if callable(freq) else (lambda t, f=freq: f)
    out = [0.0] * n
    ph = 0.0
    for i in range(n):
        t = i / SR
        f = f_of(t)
        if vib:
            rate, depth = vib
            f *= 1 + depth * math.sin(TAU * rate * t)
        ph += TAU * f / SR
        if shape == 'sine':
            out[i] = math.sin(ph)
            continue
        acc = 0.0
        k = 1
        while k <= harmonics and k * f < SR * 0.45:
            if shape == 'saw':
                acc += math.sin(k * ph) / k
            elif shape == 'square':
                if k % 2:
                    acc += math.sin(k * ph) / k
            elif shape == 'tri':
                if k % 2:
                    acc += ((-1) ** ((k - 1) // 2)) * math.sin(k * ph) / (k * k)
            k += 1
        out[i] = acc * (0.6 if shape == 'saw' else 0.9)
    return out

def fm(n, freq, ratio, index, idecay, decay, attack=0.002):
    out = [0.0] * n
    pc = pm = 0.0
    for i in range(n):
        t = i / SR
        pm += TAU * freq * ratio / SR
        pc += TAU * freq / SR
        out[i] = min(t / attack, 1) * math.exp(-t / decay) * math.sin(pc + index * math.exp(-t / idecay) * math.sin(pm))
    return out

def pluck(n, freq, damping=0.996, brightness=0.5, seed=3):
    """Karplus-Strong plucked string."""
    period = max(2, int(SR / freq))
    r = random.Random(seed)
    line = [r.uniform(-1, 1) for _ in range(period)]
    # pre-filter the burst for a softer pick
    for _ in range(int((1 - brightness) * 4)):
        line = [(line[i] + line[i - 1]) / 2 for i in range(period)]
    out = [0.0] * n
    idx = 0
    prev = 0.0
    for i in range(n):
        x = line[idx]
        nxt = damping * 0.5 * (x + prev)
        prev = x
        line[idx] = nxt
        out[i] = x
        idx = (idx + 1) % period
    return out

def mul(a, b):
    return [x * y for x, y in zip(a, b)]

def write(samples, name, target_rms=0.16, peak_cap=0.89, fade_in=0.003, fade_out=0.02):
    """DC removed, faded in and out, then levelled to one loudness with the peak capped at -1 dBFS."""
    n = len(samples)
    mean = sum(samples) / n
    samples = [x - mean for x in samples]
    fi, fo = min(int(fade_in * SR), n), min(int(fade_out * SR), n)
    for i in range(fi):
        samples[i] *= i / fi
    for i in range(fo):
        samples[n - 1 - i] *= i / fo
    rms = math.sqrt(sum(x * x for x in samples) / n) or 1.0
    peak = max(abs(x) for x in samples) or 1.0
    k = min(target_rms / rms, peak_cap / peak)
    data = array.array('h', (int(max(-1.0, min(1.0, x * k)) * 32767) for x in samples))
    with wave.open(name, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(data.tobytes())


def hz(note):
    names = {'C': -9, 'C#': -8, 'D': -7, 'D#': -6, 'E': -5, 'F': -4, 'F#': -3, 'G': -2, 'G#': -1, 'A': 0, 'A#': 1, 'B': 2}
    name, octave = note[:-1], int(note[-1])
    return 440.0 * 2 ** ((names[name] + 12 * (octave - 4)) / 12)


def partials(n, f, spec, attack=0.001):
    """spec: (ratio, gain, decay) tuples summed as decaying sines."""
    out = [0.0] * n
    for ratio, g, tau in spec:
        w = TAU * f * ratio / SR
        for i in range(n):
            t = i / SR
            out[i] += g * min(t / attack, 1) * math.exp(-t / tau) * math.sin(w * i)
    return out


def xylophone():
    """Three bright xylophone bars: "ta-ri-ra"."""
    out = buf(0.75)
    bar = [(1.0, 1.0, 0.11), (3.0, 0.45, 0.04), (6.0, 0.12, 0.015)]
    for k, note in enumerate(['G5', 'C6', 'E6']):
        mix(out, partials(int(0.4 * SR), hz(note), bar), 0.08 * k, 0.7)
    return out


def a_glyn():
    """Signature: a short glass "a", then "glyn" glides up a sixth and rings over a soft body note."""
    out = buf(0.9)
    mix(out, fm(int(0.3 * SR), hz('C6'), 3.0, 1.0, 0.03, 0.10), 0.0, 0.45)
    n = int(0.8 * SR)
    glide = lambda t: hz('E6') * (hz('A6') / hz('E6')) ** (1 - (1 - min(t / 0.08, 1)) ** 3)
    tone = mul(osc(n, glide), expdecay(n, 0.28, 0.006))
    twin = mul(osc(n, lambda t: glide(t) * 1.003), expdecay(n, 0.28, 0.006))
    body = mul(osc(n, hz('A5')), expdecay(n, 0.30, 0.02))
    mix(out, tone, 0.09, 0.55); mix(out, twin, 0.09, 0.35); mix(out, body, 0.09, 0.22)
    return out


def ta_da():
    """A small brass fanfare: a quick "ta" chord, then a held "da" chord."""
    out = buf(1.1)
    def brass(notes, length, start, gain):
        n = int(length * SR)
        voice = [0.0] * n
        for j, note in enumerate(notes):
            v = osc(n, hz(note) * (1 + 0.002 * j), 'saw', harmonics=18, vib=(5.5, 0.004))
            voice = [a + b for a, b in zip(voice, v)]
        voice = filt(voice, 'lp', 900, 0.9, sweep=lambda t: 700 + 2600 * min(t / 0.04, 1) * math.exp(-t / 0.5))
        mix(out, mul(voice, adsr(n, 0.015, 0.08, 0.7, min(0.25, length * 0.5))), start, gain)
    brass(['G4', 'B4', 'D5'], 0.13, 0.0, 0.8)
    brass(['C5', 'E5', 'G5', 'C6'], 0.85, 0.17, 0.9)
    return out


def plink():
    """Pizzicato: two plucked strings, A4 then E5."""
    out = buf(0.75)
    mix(out, pluck(int(0.6 * SR), hz('A4'), damping=0.994, brightness=0.6, seed=4), 0.0, 0.8)
    mix(out, pluck(int(0.6 * SR), hz('E5'), damping=0.993, brightness=0.7, seed=5), 0.13, 0.9)
    return out


def arcade():
    """8-bit: the coin you just collected."""
    out = buf(0.6)
    n1, n2 = int(0.075 * SR), int(0.5 * SR)
    mix(out, mul(osc(n1, hz('B5'), 'square', harmonics=15), adsr(n1, 0.002, 0.01, 0.9, 0.005)), 0.0, 0.5)
    mix(out, mul(osc(n2, hz('E6'), 'square', harmonics=11), expdecay(n2, 0.16, 0.002)), 0.075, 0.5)
    return out


def cowbell():
    """Two cowbell hits, low then high: two square tones through a bell-shaped band."""
    out = buf(0.6)
    for start, (f1, f2), gain in ((0.0, (540, 800), 0.8), (0.16, (680, 1010), 1.0)):
        n = int(0.4 * SR)
        tone = [a + b for a, b in zip(osc(n, f1, 'square', 9), osc(n, f2, 'square', 9))]
        body = filt(tone, 'bp', 900, 2.5)
        mix(out, mul(body, expdecay(n, 0.09, 0.001)), start, gain)
    return out


def bubbles():
    """A string of underwater bubbles rising past you."""
    out = buf(0.95)
    rnd = random.Random(13)
    t = 0.0
    for k in range(7):
        n = int(0.09 * SR)
        f0 = 380 + 90 * k + 40 * rnd.random()
        blub = mul(osc(n, lambda tt, f0=f0: f0 * (1 + 0.8 * min(tt / 0.04, 1))), expdecay(n, 0.025, 0.002))
        mix(out, blub, t, 0.5 + 0.06 * k)
        t += 0.09 + 0.03 * rnd.random()
    return out


def steel_pan():
    """A steel pan plays a three-note calypso lick."""
    out = buf(1.0)
    pan = [(1.0, 1.0, 0.35), (2.0, 0.55, 0.2), (3.0, 0.2, 0.08), (4.02, 0.12, 0.05)]
    for start, note in ((0.0, 'D5'), (0.12, 'F#5'), (0.24, 'A5')):
        mix(out, partials(int(0.7 * SR), hz(note), pan, attack=0.002), start, 0.6)
    return out


def cash_register():
    """Cha-ching: the drawer slides out and the bell rings. A sale."""
    out = buf(1.1)
    n = int(0.18 * SR)
    drawer = filt(noise(n, seed=200), 'bp', 900, 1.2, sweep=lambda t: 600 + 1800 * t / 0.18)
    mix(out, mul(drawer, adsr(n, 0.01, 0.03, 0.6, 0.06)), 0.0, 1.2)
    clunk = mul(osc(int(0.06 * SR), 160), expdecay(int(0.06 * SR), 0.02, 0.001))
    mix(out, clunk, 0.17, 0.8)
    bell = [(1.0, 1.0, 0.45), (2.03, 0.5, 0.25), (3.17, 0.3, 0.12), (4.6, 0.15, 0.06)]
    mix(out, partials(int(0.85 * SR), 2093.0, bell), 0.2, 0.9)
    mix(out, partials(int(0.85 * SR), 2637.0, bell), 0.205, 0.6)
    return out


# id -> synth. Keep in step with NOTIFICATION_SOUNDS (notification-sounds.ts).
SOUNDS = {
    'xylophone': xylophone,
    'aglyn': a_glyn,
    'tada': ta_da,
    'plink': plink,
    'arcade': arcade,
    'cowbell': cowbell,
    'bubbles': bubbles,
    'steel_pan': steel_pan,
    'cash_register': cash_register,
}

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WEB = os.path.join(ROOT, 'apps/console/public/sounds/notifications')
APPLE = os.path.join(ROOT, 'apps/ios/Shared/Sounds')
ANDROID = os.path.join(ROOT, 'apps/android/app/src/main/res/raw')


def main():
    for path in (WEB, APPLE, ANDROID):
        os.makedirs(path, exist_ok=True)
    converter = shutil.which('afconvert')
    for sound_id, make in SOUNDS.items():
        web = os.path.join(WEB, sound_id + '.wav')
        write(make(), web)
        shutil.copyfile(web, os.path.join(ANDROID, 'aglyn_sound_' + sound_id + '.wav'))
        caf = os.path.join(APPLE, 'aglyn-' + sound_id + '.caf')
        if converter:
            # IMA4 is a format UNNotificationSound plays, at about a quarter of the size of PCM.
            subprocess.run([converter, '-f', 'caff', '-d', 'ima4', web, caf], check=True)
        else:
            print('afconvert not found (macOS only): left ' + caf + ' as it was', file=sys.stderr)
        print(sound_id)


if __name__ == '__main__':
    main()
