#!/usr/bin/env python3
"""Read Aloud 2: natural voices on this Mac, for the Chrome add-on and the voice sampler page.

Runs Kokoro-82M (Apache-2.0) through mlx-audio (MIT) on the Mac's own GPU. No internet, no account, no tokens.
Start:  ~/.local/share/uv/tools/mlx-audio/bin/python "voice-server.py"   (port 8793, this Mac only)

  GET /                     the voice sampler page (voices.html)
  GET /voices               the voice list as JSON
  POST /ocr                 a picture (PNG) -> its text, word by word with places (Apple's Vision, ocr/ocr.swift)

Desktop reader (the "Read Aloud" app opens http://127.0.0.1:8793/app/):
  /app/...                  the library page (app/)          /reader/...  the PDF reader (extension/pdf, the same code)
  GET  /library.json        the books in ~/Documents/Read Aloud Library (PDFs dropped there in Finder are picked up)
  GET  /library/file/<id>   one book        GET /library/cover/<id>   its cover (made by macOS Quick Look)
  POST /library/add?name=   add a PDF (body)    POST /library/<id>/opened    POST /library/<id>/remove (to the Trash)
  GET/POST /library/<id>/notes   the book's highlights (JSON), kept in .notes/<id>.json
  POST /library/<id>/export   make MP3 files of the book, one per chapter, with the cover picture (body: JSON
                              {title, voice, chapters: [{title, text: [...]}]}); GET the same: progress;
                              POST .../export/cancel; POST .../export/open shows the folder in Finder.
                              Files go to ~/Documents/Read Aloud Library/Audio/<book>/ (READ_ALOUD_AUDIO to change)
  GET /speak?text=&voice=   one sentence as a WAV file (24 kHz); recent ones are kept, so replay and read-ahead are instant
  GET /times?text=&voice=   when each word of that sentence starts, in seconds of the WAV (Kokoro's own timings), as
                            {"starts": [...]}, one per space-separated word; null where Kokoro gave none
                            &ahead=1|2|3 marks read-ahead (3 next sentences, 2 under the mouse, 1 on screen, with &batch=):
                            it waits while someone waits to hear a sentence; higher and newer go first

Version 1 (~/.claude/read-aloud, port 8791) is not touched.
"""
import collections, functools, hashlib, itertools, http.server, io, json, mimetypes, os, re, shutil, subprocess, sys, tempfile, threading, time, urllib.error, urllib.parse, urllib.request

import numpy as np
import soundfile as sf

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8793
HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = 'mlx-community/Kokoro-82M-bf16'
ALLOWED = {f'localhost:{PORT}', f'127.0.0.1:{PORT}', f'[::1]:{PORT}'}
MAX_CHARS = 1500  # a sentence, or a paragraph from the PDF viewer

