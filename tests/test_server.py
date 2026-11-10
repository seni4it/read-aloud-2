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

    def test_reader_page_icon_is_served(self):
        # Chrome check 10 Nov 2026 (FAIL 4): the reader links its icon as ../icons/48.png (the add-on folder icons/).
        # Under /reader/ that is /icons/48.png, which gave 404 on every load.
        code, h, body = get('/icons/48.png')
        self.assertEqual(code, 200)
        self.assertEqual(h['Content-Type'], 'image/png')
        with open(os.path.join(HERE, 'extension', 'icons', '48.png'), 'rb') as f:
            self.assertEqual(body, f.read())
        self.assertEqual(get('/icons/../../voice-server.py')[0], 404)
        self.assertEqual(get('/icons/%2e%2e/manifest.json')[0], 404)

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

    def test_notes_save_with_an_old_number_is_refused(self):
        # two tabs read the same Book (number 0); the first save wins, the second tab's save is old and is refused
        bid = self.add('Twotabs.pdf', PDF + b'twotabs')
        code, h, _ = get(f'/library/{bid}/notes')
        self.assertEqual(h['X-Notes-Rev'], '0')
        first = [{'id': 'a', 'text': 'first tab'}]
        code, h, body = get(f'/library/{bid}/notes?base=0', self.origin, 'POST', json.dumps(first).encode())
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body), {'rev': 1})
        code, _, body = get(f'/library/{bid}/notes?base=0', self.origin, 'POST', json.dumps([{'id': 'b'}]).encode())
        self.assertEqual(code, 409)
        self.assertEqual(json.loads(body), {'rev': 1})
        code, h, body = get(f'/library/{bid}/notes')
        self.assertEqual((json.loads(body), h['X-Notes-Rev']), (first, '1'))
        # the save with the present number goes, and the number goes up
        self.assertEqual(get(f'/library/{bid}/notes?base=1', self.origin, 'POST', b'[]')[0], 200)
        self.assertEqual(get(f'/library/{bid}/notes')[1]['X-Notes-Rev'], '2')

    def test_notes_save_without_a_number_still_goes_and_counts(self):
        bid = self.add('Nonumber.pdf', PDF + b'nonumber')
        self.assertEqual(get(f'/library/{bid}/notes', self.origin, 'POST', b'[]')[0], 200)
        self.assertEqual(get(f'/library/{bid}/notes')[1]['X-Notes-Rev'], '1')
        self.assertEqual(get(f'/library/{bid}/notes?base=x', self.origin, 'POST', b'[]')[0], 400)

    def test_notes_bad_number_file_refuses_every_old_number(self):
        # a damaged .rev file never goes back to 0: it gets a new number above every number a tab can hold
        bid = self.add('Badrev.pdf', PDF + b'badrev')
        self.assertEqual(get(f'/library/{bid}/notes?base=0', self.origin, 'POST', b'[{"id": "a"}]')[0], 200)
        rev = os.path.join(TMP, '.notes', bid + '.rev')
        for damage in ('', 'not a number'):
            with open(rev, 'w') as f:
                f.write(damage)
            n = get(f'/library/{bid}/notes')[1]['X-Notes-Rev']
            self.assertGreater(int(n), 1, 'not 0 and not the old number')
            self.assertEqual(get(f'/library/{bid}/notes')[1]['X-Notes-Rev'], n, 'the new number is kept')
            self.assertEqual(get(f'/library/{bid}/notes?base=1', self.origin, 'POST', b'[]')[0], 409)
            self.assertEqual(get(f'/library/{bid}/notes?base={n}', self.origin, 'POST', b'[]')[0], 200)
        self.assertFalse(os.path.exists(rev + '.tmp'), 'the number is written to a temporary file, then moved')

    def test_notes_saves_from_many_threads_each_get_their_own_number(self):
        bid = self.add('Threads.pdf', PDF + b'threads')
        codes = []
        def save():
            codes.append(get(f'/library/{bid}/notes?base=0', self.origin, 'POST', b'[]')[0])
        ts = [threading.Thread(target=save) for _ in range(8)]
        for t in ts: t.start()
        for t in ts: t.join()
        self.assertEqual(sorted(codes), [200] + [409] * 7, 'one save with number 0 wins')
        self.assertEqual(get(f'/library/{bid}/notes')[1]['X-Notes-Rev'], '1')

    def test_notes_number_header_is_exposed_to_other_origins(self):
        bid = self.add('Expose.pdf', PDF + b'expose')
        h = get(f'/library/{bid}/notes', {'Origin': 'chrome-extension://abc'})[1]
        self.assertIn('X-Notes-Rev', h.get('Access-Control-Expose-Headers') or '')

    # ---- ticket 27: the Reading position of a Book ----
    # The reader sends {i, total, page, pages, minLeft, at, t}; t is its own clock. The voice server keeps t as "ct"
    # (never later than its own clock) and puts its own receipt time in "t".
    def pos(self, bid, body, origin=None):
        code, _, out = get(f'/library/{bid}/position', origin or self.origin, 'POST', body if isinstance(body, bytes) else json.dumps(body).encode())
        return code, (json.loads(out) if code == 200 else None)

    def test_position_round_trip(self):
        bid = self.add('Pos.pdf', PDF + b'pos')
        code, _, body = get(f'/library/{bid}/position')
        self.assertEqual((code, json.loads(body)), (200, None), 'no Reading position before the first save')
        rec = {'i': 120, 'total': 2400, 'page': 12, 'pages': 240, 'minLeft': 95.5, 'at': 'first words'}
        before = int(vs.time.time() * 1000)
        code, kept = self.pos(bid, {**rec, 't': 1000, 'extra': 'x'})
        self.assertEqual(code, 200)
        self.assertEqual({k: kept[k] for k in rec}, rec)
        self.assertNotIn('extra', kept, 'unknown keys are dropped')
        self.assertEqual(kept['ct'], 1000, 'the reader time is kept as ct')
        self.assertGreaterEqual(kept['t'], before, 't is the voice server time of the save')
        self.assertEqual(json.loads(get(f'/library/{bid}/position')[2]), kept)

    def test_position_without_time_gets_the_server_time(self):
        bid = self.add('PosT.pdf', PDF + b'post')
        code, kept = self.pos(bid, b'{"i": 3}')
        self.assertEqual(code, 200)
        self.assertGreater(kept['t'], 1.7e12)
        self.assertEqual(kept['ct'], kept['t'])

    def test_position_bad_id(self):
        self.assertEqual(get('/library/xyz/position')[0], 404)
        self.assertEqual(get('/library/0123456789ab0/position', self.origin, 'POST', b'{"i": 1}')[0], 404)
        self.assertEqual(get('/library/..%2f..%2fx/position')[0], 404)

    def test_position_bad_body(self):
        bid = self.add('PosBad.pdf', PDF + b'posbad')
        for body in (b'not json', b'[]', b'null', b'{}', b'{"i": -1}', b'{"i": "3"}', b'{"i": 1.5}', b'{"i": true}',
                     b'{"i": 1, "page": -2}', b'{"i": 1, "minLeft": "x"}', b'{"i": 1, "at": 5}',
                     json.dumps({'i': 1, 'at': 'x' * 201}).encode()):
            self.assertEqual(self.pos(bid, body)[0], 400, body)
        self.assertEqual(self.pos(bid, b'{"i": 1, "at": "' + b'x' * 5000 + b'"}')[0], 413)
        self.assertEqual(json.loads(get(f'/library/{bid}/position')[2]), None, 'nothing was kept')

    def test_position_infinity_and_nan_are_refused(self):
        # json.loads reads Infinity, -Infinity and NaN; kept, they would make /library.json invalid JSON
        bid = self.add('PosInf.pdf', PDF + b'posinf')
        for body in (b'{"i": 1, "minLeft": Infinity}', b'{"i": 1, "minLeft": -Infinity}', b'{"i": 1, "minLeft": NaN}',
                     b'{"i": 1, "t": Infinity}', b'{"i": 1, "total": NaN}', b'{"i": Infinity}'):
            self.assertEqual(self.pos(bid, body)[0], 400, body)
        self.assertEqual(json.loads(get(f'/library/{bid}/position')[2]), None)
        with open(os.path.join(TMP, '.notes', bid + '.position.json'), 'w') as f:
            f.write('{"i": 1, "minLeft": Infinity}')   # a file written by hand or by an old version
        self.assertIsNone(json.loads(get(f'/library/{bid}/position')[2]), 'a file with Infinity is no position')
        def strict(c):
            raise ValueError('not strict JSON: ' + c)
        books = json.loads(get('/library.json')[2], parse_constant=strict)   # strict JSON: raises on Infinity and NaN
        self.assertIsNone({x['id']: x for x in books}[bid]['position'])

    def test_position_from_another_site_is_refused(self):
        bid = self.add('PosSite.pdf', PDF + b'possite')
        self.assertEqual(self.pos(bid, b'{"i": 1}', {'Origin': 'https://example.com'})[0], 403)
        self.assertEqual(self.pos(bid, b'{"i": 1}', {'Origin': 'chrome-extension://abc'})[0], 200)

    def test_position_bad_content_length_is_a_400(self):
        bid = self.add('PosLen.pdf', PDF + b'poslen')
        for length in ('-1', 'abc', '1e3', ''):
            with socket.create_connection(('127.0.0.1', PORT), timeout=5) as s:
                s.sendall((f'POST /library/{bid}/position HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nOrigin: {BASE}\r\n'
                           f'Content-Length: {length}\r\nConnection: close\r\n\r\n{{"i": 1}}').encode())
                head = s.recv(200).decode('latin-1')
            self.assertTrue(head.startswith('HTTP/1.0 400') or head.startswith('HTTP/1.1 400'), (length, head[:40]))
        self.assertIsNone(json.loads(get(f'/library/{bid}/position')[2]))

    def test_position_is_written_whole(self):
        bid = self.add('PosFile.pdf', PDF + b'posfile')
        orig = vs.os.replace
        moves = []
        vs.os.replace = lambda a, b: (moves.append((a, b)), orig(a, b))
        try:
            self.assertEqual(self.pos(bid, b'{"i": 7, "t": 5}')[0], 200)
        finally:
            vs.os.replace = orig
        path = os.path.join(TMP, '.notes', bid + '.position.json')
        self.assertIn((path + '.tmp', path), moves, 'a temporary file, then a move over the old one')
        self.assertFalse(os.path.exists(path + '.tmp'))
        with open(path) as f:
            self.assertEqual(json.load(f)['i'], 7)

    def test_position_older_save_is_not_written_and_the_answer_is_the_kept_record(self):
        bid = self.add('PosOld.pdf', PDF + b'posold')
        _, first = self.pos(bid, {'i': 50, 't': 2000})
        code, kept = self.pos(bid, {'i': 10, 't': 1000})
        self.assertEqual(code, 200)
        self.assertEqual(kept, first, 'a late save of an old place does not go back; the answer is the kept record')
        self.assertEqual(json.loads(get(f'/library/{bid}/position')[2])['i'], 50)
        self.pos(bid, {'i': 10, 't': 3000})
        self.assertEqual(json.loads(get(f'/library/{bid}/position')[2])['i'], 10, 'a newer save goes back when the owner went back')

    def test_position_far_future_time_does_not_lock_later_saves(self):
        bid = self.add('PosFuture.pdf', PDF + b'posfuture')
        code, kept = self.pos(bid, {'i': 99, 't': 9e12})
        self.assertEqual(code, 200)
        self.assertLessEqual(kept['ct'], vs.time.time() * 1000, 'a reader time in the future is kept as the voice server time')
        code, kept = self.pos(bid, {'i': 5, 't': int(vs.time.time() * 1000) + 1})
        self.assertEqual(kept['i'], 5, 'the next true save is written')

    def test_library_list_gives_the_position(self):
        a = self.add('ListPosA.pdf', PDF + b'listposa')
        b = self.add('ListPosB.pdf', PDF + b'listposb')
        _, kept = self.pos(a, {'i': 4, 'page': 2, 'pages': 9, 't': 10})
        books = {x['id']: x for x in json.loads(get('/library.json')[2])}
        self.assertEqual(books[a]['position'], kept)
        self.assertIsNone(books[b]['position'])
        with open(os.path.join(TMP, '.notes', b + '.position.json'), 'w') as f:
            f.write('{damaged')
        self.assertIsNone({x['id']: x for x in json.loads(get('/library.json')[2])}[b]['position'], 'a damaged file is no position')

    def test_bad_speak_request_is_a_400_not_a_crash(self):
        self.assertEqual(get('/speak?text=&voice=af_heart')[0], 400)
        self.assertEqual(get('/speak?text=hi&voice=nobody')[0], 400)


if __name__ == '__main__':
    unittest.main()
