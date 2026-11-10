"""Prototype for ticket 06 (speed that keeps the pitch): comparison sound files for the owner.

Run with the voice server's Python, in its own process (it does not talk to the live server):
    ~/.local/share/uv/tools/mlx-audio/bin/python tools/speed-compare.py

It loads the same Kokoro model the same way as voice-server.py (offline only), says one fixed passage with the
default voice at speeds 1.0, 1.1, 1.5, 2.0 and 3.0 in three methods, and writes WAV files and a listening page to
~/read-aloud-samples/speed-compare/:
    model    the model's own speed parameter, played at rate 1
    present  the speed-1.0 sound resampled to play faster (what the reader does today; the pitch goes up)
    stretch  the speed-1.0 sound time-stretched with ffmpeg atempo, pitch kept (only when ffmpeg is on the PATH)
"""
import os
os.environ['HF_HUB_OFFLINE'] = '1'  # never download: the model must already be on disk
os.environ['TRANSFORMERS_OFFLINE'] = '1'

import html, importlib.util, shutil, subprocess, sys, time
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.expanduser('~/read-aloud-samples/speed-compare')
SR = 24000
VOICE = 'af_heart'  # the server's default voice
SPEEDS = [1.0, 1.1, 1.5, 2.0, 3.0]
TEXT = ('The new library opens at nine in the morning and closes at 6:30 in the evening. '
        'Visitors can borrow up to 12 books at a time, and the staff are happy to help with any questions. '
        'A short introduction to the building takes about fifteen minutes and is free of charge.')
LABELS = {'model': 'A: voice model makes it faster', 'present': "B: today's method",
          'stretch': 'C: stretched, pitch kept'}

# Load the server's own model code (model(), trim()) without starting the server: its HTTP code runs only under
# __main__, so importing the module defines functions and constants only.
spec = importlib.util.spec_from_file_location('voice_server', os.path.join(HERE, '..', 'voice-server.py'))
vs = importlib.util.module_from_spec(spec)
sys.argv = [sys.argv[0], '0']  # PORT is read from argv at import; 0 = not used
spec.loader.exec_module(vs)


def make(text, speed):
    """Same path as voice-server.synth() for English, with the speed passed to the model."""
    pipe = vs.model()._get_pipeline(vs.LANG[VOICE])
    parts = [np.array(r.audio).reshape(-1) for r in pipe(text, voice=VOICE, speed=speed, split_pattern=r'\n+')
             if r.audio is not None]
    return np.concatenate(parts) if parts else np.zeros(2400)


def write(name, audio):
    path = os.path.join(OUT, name)
    sf.write(path, np.clip(audio, -1, 1), SR, subtype='PCM_16')
    return path


def present(base, speed):
    """playbackRate = speed: the same samples played speed times faster = resample to len/speed at the same rate."""
    f = Fraction(speed).limit_denominator(100)
    return resample_poly(base, f.denominator, f.numerator)


def atempo_chain(speed):
    parts, s = [], speed
    while s > 2.0:
        parts.append('atempo=2.0')
        s /= 2.0
    parts.append(f'atempo={s:.6g}')
    return ','.join(parts)


