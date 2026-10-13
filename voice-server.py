#!/usr/bin/env python3
"""Read Aloud 2: natural voices on this Mac, for the Chrome add-on and the voice sampler page.

Runs Kokoro-82M (Apache-2.0) through mlx-audio (MIT) on the Mac's own GPU. No internet, no account, no tokens.
Start:  ~/.local/share/uv/tools/mlx-audio/bin/python "voice-server.py"   (port 8793, this Mac only)

  GET /                     the voice sampler page (voices.html)
  GET /voices               the voice list as JSON
  POST /ocr                 a picture (PNG) -> its text, word by word with places (Apple's Vision, ocr/ocr.swift)
  GET /speak?text=&voice=   one sentence as a WAV file (24 kHz); recent ones are kept, so replay and read-ahead are instant
                            &ahead=1|2|3 marks read-ahead (3 next sentences, 2 under the mouse, 1 on screen, with &batch=):
                            it waits while someone waits to hear a sentence; higher and newer go first

Version 1 (~/.claude/read-aloud, port 8791) is not touched.
"""
import collections, functools, itertools, http.server, io, json, os, re, subprocess, sys, tempfile, threading, time, urllib.parse

import numpy as np
import soundfile as sf

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8793
HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = 'mlx-community/Kokoro-82M-bf16'
ALLOWED = {f'localhost:{PORT}', f'127.0.0.1:{PORT}', f'[::1]:{PORT}'}
MAX_CHARS = 1500  # a sentence, or a paragraph from the PDF viewer

# name, accent, language code, label. Kokoro grades: heart and bella are its best English voices.
VOICES = [
    ('af_heart', 'American', 'a', 'Heart, warm female (best)'), ('af_bella', 'American', 'a', 'Bella, bright female'),
    ('af_nicole', 'American', 'a', 'Nicole, soft female'), ('af_sarah', 'American', 'a', 'Sarah, calm female'),
    ('af_nova', 'American', 'a', 'Nova, clear female'), ('af_sky', 'American', 'a', 'Sky, light female'),
    ('am_michael', 'American', 'a', 'Michael, deep male'), ('am_fenrir', 'American', 'a', 'Fenrir, strong male'),
    ('am_puck', 'American', 'a', 'Puck, lively male'), ('am_eric', 'American', 'a', 'Eric, plain male'),
    ('am_liam', 'American', 'a', 'Liam, young male'), ('am_onyx', 'American', 'a', 'Onyx, low male'),
    ('bf_emma', 'British', 'b', 'Emma, female'), ('bf_isabella', 'British', 'b', 'Isabella, female'),
    ('bf_alice', 'British', 'b', 'Alice, female'), ('bm_george', 'British', 'b', 'George, male'),
    ('bm_fable', 'British', 'b', 'Fable, male'), ('bm_daniel', 'British', 'b', 'Daniel, male'),
    ('if_sara', 'Italian', 'i', 'Sara, female'), ('im_nicola', 'Italian', 'i', 'Nicola, male'),
]
LANG = {v[0]: v[2] for v in VOICES}

_model = None
_gen = threading.Lock()  # MLX runs one generation at a time
_turn = threading.Condition()
_urgent = [0]  # sentences someone is waiting to hear; read-ahead waits while there are any
_waiting, _seq, _batch = set(), itertools.count(), [0]
_cache = collections.OrderedDict()
_broken = set()  # languages that failed to load (Italian needs espeak-ng)


def model():
    global _model
    if _model is None:
        from mlx_audio.tts.utils import load_model
        _model = load_model(MODEL)
    return _model


