"""
Step 2 of the bundled samples (step 1: scripts/samples/capture.mjs).

Builds, from the director's recording of "Goodnight Across the Sea":
  public/samples/story-from-dad.json     the whole story, told in Dad's voice, saying Mia's name
  public/samples/goodnight-from-mia.json Mia's goodnight back: her rabbit (a child's smaller
                                         hands) and her voice
Voices are Kokoro (Apache-2.0), generated locally. Needs ffmpeg.

  .venv/bin/python scripts/samples/voice.py --model DIR
"""
import argparse
import base64
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'node_modules/.cache/shadowplay-samples/story-raw.json'
OUT = ROOT / 'public/samples'
RATE = 24000
STRIDE = 151  # int16 values per hand frame

# What Dad says at each beat: shorter and more personal than the narrator, the way
# a parent tells it. Beats not listed (instructions, carries) are left to his hands.
DAD = {
    'sea-title': "Hi Mia. It's Daddy. Here's a story, just for you.",
    'sea-hush': "Tonight I'm far away... but I'm thinking of you.",
    'sea-job': "Mo has a very important job. She's carrying my goodnight, all the way across the world, to you.",
    'sea-follow': 'Look, Mo is following my hand.',
    'sea-ready': 'Off she goes!',
    'sea-hills-title': 'First, the hills.',
    'sea-hills-text': 'Over the hills, where the long grass sleeps.',
    'sea-rabbit-yes': "Here's a rabbit. Hold on tight, Mo!",
    'sea-rabbit-bows': 'The rabbit hops home, to sleep.',
    'sea-sea-title': 'Then, the sea.',
    'sea-sea-text': 'Wide and silver under the moon. The same moon I can see from here, Mia.',
    'sea-fish-yes': 'A big fish! Climb aboard.',
    'sea-fish-bows': 'Down it dives, deep and quiet.',
    'sea-sky-title': 'Up into the clouds.',
    'sea-storm-text': "The wind tugs at Mo's little wings. But a goodnight is stronger than any wind.",
    'sea-bird-yes': 'A bird! Fly, Mo, fly.',
    'sea-bird-bows': 'And there are the stars.',
    'sea-window-title': 'And then... your window.',
    'sea-arrive': "Mo's at your window, Mia. She has something for you.",
    'sea-caught': "Catch it. That's my goodnight.",
    'sea-free': 'Let it go... let it fill your room, soft as a blanket.',
    'sea-love': 'Goodnight, Mia. I love you, all the way across the sea.',
    'sea-sleep': "Close your eyes now. I'll see you soon.",
}
MIA = [(0.6, 'Goodnight, Daddy!'), (3.4, 'Look, I made you a rabbit.'), (6.6, 'I love you. Come home soon.')]


def tts(kokoro, text, voice, speed):
    samples, rate = kokoro.create(text, voice=voice, speed=speed, lang='en-us')
    assert rate == RATE
    return samples.astype(np.float32)


def ffmpeg_filter(samples, filt):
    with tempfile.TemporaryDirectory() as d:
        src, dst = Path(d) / 'in.wav', Path(d) / 'out.wav'
        sf.write(src, samples, RATE)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-af', filt, '-ar', str(RATE), dst], check=True)
        out, _ = sf.read(dst, dtype='float32')
        return out


def mp3_data_url(samples):
    with tempfile.TemporaryDirectory() as d:
        src, dst = Path(d) / 'track.wav', Path(d) / 'track.mp3'
        sf.write(src, samples, RATE)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-af', 'loudnorm=I=-18:TP=-2',
                        '-ac', '1', '-b:a', '56k', dst], check=True)
        return 'data:audio/mpeg;base64,' + base64.b64encode(dst.read_bytes()).decode()