# name, accent, language code, label. Kokoro grades: heart and bella are its best English voices.
VOICES = [  # his choice (13 Oct 2026): a few good ones, not twenty. Russian is the Mac's own voice (Milena), in the add-on.
    ('af_heart', 'American', 'a', 'Heart, warm female'), ('am_michael', 'American', 'a', 'Michael, deep male'),
    ('bf_emma', 'British', 'b', 'Emma, female'), ('if_sara', 'Italian', 'i', 'Sara, Italian female'),
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


def word_starts(text, tokens, shift):
    """Kokoro's per-token start times, moved onto the space-separated words of text (what the reader highlights)."""
    spans = [(m.start(), m.end()) for m in re.finditer(r'\S+', text)]
    starts = [None] * len(spans)
    pos = 0
    for t in tokens:
        if getattr(t, 'start_ts', None) is None or not t.text:
            continue
        k = text.find(t.text, pos)
        if k < 0:
            continue
        pos = k + len(t.text)
        for i, (a, b) in enumerate(spans):
            if a <= k < b:
                if starts[i] is None:
                    starts[i] = round(max(0.0, t.start_ts - shift), 3)
                break
    return starts


def trim(audio, text, sr=24000):
    """Kokoro leaves about 0.3 s of silence before and 0.5 s after each piece. Keep a short natural pause instead:
    0.18 s after a full stop, 0.12 s after a comma, almost none where a sentence was cut to start sooner."""
    loud = np.where(np.abs(audio) > 0.01)[0]
    if not len(loud):
        return audio, 0.0
    t = text.rstrip(' "\'”’)]')
    tail = 0.18 if t[-1:] in '.!?…' else 0.12 if t[-1:] in ',;:' else 0.03
    cut = max(0, loud[0] - int(0.03 * sr))
    a = audio[cut: min(len(audio), loud[-1] + int(tail * sr))].copy()
    fade = min(len(a) // 4, int(0.005 * sr))  # 5 ms fades: no click at the cut
    if fade:
        a[:fade] *= np.linspace(0, 1, fade)
        a[-fade:] *= np.linspace(1, 0, fade)
    return a, cut / sr


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


def synth(text, voice):
    """Audio and Kokoro's tokens (with start times). English goes through the pipeline directly, which keeps
    the timings; other languages use the plain path (no timings: the reader estimates them)."""
    m = model()
    if LANG[voice] in ('a', 'b'):
        pipe = m._get_pipeline(LANG[voice])
        parts, tokens, offset = [], [], 0.0
        for r in pipe(text, voice=voice, speed=1, split_pattern=r'\n+'):
            if r.audio is None:
                continue
            a = np.array(r.audio).reshape(-1)
            for t in r.tokens or []:
                if getattr(t, 'start_ts', None) is not None:
                    t.start_ts += offset
            tokens += list(r.tokens or [])
            parts.append(a)
            offset += len(a) / 24000
        return (np.concatenate(parts) if parts else np.zeros(2400)), tokens
    parts = [np.array(r.audio) for r in m.generate(text=text, voice=voice, speed=1.0, lang_code=LANG[voice])]
    return (np.concatenate(parts) if parts else np.zeros(2400)), []


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
        audio, tokens = synth(text, voice)
        wav, shift = trim(audio, text)
        buf = io.BytesIO()
        sf.write(buf, wav, 24000, format='WAV', subtype='PCM_16')
        _cache[key] = (buf.getvalue(), word_starts(text, tokens, shift))
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


LIB = os.environ.get('READ_ALOUD_LIBRARY', os.path.expanduser('~/Documents/Read Aloud Library'))
COVERS = os.path.join(LIB, '.covers')
STATIC = {'/app/': os.path.join(HERE, 'app'), '/reader/': os.path.join(HERE, 'extension', 'pdf')}
mimetypes.add_type('text/javascript', '.mjs')
_lib = threading.Lock()


def lib_index():
    """The library: {id: {name, file, added, opened}}; PDFs put in the folder by hand are added on the way."""
    os.makedirs(COVERS, exist_ok=True)
    path = os.path.join(LIB, 'library.json')
    try:
        with open(path, encoding='utf-8') as f:
            idx = json.load(f)
    except (OSError, ValueError):
        idx = {}
    files = {b['file'] for b in idx.values()}
    changed = False
    for name in sorted(os.listdir(LIB)):
        full = os.path.join(LIB, name)
        if name.lower().endswith('.pdf') and name not in files and os.path.isfile(full):
            st = os.stat(full)
            bid = hashlib.sha1(f'{name}|{st.st_size}|{st.st_mtime}'.encode()).hexdigest()[:12]
            idx[bid] = {'name': name[:-4], 'file': name, 'added': st.st_mtime, 'opened': 0}
            changed = True
    for bid in [k for k, b in idx.items() if not os.path.exists(os.path.join(LIB, b['file']))]:
        del idx[bid]  # deleted in Finder
        changed = True
    if changed:
        lib_save(idx)
    return idx


def lib_save(idx):
    tmp = os.path.join(LIB, 'library.json.tmp')
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(idx, f, ensure_ascii=False, indent=1)
    os.replace(tmp, os.path.join(LIB, 'library.json'))


def lib_add(name, data):
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', ' ', os.path.basename(name or 'document.pdf')).strip() or 'document.pdf'
    if not name.lower().endswith('.pdf'):
        name += '.pdf'
    with _lib:
        idx = lib_index()
        file, n = name, 2
        while os.path.exists(os.path.join(LIB, file)):
            file = f'{name[:-4]} ({n}).pdf'
            n += 1
        with open(os.path.join(LIB, file), 'wb') as f:
            f.write(data)
        bid = hashlib.sha1(data).hexdigest()[:12]
        idx[bid] = {'name': file[:-4], 'file': file, 'added': time.time(), 'opened': 0}
        lib_save(idx)
    threading.Thread(target=lib_cover, args=(bid,), daemon=True).start()
    return bid


def lib_cover(bid):
    """A cover picture of page 1, made by macOS Quick Look (qlmanage), kept in .covers/<id>.png."""
    out = os.path.join(COVERS, bid + '.png')
    if os.path.exists(out):
        return out
    b = lib_index().get(bid)
    if not b:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['qlmanage', '-t', '-s', '420', '-o', tmp, os.path.join(LIB, b['file'])], capture_output=True, timeout=60)
        made = [f for f in os.listdir(tmp) if f.endswith('.png')]
        if made:
            shutil.move(os.path.join(tmp, made[0]), out)
    return out if os.path.exists(out) else None


AUDIO = os.environ.get('READ_ALOUD_AUDIO', os.path.join(LIB, 'Audio'))
FFMPEG = shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'
_exports = {}  # book id -> {state, chapter, chapters, done, total, files, folder, error, cancel}


def export_book(bid, job):
    """One MP3 per chapter: the chapter title, then its sentences with short pauses; 64 kb/s mono, the cover as art."""
    st = _exports[bid]
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', ' ', job.get('title') or 'Book').strip()[:80] or 'Book'
    folder = os.path.join(AUDIO, name)
    os.makedirs(folder, exist_ok=True)
    st.update(folder=folder, state='running')
    voice = job.get('voice') if job.get('voice') in LANG else 'af_heart'
    cover = lib_cover(bid)
    chapters = job.get('chapters') or []
    st['total'] = sum(len(c.get('text') or []) + 1 for c in chapters)
    sr = 24000
    pause = lambda sec: np.zeros(int(sr * sec), dtype=np.float32)
    try:
        for k, ch in enumerate(chapters, 1):
            if st.get('cancel'):
                st['state'] = 'cancelled'
                return
            title = (ch.get('title') or f'Part {k}').strip()
            st.update(chapter=k, chapters=len(chapters), title=title)
            wav = os.path.join(folder, f'{k:02d}.wav')
            with sf.SoundFile(wav, 'w', samplerate=sr, channels=1, subtype='PCM_16') as f:
                pieces = [title] + [t for t in (ch.get('text') or []) if t and t.strip()]
                for i, text in enumerate(pieces):
                    if st.get('cancel'):
                        break
                    audio, _ = synth(text[:MAX_CHARS], voice)
                    a, _ = trim(audio, text)
                    f.write(a.astype(np.float32))
                    f.write(pause(0.9 if i == 0 else 0.3))
                    st['done'] += 1
            if st.get('cancel'):
                os.remove(wav)
                st['state'] = 'cancelled'
                return
            safe = re.sub(r'[\\/:*?"<>|]', ' ', title)[:60].strip()
            mp3 = os.path.join(folder, f'{k:02d} {safe}.mp3')
            cmd = [FFMPEG, '-y', '-loglevel', 'error', '-i', wav]
            if cover:
                cmd += ['-i', cover, '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic',
                        '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)']
            cmd += ['-c:a', 'libmp3lame', '-b:a', '64k', '-ac', '1', '-id3v2_version', '3',
                    '-metadata', f'title={title}', '-metadata', f'album={name}', '-metadata', f'track={k}/{len(chapters)}',
                    '-metadata', 'artist=Read Aloud 2', '-metadata', 'genre=Audiobook', mp3]
            subprocess.run(cmd, check=True, capture_output=True, timeout=600)
            os.remove(wav)
            st['files'].append(os.path.basename(mp3))
            if os.path.exists(YT_TOKEN) and yt_load(YT_QUEUE, {}).get('auto', True):
                yt_enqueue(bid, name, k, title, mp3)
        st['state'] = 'done'
    except Exception as e:
        st.update(state='error', error=str(e)[:200])


# ---------------------------------------------------------------- YouTube: private videos of the MP3s
# Setup (once, by him; the app's page /app/youtube-setup.html shows the steps): a Google Cloud project with the
# YouTube Data API on, an OAuth client of type "Desktop app", its client_secret.json given to the app, then
# "Connect". Tokens stay in ~/Documents/Read Aloud Library/.youtube/. Google's quota allows about 6 uploads a
# day, so uploads wait in a queue and go out by themselves, 6 a day, while the server runs.
YT_DIR = os.path.join(LIB, '.youtube')
YT_SECRET = os.path.join(YT_DIR, 'client_secret.json')
YT_TOKEN = os.path.join(YT_DIR, 'token.json')
YT_QUEUE = os.path.join(YT_DIR, 'queue.json')
YT_SCOPE = 'https://www.googleapis.com/auth/youtube'
_yt = threading.Lock()


def yt_load(path, default):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def yt_save(path, obj, private=False):
    os.makedirs(YT_DIR, exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    if private:
        os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def yt_client():
    d = yt_load(YT_SECRET, {})
    c = d.get('installed') or d.get('web') or {}
    return c.get('client_id'), c.get('client_secret')


def yt_post(url, data, headers=None, raw=False):
    body = data if raw else urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers=headers or {'Content-Type': 'application/x-www-form-urlencoded'}, method='POST')
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.status, r.headers, r.read()


def yt_token():
    """A valid access token, refreshed when old; None when not connected."""
    t = yt_load(YT_TOKEN, {})
    if not t.get('refresh_token'):
        return None
    if t.get('expires_at', 0) > time.time() + 60:
        return t['access_token']
    cid, sec = yt_client()
    _, _, body = yt_post('https://oauth2.googleapis.com/token', {'client_id': cid, 'client_secret': sec, 'refresh_token': t['refresh_token'], 'grant_type': 'refresh_token'})
    new = json.loads(body)
    t.update(access_token=new['access_token'], expires_at=time.time() + int(new.get('expires_in', 3600)))
    yt_save(YT_TOKEN, t, private=True)
    return t['access_token']


def yt_api(method, url, payload=None, token=None):
    token = token or yt_token()
    req = urllib.request.Request(url, data=json.dumps(payload).encode() if payload is not None else None,
                                 headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read() or b'{}')


def yt_status():
    t = yt_load(YT_TOKEN, {})
    q = yt_load(YT_QUEUE, {'items': [], 'auto': True, 'paused_until': 0})
    return {'secret': os.path.exists(YT_SECRET), 'connected': bool(t.get('refresh_token')), 'channel': t.get('channel', ''),
            'auto': q.get('auto', True), 'paused_until': q.get('paused_until', 0),
            'pending': sum(1 for i in q['items'] if i['state'] == 'pending'), 'done': sum(1 for i in q['items'] if i['state'] == 'done'),
            'items': q['items'][-60:]}


def yt_enqueue(bid, book, k, title, mp3):
    with _yt:
        q = yt_load(YT_QUEUE, {'items': [], 'auto': True, 'paused_until': 0})
        if any(i['mp3'] == mp3 and i['state'] in ('pending', 'done') for i in q['items']):
            return
        q['items'].append({'bid': bid, 'book': book, 'k': k, 'title': title, 'mp3': mp3, 'state': 'pending', 'video': '', 'error': '', 't': time.time()})
        yt_save(YT_QUEUE, q)


def yt_make_video(mp3, cover):
    """An MP4 of the cover picture with the chapter's sound, for YouTube (made when it is uploaded, then removed)."""
    out = mp3[:-4] + '.mp4'
    cmd = [FFMPEG, '-y', '-loglevel', 'error']
    if cover:
        cmd += ['-loop', '1', '-framerate', '1', '-i', cover]
    else:
        cmd += ['-f', 'lavfi', '-i', 'color=c=0x10233f:s=1280x720:r=1']
    cmd += ['-i', mp3, '-vf', 'scale=-2:720,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x10233f', '-c:v', 'libx264', '-tune', 'stillimage',
            '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart', out]
    subprocess.run(cmd, check=True, capture_output=True, timeout=1800)
    return out


def yt_playlist(q, book):
    """The book's private playlist id, made once."""
    lists = q.setdefault('playlists', {})
    if book in lists:
        return lists[book]
    r = yt_api('POST', 'https://www.googleapis.com/youtube/v3/playlists?part=snippet,status',
               {'snippet': {'title': 'Read Aloud: ' + book, 'description': 'Audiobook made by Read Aloud 2'}, 'status': {'privacyStatus': 'private'}})
    lists[book] = r['id']
    return r['id']


def yt_upload_one(item, q):
    token = yt_token()
    cover = lib_cover(item['bid'])
    mp4 = yt_make_video(item['mp3'], cover)
    try:
        size = os.path.getsize(mp4)
        meta = {'snippet': {'title': f"{item['book']} — {item['k']:02d} {item['title']}"[:100], 'description': f"Chapter {item['k']} of {item['book']}. Made by Read Aloud 2.", 'categoryId': '27'},
                'status': {'privacyStatus': 'private', 'selfDeclaredMadeForKids': False}}
        req = urllib.request.Request('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
                                     data=json.dumps(meta).encode(), method='POST',
                                     headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json; charset=UTF-8',
                                              'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': str(size)})
        with urllib.request.urlopen(req, timeout=120) as r:
            location = r.headers['Location']
        with open(mp4, 'rb') as f:
            req = urllib.request.Request(location, data=f.read(), method='PUT', headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'video/mp4', 'Content-Length': str(size)})
            with urllib.request.urlopen(req, timeout=3600) as r:
                video = json.loads(r.read())['id']
        item.update(state='done', video=video, error='')
        try:
            pl = yt_playlist(q, item['book'])
            yt_api('POST', 'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet',
                   {'snippet': {'playlistId': pl, 'resourceId': {'kind': 'youtube#video', 'videoId': video}}})
        except Exception as e:  # the video is up; the playlist is a convenience
            item['error'] = 'playlist: ' + str(e)[:120]
    finally:
        if os.path.exists(mp4):
            os.remove(mp4)