def main():
    os.makedirs(OUT, exist_ok=True)
    ffmpeg = shutil.which('ffmpeg')
    t = time.time()
    vs.model()
    print(f'model loaded in {time.time() - t:.1f} s')
    make('Ready.', 1.0)  # warm-up, so the first timed speed is not slowed by first-use work
    rows, files = [], {}
    base = None
    for sp in SPEEDS:
        t = time.time()
        a = make(TEXT, sp)
        took = time.time() - t
        a, _ = vs.trim(a.astype(np.float32), TEXT)
        if sp == 1.0:
            base = a
        files[('model', sp)] = write(f'model-{sp:.1f}.wav', a)
        rows.append(('model', sp, took))
    for sp in SPEEDS:
        files[('present', sp)] = write(f'present-{sp:.1f}.wav', base if sp == 1.0 else present(base, sp))
    if ffmpeg:
        src = files[('model', 1.0)]
        for sp in SPEEDS:
            dst = os.path.join(OUT, f'stretch-{sp:.1f}.wav')
            if sp == 1.0:
                shutil.copyfile(src, dst)
            else:
                subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', src, '-filter:a', atempo_chain(sp),
                                '-ar', str(SR), '-ac', '1', '-c:a', 'pcm_s16le', dst], check=True)
            files[('stretch', sp)] = dst
    else:
        print('ffmpeg not found: the stretch method is skipped')

    took = {sp: s for _, sp, s in rows}
    d1 = len(base) / SR
    print(f'\n{"file":<18}{"seconds":>9}{"expected":>10}{"off %":>8}{"rms":>8}{"peak":>7}{"make s":>8}')
    problems = []
    for (meth, sp), path in sorted(files.items()):
        a, sr = sf.read(path)
        dur = len(a) / sr
        exp = d1 / sp
        off = (dur - exp) / exp * 100
        rms = float(np.sqrt(np.mean(a ** 2)))
        peak = float(np.max(np.abs(a)))
        mk = f'{took[sp]:.2f}' if meth == 'model' else ''
        print(f'{os.path.basename(path):<18}{dur:9.2f}{exp:10.2f}{off:8.1f}{rms:8.3f}{peak:7.2f}{mk:>8}')
        if rms < 0.005:
            problems.append(f'{path}: silent (rms {rms:.4f})')
        if abs(off) > 10:
            problems.append(f'{os.path.basename(path)}: {dur:.2f} s, asked {exp:.2f} s ({off:+.0f}%)')
        if peak >= 0.999:
            problems.append(f'{os.path.basename(path)}: peak {peak:.3f}, may clip')
    print('\nproblems:' if problems else '\nno problems found')
    for p in problems:
        print('  ' + p)
    page(files, ffmpeg)


def page(files, ffmpeg):
    methods = ['model', 'present'] + (['stretch'] if ffmpeg else [])
    out = ['<!doctype html><html lang="en"><head><meta charset="utf-8">',
           '<meta name="viewport" content="width=device-width, initial-scale=1">',
           '<title>Speed compare</title><style>',
           'body{font:22px/1.5 -apple-system,Helvetica,Arial,sans-serif;max-width:46rem;margin:2rem auto;padding:0 16px;',
           'background:#fff;color:#111}h1{font-size:1.6em}h2{font-size:1.3em;margin-top:2em;border-top:2px solid #ccc;',
           'padding-top:.6em}p.l{margin:.8em 0 .2em;font-weight:600}audio{width:100%}',
           '@media (prefers-color-scheme:dark){body{background:#111;color:#eee}h2{border-color:#444}}</style></head><body>',
           '<h1>Speed compare</h1>',
           '<p>Listen for two things. Is the pitch the same as at speed 1.0? Is the voice clear?</p>',
           '<p>Each speed has three sounds. A: the voice model makes the sound faster. B: the reader plays the sound '
           'faster, as it does today. C: the sound is stretched, and the pitch stays the same.</p>',
           f'<p>The text: {html.escape(TEXT)}</p>']
    if not ffmpeg:
        out.append('<p>Sound C is not here, because ffmpeg is not on this Mac.</p>')
    for sp in SPEEDS:
        out.append(f'<h2>Speed {sp:.1f}</h2>')
        for m in methods:
            name = os.path.basename(files[(m, sp)])
            out.append(f'<p class="l">{html.escape(LABELS[m])}</p><audio controls preload="none" src="{name}"></audio>')
    out.append('</body></html>')
    with open(os.path.join(OUT, 'index.html'), 'w') as f:
        f.write('\n'.join(out))
    print('\npage:', os.path.join(OUT, 'index.html'))


if __name__ == '__main__':
    main()
