"""
Submission video, step 2 (step 1: scripts/video/capture.mjs). Composes the captured
footage, title cards and the samples' voices into a 1080p30 MP4 under three minutes:
  node_modules/.cache/shadowplay-video/shadowplay.mp4
Needs Pillow and ffmpeg. Fonts: macOS Georgia.
"""
import base64
import bisect
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / 'node_modules/.cache/shadowplay-video'
OUT = D / 'shadowplay.mp4'
W, H, FPS = 1920, 1080, 30
INK = (13, 10, 20)
CREAM = (246, 227, 189)
AMBER = (242, 196, 122)
MUTED = (150, 135, 112)
FONT = '/System/Library/Fonts/Supplemental/Georgia.ttf'
ITALIC = '/System/Library/Fonts/Supplemental/Georgia Italic.ttf'
URL = 'shadowplay-1031148889398.us-central1.run.app'

T = json.loads((D / 'timing.json').read_text())
FRAMES = {k: ([f['t'] for f in v], [f['file'] for f in v]) for k, v in T['frames'].items()}
_cache: dict = {}


def frame_at(name, wall_ms):
    times, files = FRAMES[name]
    i = max(0, bisect.bisect_right(times, wall_ms) - 1)
    key = (name, files[i])
    if key not in _cache:
        if len(_cache) > 8:
            _cache.clear()
        _cache[key] = Image.open(D / name / files[i]).convert('RGB')
    return _cache[key]


def story(name, st):
    """Frame of `name` at story time st (s)."""
    return frame_at(name, T['starts'][name] + st * 1000)


def font(path, size):
    return ImageFont.truetype(path, size)


def background():
    bg = Image.new('RGB', (W, H), INK)
    glow = Image.new('RGB', (W, H), INK)
    ImageDraw.Draw(glow).ellipse((W * 0.2, H * 0.05, W * 0.8, H * 1.1), fill=(58, 34, 20))
    return Image.blend(bg, glow.filter(ImageFilter.GaussianBlur(220)), 0.85)


BG = background()


def centered(draw, y, text, f, fill):
    w = draw.textlength(text, font=f)
    draw.text(((W - w) / 2, y), text, font=f, fill=fill)


def wrap(draw, text, f, width):
    words, lines, line = text.split(), [], ''
    for w in words:
        trial = (line + ' ' + w).strip()
        if draw.textlength(trial, font=f) > width and line:
            lines.append(line)
            line = w
        else:
            line = trial
    return lines + [line]


def card(lines, small=None):
    """lines: [(text, size, italic, colour)]"""
    im = BG.copy()
    d = ImageDraw.Draw(im)
    blocks = []
    for text, size, italic, colour in lines:
        f = font(ITALIC if italic else FONT, size)
        for l in wrap(d, text, f, W * 0.72):
            blocks.append((l, f, colour, int(size * 1.35)))
    total = sum(b[3] for b in blocks)
    y = (H - total) / 2 - 20
    for l, f, colour, h in blocks:
        centered(d, y, l, f, colour)
        y += h
    if small:
        centered(d, H - 110, small, font(FONT, 26), MUTED)
    return im


def fade(im, t, length, fade_s=0.6):
    a = min(1, t / fade_s, (length - t) / fade_s)
    return Image.blend(Image.new('RGB', (W, H), (0, 0, 0)), im, max(0, a)) if a < 1 else im


def headline(im, text):
    d = ImageDraw.Draw(im)
    centered(d, 34, text, font(ITALIC, 40), AMBER)
    return im


def label(d, x, y, text, w):
    f = font(FONT, 26)
    tw = d.textlength(text.upper(), font=f)
    d.text((x + (w - tw) / 2, y), text.upper(), font=f, fill=MUTED)


def device_panel(shot, width):
    """A screenshot in a dark tablet bezel."""
    s = shot.resize((width, round(shot.height * width / shot.width)), Image.LANCZOS)
    pad = 18
    panel = Image.new('RGBA', (s.width + pad * 2, s.height + pad * 2), (0, 0, 0, 0))
    ImageDraw.Draw(panel).rounded_rectangle((0, 0, panel.width - 1, panel.height - 1), radius=36, fill=(20, 18, 24, 255), outline=(70, 60, 50, 255), width=3)
    mask = Image.new('L', s.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s.width - 1, s.height - 1), radius=22, fill=255)
    panel.paste(s, (pad, pad), mask)
    return panel