def trim(audio, text, sr=24000):
    """Kokoro leaves about 0.3 s of silence before and 0.5 s after each piece. Keep a short natural pause instead:
    0.18 s after a full stop, 0.12 s after a comma, almost none where a sentence was cut to start sooner."""
    loud = np.where(np.abs(audio) > 0.01)[0]
    if not len(loud):
        return audio
    t = text.rstrip(' "\'”’)]')
    tail = 0.18 if t[-1:] in '.!?…' else 0.12 if t[-1:] in ',;:' else 0.03
    a = audio[max(0, loud[0] - int(0.03 * sr)): min(len(audio), loud[-1] + int(tail * sr))].copy()
    fade = min(len(a) // 4, int(0.005 * sr))  # 5 ms fades: no click at the cut
    if fade:
        a[:fade] *= np.linspace(0, 1, fade)
        a[-fade:] *= np.linspace(1, 0, fade)
    return a


def speak(text, voice, ahead=False, prio=1, batch=0):
    key = (voice, text)
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    if not ahead:
        with _turn:
            _urgent[0] += 1
    try:
        return _make(key, text, voice, ahead, prio, batch)
    finally:
        if not ahead:
            with _turn:
                _urgent[0] -= 1
                _turn.notify_all()


def _take(ahead, prio, batch):
    """Wait for the engine. A sentence someone waits to hear goes first; then read-ahead by priority
    (3 = next sentences while reading, 2 = where the mouse rests, 1 = what is on screen), newest first.
    Screen requests from an older screen give up (False): you scrolled away."""
    if not ahead:
        _gen.acquire()
        return True
    me = (prio, next(_seq))
    with _turn:
        _waiting.add(me)
        if prio == 1:
            _batch[0] = max(_batch[0], batch)
    try:
        while True:
            with _turn:
                _turn.wait_for(lambda: _urgent[0] == 0 and me == max(_waiting), timeout=0.5)
                if prio == 1 and batch < _batch[0]:
                    return False
                mine = _urgent[0] == 0 and me == max(_waiting)
            if mine and _gen.acquire(timeout=0.05):
                if _urgent[0] == 0:
                    return True
                _gen.release()
    finally:
        with _turn:
            _waiting.discard(me)
            _turn.notify_all()


def _make(key, text, voice, ahead=False, prio=1, batch=0):
    if not _take(ahead, prio, batch):
        return None
    try:  # stored before the lock opens, so a second ask for the same sentence finds it ready
        if key in _cache:
            return _cache[key]
        if os.environ.get('VOICE_LOG'):
            print(time.strftime('%H:%M:%S'), 'ahead' if ahead else 'NOW  ', voice, repr(text[:70]), flush=True)
        parts = [np.array(r.audio) for r in model().generate(text=text, voice=voice, speed=1.0, lang_code=LANG[voice])]
        buf = io.BytesIO()
        sf.write(buf, trim(np.concatenate(parts) if parts else np.zeros(2400), text), 24000, format='WAV', subtype='PCM_16')
        _cache[key] = buf.getvalue()
        while len(_cache) > 300:
            _cache.popitem(last=False)
        return _cache[key]
    finally:
        _gen.release()
        with _turn:
            _turn.notify_all()


def warm_up():
    for lang, voice in (('a', 'af_heart'), ('b', 'bf_emma'), ('i', 'if_sara')):
        try:
            speak('Ready.', voice, ahead=True, prio=0)
        except Exception:
            _broken.add(lang)
    for v, _, lang, _ in VOICES:  # load every voice once, so the first use of any voice is quick
        if lang not in _broken:
            try:
                speak('Ready.', v, ahead=True, prio=0)
            except Exception:
                pass


OCR = os.path.join(HERE, 'ocr', 'ocr')
_ocr_slots = threading.Semaphore(2)


def ocr(picture):
    if not os.path.exists(OCR):  # build the small Vision helper once (Xcode command line tools are on this Mac)
        subprocess.run(['swiftc', '-O', OCR + '.swift', '-o', OCR], check=True, capture_output=True, timeout=300)
    with _ocr_slots, tempfile.NamedTemporaryFile(suffix='.png') as f:
        f.write(picture)
        f.flush()
        return subprocess.run([OCR, f.name], check=True, capture_output=True, timeout=120).stdout


class Handler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        if (self.headers.get('Host') or '').lower() not in ALLOWED:
            self.send_error(403, 'Forbidden')
            return None
        url = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        if url.path == '/voices':
            data = [{'id': v, 'accent': a, 'label': l} for v, a, c, l in VOICES if c not in _broken]
            return self.reply(json.dumps({'voices': data, 'ready': _model is not None}).encode(), 'application/json')
        if url.path == '/speak':
            text = re.sub(r'\s+', ' ', q.get('text', '')).strip()[:MAX_CHARS]
            voice = q.get('voice', 'af_heart')
            if not text or voice not in LANG or LANG[voice] in _broken:
                self.send_error(400, 'Bad text or voice')
                return None
            try:
                ahead = q.get('ahead', '0')
                wav = speak(text, voice, ahead=ahead != '0', prio=int(ahead) if ahead.isdigit() else 1, batch=int(q.get('batch', '0') or 0))
                if wav is None:
                    self.send_error(409, 'Skipped: you scrolled on')
                    return None
                return self.reply(wav, 'audio/wav')
            except Exception as e:
                self.send_error(500, str(e)[:200])
                return None
        if url.path in ('/', '/index.html'):
            self.path = '/voices.html'
        if not re.match(r'^/[\w.-]+\.(html|js|css)$', self.path.split('?')[0]):  # only the page files, never the folder
            self.send_error(404, 'Not found')
            return None
        return super().send_head()

    def do_POST(self):  # /ocr: the text in a picture (a page of a scanned book), by Apple's Vision
        if (self.headers.get('Host') or '').lower() not in ALLOWED or self.path != '/ocr':
            self.send_error(403 if self.path == '/ocr' else 404)
            return
        size = int(self.headers.get('Content-Length') or 0)
        if not 0 < size <= 40_000_000:
            self.send_error(413, 'Picture too large')
            return
        try:
            body = ocr(self.rfile.read(size))
        except Exception as e:
            self.send_error(500, str(e)[:200])
            return
        self.copyfile(self.reply(body, 'application/json'), self.wfile)

    def reply(self, body, kind):
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        return io.BytesIO(body)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    threading.Thread(target=warm_up, daemon=True).start()
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=HERE)).serve_forever()
