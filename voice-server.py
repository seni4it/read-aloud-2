#!/usr/bin/env python3
"""Read Aloud 2: natural voices on this Mac, for the Chrome add-on and the voice sampler page.

Runs Kokoro-82M (Apache-2.0) through mlx-audio (MIT) on the Mac's own GPU. No internet, no account, no tokens.
Start:  ~/.local/share/uv/tools/mlx-audio/bin/python "voice-server.py"   (port 8793, this Mac only)

  GET /                     the voice sampler page (voices.html)
  GET /voices               the voice list as JSON
  GET /speak?text=&voice=   one sentence as a WAV file (24 kHz); recent ones are kept, so replay and read-ahead are instant

Version 1 (~/.claude/read-aloud, port 8791) is not touched.
"""
import collections, functools, http.server, io, json, os, re, sys, threading, time, urllib.parse

import numpy as np
import soundfile as sf

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8793
HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = 'mlx-community/Kokoro-82M-bf16'
ALLOWED = {f'localhost:{PORT}', f'127.0.0.1:{PORT}', f'[::1]:{PORT}'}
MAX_CHARS = 600  # one sentence or a short paragraph per request; the add-on splits longer text

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
_cache = collections.OrderedDict()
_broken = set()  # languages that failed to load (Italian needs espeak-ng)


def model():
    global _model
    if _model is None:
        from mlx_audio.tts.utils import load_model
        _model = load_model(MODEL)
    return _model


def speak(text, voice):
    key = (voice, text)
    if key in _cache:
        _cache.move_to_end(key)
        return _cache[key]
    with _gen:
        if key in _cache:
            return _cache[key]
        parts = [np.array(r.audio) for r in model().generate(text=text, voice=voice, speed=1.0, lang_code=LANG[voice])]
    buf = io.BytesIO()
    sf.write(buf, np.concatenate(parts) if parts else np.zeros(2400), 24000, format='WAV', subtype='PCM_16')
    _cache[key] = buf.getvalue()
    while len(_cache) > 200:
        _cache.popitem(last=False)
    return _cache[key]


def warm_up():
    for lang, voice in (('a', 'af_heart'), ('b', 'bf_emma'), ('i', 'if_sara')):
        try:
            speak('Ready.', voice)
        except Exception:
            _broken.add(lang)


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
                return self.reply(speak(text, voice), 'audio/wav')
            except Exception as e:
                self.send_error(500, str(e)[:200])
                return None
        if url.path in ('/', '/index.html'):
            self.path = '/voices.html'
        if not re.match(r'^/[\w.-]+\.(html|js|css)$', self.path.split('?')[0]):  # only the page files, never the folder
            self.send_error(404, 'Not found')
            return None
        return super().send_head()

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