def yt_worker():
    """Every 5 minutes: one pending upload, while connected and not paused by the daily quota."""
    while True:
        time.sleep(300)
        try:
            if not os.path.exists(YT_TOKEN):
                continue
            with _yt:
                q = yt_load(YT_QUEUE, {'items': [], 'auto': True, 'paused_until': 0})
                if q.get('paused_until', 0) > time.time():
                    continue
                item = next((i for i in q['items'] if i['state'] == 'pending' and os.path.exists(i['mp3'])), None)
                if not item:
                    continue
                item['state'] = 'uploading'
                yt_save(YT_QUEUE, q)
            try:
                yt_upload_one(item, q)
            except urllib.error.HTTPError as e:
                body = e.read().decode(errors='replace')[:300]
                if e.code == 403 and 'quota' in body.lower():
                    item['state'] = 'pending'
                    q['paused_until'] = time.time() + 6 * 3600  # Google's quota comes back each day; look again in 6 hours
                else:
                    item.update(state='error', error=f'{e.code} {body[:150]}')
            except Exception as e:
                item.update(state='error', error=str(e)[:200])
            with _yt:
                yt_save(YT_QUEUE, q)
        except Exception:
            pass


threading.Thread(target=yt_worker, daemon=True).start()


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
        if url.path in ('/speak', '/times'):
            text = re.sub(r'\s+', ' ', q.get('text', '')).strip()[:MAX_CHARS]
            voice = q.get('voice', 'af_heart')
            if not text or voice not in LANG or LANG[voice] in _broken:
                self.send_error(400, 'Bad text or voice')
                return None
            try:
                ahead = q.get('ahead', '0')
                got = speak(text, voice, ahead=ahead != '0', prio=int(ahead) if ahead.isdigit() else 1, batch=int(q.get('batch', '0') or 0))
                if got is None:
                    self.send_error(409, 'Skipped: you scrolled on')
                    return None
                if url.path == '/times':
                    return self.reply(json.dumps({'starts': got[1]}).encode(), 'application/json')
                return self.reply(got[0], 'audio/wav')
            except Exception as e:
                self.send_error(500, str(e)[:200])
                return None
        if url.path == '/library.json':
            with _lib:
                idx = lib_index()
            books = [{'id': k, **b, 'cover': os.path.exists(os.path.join(COVERS, k + '.png'))} for k, b in idx.items()]
            return self.reply(json.dumps(books, ensure_ascii=False).encode(), 'application/json')
        if url.path == '/youtube/status':
            return self.reply(json.dumps(yt_status()).encode(), 'application/json')
        if url.path == '/youtube/auth':  # to Google's sign-in page; Google sends the code back to /youtube/callback
            cid, _ = yt_client()
            if not cid:
                self.send_error(400, 'No client secret file yet')
                return None
            params = {'client_id': cid, 'redirect_uri': f'http://127.0.0.1:{PORT}/youtube/callback', 'response_type': 'code',
                      'scope': YT_SCOPE, 'access_type': 'offline', 'prompt': 'consent'}
            self.send_response(302)
            self.send_header('Location', 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode(params))
            self.end_headers()
            return None
        if url.path == '/youtube/callback':
            try:
                cid, sec = yt_client()
                _, _, body = yt_post('https://oauth2.googleapis.com/token', {'code': q.get('code', ''), 'client_id': cid, 'client_secret': sec,
                                                                            'redirect_uri': f'http://127.0.0.1:{PORT}/youtube/callback', 'grant_type': 'authorization_code'})
                t = json.loads(body)
                t['expires_at'] = time.time() + int(t.get('expires_in', 3600))
                yt_save(YT_TOKEN, t, private=True)
                ch = yt_api('GET', 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', token=t['access_token'])
                t['channel'] = (ch.get('items') or [{}])[0].get('snippet', {}).get('title', '')
                yt_save(YT_TOKEN, t, private=True)
                page = f'<!doctype html><meta charset="utf-8"><body style="font:20px -apple-system,sans-serif;padding:40px"><h1>YouTube is connected</h1><p>Channel: <b>{t["channel"]}</b>. You can close this tab and go back to Read Aloud.</p>'
            except Exception as e:
                page = f'<!doctype html><meta charset="utf-8"><body style="font:20px -apple-system,sans-serif;padding:40px"><h1>Connection failed</h1><p>{str(e)[:300]}</p>'
            return self.reply(page.encode(), 'text/html; charset=utf-8')
        m = re.match(r'^/library/([0-9a-f]{12})/export$', url.path)
        if m:  # progress of the MP3 export
            st = _exports.get(m.group(1)) or {'state': 'none'}
            return self.reply(json.dumps({k: v for k, v in st.items() if k != 'thread'}).encode(), 'application/json')
        m = re.match(r'^/library/([0-9a-f]{12})/notes$', url.path)
        if m:  # the book's highlights (Read Aloud 2 reader)
            path = os.path.join(LIB, '.notes', m.group(1) + '.json')
            body = open(path, 'rb').read() if os.path.exists(path) else b'[]'
            return self.reply(body, 'application/json')
        m = re.match(r'^/library/(file|cover)/([0-9a-f]{12})$', url.path)
        if m:
            b = lib_index().get(m.group(2))
            path = (os.path.join(LIB, b['file']) if m.group(1) == 'file' else lib_cover(m.group(2))) if b else None
            if not path or not os.path.exists(path):
                self.send_error(404, 'Not found')
                return None
            f = open(path, 'rb')
            self.send_response(200)
            self.send_header('Content-Type', 'application/pdf' if m.group(1) == 'file' else 'image/png')
            self.send_header('Content-Length', str(os.fstat(f.fileno()).st_size))
            self.end_headers()
            return f
        if url.path == '/app':
            self.send_response(302)
            self.send_header('Location', '/app/')
            self.end_headers()
            return None
        for prefix, base in STATIC.items():  # the library page and the PDF reader
            if url.path.startswith(prefix):
                rel = urllib.parse.unquote(url.path[len(prefix):]) or 'index.html'
                full = os.path.realpath(os.path.join(base, rel))
                if not full.startswith(os.path.realpath(base) + os.sep) or not os.path.isfile(full):
                    self.send_error(404, 'Not found')
                    return None
                f = open(full, 'rb')
                self.send_response(200)
                self.send_header('Content-Type', mimetypes.guess_type(full)[0] or 'application/octet-stream')
                self.send_header('Content-Length', str(os.fstat(f.fileno()).st_size))
                self.end_headers()
                return f
        if url.path in ('/', '/index.html'):
            self.path = '/voices.html'
        if not re.match(r'^/[\w.-]+\.(html|js|css)$', self.path.split('?')[0]):  # only the page files, never the folder
            self.send_error(404, 'Not found')
            return None
        return super().send_head()

    def do_POST(self):
        # Only the app and the add-on may change things: a web page elsewhere cannot add or remove books.
        origin = self.headers.get('Origin') or ''
        if (self.headers.get('Host') or '').lower() not in ALLOWED or not (
                origin in (f'http://127.0.0.1:{PORT}', f'http://localhost:{PORT}') or origin.startswith('chrome-extension://')):
            self.send_error(403, 'Forbidden')
            return
        url = urllib.parse.urlsplit(self.path)
        size = int(self.headers.get('Content-Length') or 0)
        try:
            if url.path == '/ocr':  # the text in a picture (a page of a scanned book), by Apple's Vision
                if not 0 < size <= 40_000_000:
                    self.send_error(413, 'Picture too large')
                    return
                body = ocr(self.rfile.read(size))
            elif url.path == '/library/add':
                if not 0 < size <= 500_000_000:
                    self.send_error(413, 'File too large')
                    return
                data = self.rfile.read(size)
                if not data.startswith(b'%PDF'):
                    self.send_error(415, 'Not a PDF')
                    return
                body = json.dumps({'id': lib_add(dict(urllib.parse.parse_qsl(url.query)).get('name', ''), data)}).encode()
            else:
                if url.path == '/youtube/secret':  # the client_secret.json file from Google Cloud
                    data = json.loads(self.rfile.read(size) or b'{}')
                    if not ((data.get('installed') or data.get('web') or {}).get('client_id')):
                        self.send_error(400, 'Not a client secret file')
                        return
                    yt_save(YT_SECRET, data, private=True)
                    body = b'{}'
                    self.copyfile(self.reply(body, 'application/json'), self.wfile)
                    return
                if url.path == '/youtube/setting':
                    data = json.loads(self.rfile.read(size) or b'{}')
                    with _yt:
                        qq = yt_load(YT_QUEUE, {'items': [], 'auto': True, 'paused_until': 0})
                        if 'auto' in data: qq['auto'] = bool(data['auto'])
                        if data.get('retry'):
                            for i in qq['items']:
                                if i['state'] == 'error': i['state'] = 'pending'
                            qq['paused_until'] = 0
                        yt_save(YT_QUEUE, qq)
                    self.copyfile(self.reply(b'{}', 'application/json'), self.wfile)
                    return
                if url.path == '/youtube/disconnect':
                    for f in (YT_TOKEN,):
                        if os.path.exists(f): os.remove(f)
                    self.copyfile(self.reply(b'{}', 'application/json'), self.wfile)
                    return
                m = re.match(r'^/youtube/upload/([0-9a-f]{12})$', url.path)
                if m:  # queue every MP3 already made for this book
                    st = _exports.get(m.group(1)) or {}
                    b = lib_index().get(m.group(1)) or {}
                    folder = st.get('folder') or os.path.join(AUDIO, b.get('name', ''))
                    n = 0
                    if os.path.isdir(folder):
                        for fn in sorted(os.listdir(folder)):
                            mm = re.match(r'^(\d+) (.+)\.mp3$', fn)
                            if mm:
                                yt_enqueue(m.group(1), os.path.basename(folder), int(mm.group(1)), mm.group(2), os.path.join(folder, fn)); n += 1
                    self.copyfile(self.reply(json.dumps({'queued': n}).encode(), 'application/json'), self.wfile)
                    return
                m = re.match(r'^/library/([0-9a-f]{12})/export(/cancel|/open)?$', url.path)
                if m:
                    bid, act = m.group(1), m.group(2)
                    st = _exports.get(bid)
                    if act == '/cancel':
                        if st: st['cancel'] = True
                    elif act == '/open':
                        if st and st.get('folder'): subprocess.Popen(['open', st['folder']])
                    else:
                        if st and st.get('state') == 'running':
                            self.send_error(409, 'Already exporting')
                            return
                        job = json.loads(self.rfile.read(size) or b'{}')
                        _exports[bid] = {'state': 'starting', 'chapter': 0, 'chapters': 0, 'done': 0, 'total': 0, 'files': [], 'folder': '', 'error': '', 'cancel': False}
                        t = threading.Thread(target=export_book, args=(bid, job), daemon=True)
                        _exports[bid]['thread'] = t
                        t.start()
                    self.copyfile(self.reply(b'{}', 'application/json'), self.wfile)
                    return
                m = re.match(r'^/library/([0-9a-f]{12})/(opened|remove|notes)$', url.path)
                if not m:
                    self.send_error(404, 'Not found')
                    return
                if m.group(2) == 'notes':  # highlights: kept next to the book, written whole each time
                    data = json.loads(self.rfile.read(size) or b'[]')
                    if not isinstance(data, list):
                        raise ValueError('notes must be a list')
                    os.makedirs(os.path.join(LIB, '.notes'), exist_ok=True)
                    tmp = os.path.join(LIB, '.notes', m.group(1) + '.json.tmp')
                    with open(tmp, 'w', encoding='utf-8') as f:
                        json.dump(data, f, ensure_ascii=False)
                    os.replace(tmp, os.path.join(LIB, '.notes', m.group(1) + '.json'))
                    self.copyfile(self.reply(b'{}', 'application/json'), self.wfile)
                    return
                with _lib:
                    idx = lib_index()
                    b = idx.get(m.group(1))
                    if b and m.group(2) == 'opened':
                        b['opened'] = time.time()
                    elif b:  # to the Trash, never deleted outright
                        trash = os.path.expanduser('~/.Trash')
                        dest = os.path.join(trash, b['file'])
                        if os.path.exists(dest):
                            dest = os.path.join(trash, f"{b['file'][:-4]} {int(time.time())}.pdf")
                        shutil.move(os.path.join(LIB, b['file']), dest)
                        del idx[m.group(1)]
                    lib_save(idx)
                body = b'{}'
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
