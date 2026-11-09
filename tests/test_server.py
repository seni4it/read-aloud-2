"""Tests of the voice server without the voice model: the library, the cache, files and errors.
Run:  ~/.local/share/uv/tools/mlx-audio/bin/python -m unittest discover -s tests -v
"""
import functools, importlib.util, json, os, socket, sys, tempfile, threading, unittest, urllib.error, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP = tempfile.mkdtemp(prefix='read-aloud-test-')
os.environ['READ_ALOUD_LIBRARY'] = TMP
with socket.socket() as s:
    s.bind(('127.0.0.1', 0))
    PORT = s.getsockname()[1]
sys.argv = ['voice-server.py', str(PORT)]
spec = importlib.util.spec_from_file_location('voice_server', os.path.join(HERE, 'voice-server.py'))
vs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(vs)
BASE = f'http://127.0.0.1:{PORT}'
PDF = b'%PDF-1.4\n' + bytes(range(256)) * 40


def get(path, headers=None, method='GET', data=None):
    req = urllib.request.Request(BASE + path, headers=headers or {}, method=method, data=data)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read()


class Tok:
    def __init__(self, text, start_ts):
        self.text, self.start_ts = text, start_ts


class Pure(unittest.TestCase):
    def test_word_starts_maps_tokens_to_words(self):
        toks = [Tok('Hello', 0.4), Tok(',', 0.7), Tok('big', 0.8), Tok('world', 1.2), Tok('.', 1.5)]
        self.assertEqual(vs.word_starts('Hello, big world.', toks, 0.3), [0.1, 0.5, 0.9])

    def test_word_starts_leaves_none_for_missing_tokens(self):
        self.assertEqual(vs.word_starts('one 23 three', [Tok('one', 0.0), Tok('three', 1.0)], 0.0), [0.0, None, 1.0])

    def test_trim_cuts_silence_and_reports_the_shift(self):
        import numpy as np
        audio = np.concatenate([np.zeros(7200), np.ones(2400) * 0.5, np.zeros(12000)]).astype(np.float32)
        out, shift = vs.trim(audio, 'Done.')
        self.assertAlmostEqual(shift, 0.27, places=2)
        self.assertAlmostEqual(len(out) / 24000, 0.03 + 0.1 + 0.18, places=2)
        self.assertEqual(vs.trim(np.zeros(100, dtype=np.float32), 'x')[1], 0.0)

    def test_cache_is_bounded_by_bytes_and_keeps_the_newest(self):
        old = vs.CACHE_BYTES
        vs.CACHE_BYTES = 1000
        try:
            for i in range(10):
                vs.cache_put(('v', str(i)), (b'x' * 300, []))
            self.assertLessEqual(vs._cache_size[0], 1000)
            self.assertIsNone(vs.cache_get(('v', '0')))
            self.assertIsNotNone(vs.cache_get(('v', '9')))
            vs.cache_put(('v', 'big'), (b'x' * 5000, []))  # one piece over the limit is still kept: it is being played
            self.assertIsNotNone(vs.cache_get(('v', 'big')))
            self.assertEqual(vs._cache_size[0], sum(len(v[0]) for v in vs._cache.values()))
        finally:
            vs.CACHE_BYTES = old
            vs._cache.clear(); vs._cache_size[0] = 0


class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = vs.Server(('127.0.0.1', PORT), functools.partial(vs.Handler, directory=HERE))
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.origin = {'Origin': BASE}

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def add(self, name='Book.pdf', data=PDF):
        code, _, body = get('/library/add?name=' + urllib.request.quote(name), self.origin, 'POST', data)
        self.assertEqual(code, 200, body)
        return json.loads(body)['id']

    def test_same_pdf_added_twice_is_one_book(self):
        a = self.add('Twice.pdf', PDF + b'twice')
        b = self.add('Twice.pdf', PDF + b'twice')
        self.assertEqual(a, b)
        books = [x for x in json.loads(get('/library.json')[2]) if x['name'].startswith('Twice')]
        self.assertEqual(len(books), 1)
        self.assertEqual([f for f in os.listdir(TMP) if f.startswith('Twice')], ['Twice.pdf'])

    def test_book_file_answers_byte_ranges(self):
        bid = self.add('Range.pdf', PDF + b'range')
        whole = PDF + b'range'
        code, h, body = get(f'/library/file/{bid}')
        self.assertEqual((code, body), (200, whole))
        self.assertEqual(h['Accept-Ranges'], 'bytes')
        code, h, body = get(f'/library/file/{bid}', {'Range': 'bytes=10-19'})
        self.assertEqual((code, body), (206, whole[10:20]))
        self.assertEqual(h['Content-Range'], f'bytes 10-19/{len(whole)}')
        self.assertEqual(get(f'/library/file/{bid}', {'Range': 'bytes=-5'})[2], whole[-5:])
        self.assertEqual(get(f'/library/file/{bid}', {'Range': f'bytes={len(whole) - 3}-'})[2], whole[-3:])
        self.assertEqual(get(f'/library/file/{bid}', {'Range': f'bytes={len(whole)}-'})[0], 416)

    def test_static_files_are_revalidated_not_downloaded_again(self):
        code, h, body = get('/reader/index.html')
        self.assertEqual(code, 200)
        self.assertEqual(h['Cache-Control'], 'no-cache')
        code, _, body = get('/reader/index.html', {'If-None-Match': h['ETag']})
        self.assertEqual((code, body), (304, b''))
        self.assertEqual(get('/voices')[1]['Cache-Control'], 'no-store')

    def test_static_cannot_leave_its_folder(self):
        self.assertEqual(get('/reader/../../voice-server.py')[0], 404)
        self.assertEqual(get('/reader/%2e%2e/%2e%2e/voice-server.py')[0], 404)
        self.assertEqual(get('/voice-server.py')[0], 404)

    def test_post_from_another_site_is_refused(self):
        self.assertEqual(get('/library/add?name=x.pdf', {'Origin': 'https://example.com'}, 'POST', PDF)[0], 403)
        self.assertEqual(get('/voices', {'Host': 'evil.example'})[0], 403)

    def test_error_with_non_latin_text_still_answers(self):
        # notes must be a list; the error text has Cyrillic and a new line in it
        orig = vs.json.loads
        def bad(*a, **k):
            raise ValueError('Книга\nне найдена')
        bid = self.add('Err.pdf', PDF + b'err')
        vs.json.loads = bad
        try:
            code, _, _ = get(f'/library/{bid}/notes', self.origin, 'POST', b'[]')
        finally:
            vs.json.loads = orig
        self.assertEqual(code, 500)

    def test_notes_round_trip(self):
        bid = self.add('Notes.pdf', PDF + b'notes')
        self.assertEqual(get(f'/library/{bid}/notes')[2], b'[]')
        notes = [{'id': 1, 'text': 'канал', 'page': 3}]
        self.assertEqual(get(f'/library/{bid}/notes', self.origin, 'POST', json.dumps(notes).encode())[0], 200)
        self.assertEqual(json.loads(get(f'/library/{bid}/notes')[2]), notes)

    def test_bad_speak_request_is_a_400_not_a_crash(self):
        self.assertEqual(get('/speak?text=&voice=af_heart')[0], 400)
        self.assertEqual(get('/speak?text=hi&voice=nobody')[0], 400)


if __name__ == '__main__':
    unittest.main()