def place(track, clip, at):
    start = int(at * RATE)
    end = min(len(track), start + len(clip))
    track[start:end] += clip[: end - start]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    args = ap.parse_args()
    kokoro = Kokoro(str(Path(args.model) / 'kokoro-v1.0.onnx'), str(Path(args.model) / 'voices-v1.0.bin'))
    raw = json.loads(RAW.read_text())
    beats = json.loads((ROOT / 'public/story/across-the-sea.story.json').read_text())['beats']
    OUT.mkdir(parents=True, exist_ok=True)

    # --- Dad's story: each line at its beat, sped up a little if it would run into his next line.
    lines = [(e['t'] / 1000, beats[e['data']['index']]['id']) for e in raw['events'] if e['type'] == 'beat']
    lines = [(t, DAD[b]) for t, b in lines if b in DAD]
    track = np.zeros(int(raw['durationMs'] / 1000 * RATE) + RATE, dtype=np.float32)
    for i, (t, text) in enumerate(lines):
        clip = tts(kokoro, text, 'am_michael', 0.95)
        room = (lines[i + 1][0] if i + 1 < len(lines) else len(track) / RATE) - t - 0.25
        if len(clip) / RATE > room > 0:
            clip = ffmpeg_filter(clip, f'atempo={min(1.3, len(clip) / RATE / room):.3f}')
        place(track, clip, t + 0.15)
    story = {**raw, 'id': 'sample-story-from-dad', 'title': 'A story from far away', 'performer': 'Dad', 'child': 'Mia',
             'sample': True, 'audio': mp3_data_url(track), 'audioType': 'audio/mpeg'}
    (OUT / 'story-from-dad.json').write_text(json.dumps(story))

    # --- Mia's goodnight: the rabbit moment, with a child's (smaller) hands.
    frames = np.frombuffer(base64.b64decode(raw['hands']), dtype='<i2').reshape(-1, STRIDE).copy()
    wake = next(e['t'] for e in raw['events'] if e['type'] == 'wake' and e['data'].get('shape') == 'rabbit') / 1000
    start, seconds = wake - 3.0, 10.0
    clip = frames[int(start * 30): int((start + seconds) * 30)]
    for side in (0, 1):
        o = 1 + side * 75
        present = (clip[:, 0] & (1 << side)) != 0
        joints = clip[present, o:o + 75].reshape(-1, 25, 3).astype(np.float32)
        wrist = joints[:, :1, :]
        clip[present, o:o + 75] = np.round(wrist + (joints - wrist) * 0.8).reshape(-1, 75).astype('<i2')
    first = {e['type']: e for e in reversed(raw['events'])}  # earliest of each type
    snapshot = dict(first['snapshot']['data'], scenery='field', mothMode='hidden', lampLevel=1, finale=0, mothGlow=0)
    events = [
        {'t': 0, 'type': 'snapshot', 'data': snapshot},
        {'t': 0, 'type': 'lamp', 'data': first['lamp']['data']},
        {'t': 0, 'type': 'stage', 'data': {'lampLevel': 1, 'finale': 0, 'glow': 0}},
        {'t': 3000, 'type': 'wake', 'data': {'shape': 'rabbit', 'hand': 'right', 'twoHanded': False}},
        {'t': 8800, 'type': 'release', 'data': {'shape': 'rabbit'}},
    ]
    voice = np.zeros(int(seconds * RATE), dtype=np.float32)
    for at, text in MIA:
        # A younger voice: Kokoro's Bella, pitched up a little.
        line = ffmpeg_filter(tts(kokoro, text, 'af_bella', 1.0), f'asetrate={RATE * 1.12:.0f},aresample={RATE},atempo={1 / 1.12:.4f}')
        place(voice, line, at)
    goodnight = {
        'version': raw['version'], 'id': 'sample-goodnight-from-mia', 'title': 'A goodnight from Mia',
        'performer': 'Mia', 'child': '', 'createdAt': raw['createdAt'], 'durationMs': int(seconds * 1000),
        'script': '', 'frameHz': 30, 'frameCount': len(clip), 'hands': base64.b64encode(clip.tobytes()).decode(),
        'events': events, 'audio': mp3_data_url(voice), 'audioType': 'audio/mpeg', 'replyTo': 'sample', 'sample': True,
    }
    (OUT / 'goodnight-from-mia.json').write_text(json.dumps(goodnight))
    for f in OUT.glob('*.json'):
        print(f.name, f'{f.stat().st_size / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