def wall_shot(st):
    return story('wall', st).crop((300, 80, 1620, 1000))


def split(st, text):
    im = BG.copy()
    d = ImageDraw.Draw(im)
    wall = wall_shot(st).resize((900, 627), Image.LANCZOS)
    im.paste(wall, (50, 236))
    label(d, 50, 186, "Dad's wall, far away", 900)
    tablet = device_panel(story('phone', st), 870)
    x = 1000
    im.paste(tablet, (x, 236 - 18), tablet)
    label(d, x, 186, "Mia's tablet, at home", tablet.width)
    return headline(im, text) if text else im


def emulator(st):
    im = BG.copy()
    shot = story('emulator', st).crop((905, 440, 1495, 828)).resize((1300, 855), Image.LANCZOS)
    im.paste(shot, ((W - 1300) // 2, 150))
    d = ImageDraw.Draw(im)
    label(d, 0, 104, 'In the headset: a lamp on the desk, a story on the wall', W)
    centered(d, 1018, '(Meta Quest emulator)', font(FONT, 24), MUTED)
    return im


# ---------------------------------------------------------------- timeline
# Each segment: (seconds, render(t) -> Image, audio) with audio = (source, start_s) or None.
DAD_AUDIO = D / 'dad.mp3'
MIA_AUDIO = D / 'mia.mp3'
for path, sample in ((DAD_AUDIO, 'story-from-dad'), (MIA_AUDIO, 'goodnight-from-mia')):
    data = json.loads((ROOT / f'public/samples/{sample}.json').read_text())['audio']
    path.write_bytes(base64.b64decode(data.split(',', 1)[1]))

end_wall = T['storyEnd']
reply_at = T['replyAt']
mia_start = T['miaStart']

hook = [
    (4.0, lambda t: fade(card([('Every night, millions of parents say goodnight from far away.', 64, True, CREAM)]), t, 4.0), None),
    (3.6, lambda t: fade(card([('On deployment. Working abroad. Across an ocean.', 64, True, CREAM)]), t, 3.6), None),
    (4.0, lambda t: fade(card([('Shadowplay', 120, False, AMBER), ('Bedtime Across the World', 58, True, CREAM)]), t, 4.0), None),
]
segments = hook + [
    (29.0, lambda t: split(t, 'Dad tells the story with his hands. Mia watches it, in his voice.' if t < 13 else ''), (DAD_AUDIO, 0, 55.0)),
    (8.0, lambda t: emulator(29 + t), None),
    (18.0, lambda t: split(37 + t, ''), None),
    (40.0, lambda t: split(86 + t, 'She can join in with her own hands, or they can go live together.' if t < 10 else ''), (DAD_AUDIO, 86, 40.0)),
    (11.0, lambda t: goodnight_phone(t), None),
    (11.0, lambda t: mia_wall(t), (MIA_AUDIO, 0, 11.0)),
    (4.2, lambda t: fade(card([('Record a story', 60, False, AMBER), ('and send it with a private family code.', 48, True, CREAM)]), t, 4.2), None),
    (4.2, lambda t: fade(card([('Watch and join in', 60, False, AMBER), ('at each shape, the story waits for your hands.', 48, True, CREAM)]), t, 4.2), None),
    (4.2, lambda t: fade(card([('Go live', 60, False, AMBER), ('talk, and take turns making the creatures.', 48, True, CREAM)]), t, 4.2), None),
    (4.2, lambda t: fade(card([('Safe by design', 60, False, AMBER), ('No accounts. Camera video never leaves the device.', 48, True, CREAM)]), t, 4.2), None),
    (7.5, lambda t: fade(card([('Shadowplay', 110, False, AMBER), ('A bedtime story, wherever you are.', 54, True, CREAM), (URL, 34, False, CREAM)],
                              small='Built with IWSDK for Meta Quest  ·  Footage from the Meta Quest emulator  ·  Sample voices generated (Kokoro)'), t, 7.5), None),
]


def goodnight_phone(t):
    im = BG.copy()
    shot = frame_at('phone', end_wall + 800 + t * 1000)
    tablet = device_panel(shot, 1240)
    im.paste(tablet, ((W - tablet.width) // 2, 120), tablet)
    return headline(im, 'At the end: a goodnight card, and a way to answer.')


def mia_wall(t):
    im = BG.copy()
    wall = frame_at('wall', mia_start + t * 1000).crop((300, 80, 1620, 1000)).resize((1320, 920), Image.LANCZOS)
    im.paste(wall, ((W - 1320) // 2, 120))
    return headline(im, "Mia's goodnight, back on Dad's wall.")


def music(seconds, voiced, path):
    """
    An original music-box lullaby (made here, no rights needed): a slow pentatonic
    melody of bell tones over a soft pad, quiet under the voices and a little
    louder between them.
    """
    import numpy as np
    import wave
    rate = 44100
    n = int(seconds * rate)
    out = np.zeros(n)
    beat = 60 / 66
    # Scale degrees (C major pentatonic, two octaves) for a gentle eight-bar phrase.
    notes = [5, 4, 2, 4, 5, 7, 5, None, 4, 2, 0, 2, 4, 5, 4, None,
             5, 7, 9, 7, 5, 4, 2, None, 4, 2, 0, 2, 0, None, None, None]
    scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0]
    t_note = np.arange(int(rate * 3.0)) / rate
    def bell(freq):
        partials = [(1, 1.0, 1.6), (2.0, 0.35, 0.9), (3.01, 0.12, 0.5), (4.2, 0.06, 0.3)]
        return sum(a * np.sin(2 * np.pi * freq * m * t_note) * np.exp(-t_note / d) for m, a, d in partials) * 0.25
    i = 0
    t = 1.0
    while t < seconds - 3:
        deg = notes[i % len(notes)]
        if deg is not None:
            start = int(t * rate)
            tone = bell(scale[deg])
            end = min(n, start + len(tone))
            out[start:end] += tone[: end - start]
        t += beat
        i += 1
    # A slow pad: C - Am - F - G, two bars each.
    chords = [[130.81, 196.0, 261.63], [110.0, 164.81, 220.0], [87.31, 130.81, 174.61], [98.0, 146.83, 196.0]]
    bar = beat * 8
    tt = np.arange(n) / rate
    pad = np.zeros(n)
    for k in range(int(seconds / bar) + 1):
        a, b = int(k * bar * rate), min(n, int((k + 1) * bar * rate))
        if a >= n:
            break
        seg = tt[a:b] - k * bar
        env = np.minimum(1, seg / 2) * np.minimum(1, (bar - seg) / 2)
        for f in chords[k % 4]:
            pad[a:b] += 0.05 * env * np.sin(2 * np.pi * f * tt[a:b])
    mix = out + pad
    # Quieter under the voices (with soft ramps), fade in and out.
    gain = np.full(n, 0.55)
    for a, b in voiced:
        gain[int(a * rate): int(b * rate)] = 0.22
    kernel = np.ones(int(rate * 0.8)) / int(rate * 0.8)
    gain = np.convolve(gain, kernel, mode='same')
    fade = np.minimum(1, np.minimum(tt / 2.0, (seconds - tt) / 3.0))
    mix = mix * gain * fade
    mix = mix / max(1e-9, np.abs(mix).max()) * 0.5
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((mix * 32767).astype('<i2').tobytes())


def main():
    total = sum(s[0] for s in segments)
    print(f'{total:.1f} s')
    video = D / 'video.mp4'
    ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS),
                           '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', str(video)], stdin=subprocess.PIPE)
    audio_parts = []
    at = 0.0
    for length, render, audio in segments:
        for i in range(round(length * FPS)):
            ff.stdin.write(render(i / FPS).tobytes())
        if audio:
            # (source, start in source, length): may run on under the following segments.
            audio_parts.append((audio[0], audio[1], audio[2], at))
        at += length
    ff.stdin.close()
    ff.wait()
    # Music under everything; voices placed at their segment times.
    music_path = D / 'music.wav'
    music(total, [(off, off + length) for _, _, length, off in audio_parts], music_path)
    audio_parts.append((music_path, 0, total, 0.0))
    inputs, filters = [], []
    for k, (src, start, length, offset) in enumerate(audio_parts):
        inputs += ['-i', str(src)]
        ms = int(offset * 1000)
        filters.append(f'[{k + 1}:a]atrim={start}:{start + length},asetpts=PTS-STARTPTS,afade=t=out:st={max(0, length - 0.4)}:d=0.4,adelay={ms}|{ms}[a{k}]')
    mix = ''.join(f'[a{k}]' for k in range(len(audio_parts)))
    filters.append(f'{mix}amix=inputs={len(audio_parts)}:normalize=0,apad[aout]')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(video), *inputs, '-filter_complex', ';'.join(filters),
                    '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', str(OUT)], check=True)
    print(OUT)


if __name__ == '__main__':
    main()
