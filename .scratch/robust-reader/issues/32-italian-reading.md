# 32. Italian reading: a second Italian voice, and Italian text read in Italian

Status: done in code, Node tests and Python tests. Not yet heard in Chrome; the voice server must restart to offer Nicola.
Type: AFK

## The owner's request

"I need also Italian voices. An Italian reading." He reads Italian web pages, PDFs and books with this tool.

## Cause found

- The voice server had one Italian natural voice, Sara (`if_sara`). Kokoro has a second one, Nicola (`im_nicola`). It was not in the list.
- The web player knew an Italian page only by `<html lang="it">`. Many pages have no lang, or a wrong one from a template ("en" on an Italian page). Such a page was read by an English voice. An English page with Sara chosen was read by Sara, who reads English badly.
- The reader had no language check at all. An Italian Book was read by the chosen English voice.
- The Speech rewrite (`extension/pdf/speech.js`, not `lexicon.js`) is English only. An Italian Book read by Sara would get English words: "1996" became "nineteen ninety-six", "1.5 mm" became "one point five millimetres", "Classe II" became "Classe two", and capitals such as "OMS" or "DOPO" were spelled letter by letter, because the check asks an English word list.
- When the voice server did not answer, the reader fell to the first English Mac voice, and the web player to Samantha, also for Italian text.

## Decisions

- The language check is a small count of common short words: Italian words ("il", "della", "che", "è", ...) against English words ("the", "of", "which", ...). Words that both languages use ("in", "a", "come", "per") do not count. It gives 'it', 'en', or '' when it is not sure (fewer than 4 hits, or no clear lead of 2 to 1).
- `chrome.i18n.detectLanguage` is not used: the reader also runs as a plain page served from the voice server (`http://localhost:8793`), where the chrome API is not there.
- The voice rule is one rule for the web player and the reader. Italian text with an English natural voice: Sara. Italian text with Nicola chosen: Nicola. English text with an Italian voice: Heart. A text of unknown language: the chosen voice. Russian stays as before (the Mac voice Milena).
- For an Italian Book, numbers pass through as digits. The Italian voice (espeak-ng inside Kokoro) says Italian digits right by itself, so a new Italian number rewrite is not needed. Only a unit and a few signs are said in Italian words.

## What changed

- `voice-server.py`: Nicola, "Nicola, Italian male", language code 'i', in `VOICES`. The warm-up loads him with the other voices. The voice sampler and the add-on popup take the list from the server, so they show him too.
- `extension/pdf/language.js` (new): `textLanguage(text)`, `isItalianVoice(id)` and `voiceForLanguage(voice, lang)`. Pure functions.
- `extension/content.js` (web player): a copy of `textLanguage()` (content.js cannot import; a test keeps the copies equal). A page is Italian when lang says it, or when the text of the reading is clearly Italian. It is English when the text is clearly English, or when lang says English and the text does not say Italian. The language is counted once for each reading, from the Sentences already collected, so no new page scan or layout read is made. Italian with an English voice goes to Sara, a chosen Nicola stays, English with an Italian voice goes to Heart. The Mac voice for an Italian page is Alice, for other pages Samantha. `im_nicola` is in the list of known voices.
- `extension/pdf/extract.js`: `buildDocument` learns the language of the Book from the start of each sample page (the same pages that it reads for the running heads), and gives it to each paragraph's Speech rewrite. The builder keeps it as `lang`. An option `lang` can set it.
- `extension/pdf/speech.js`: `normalizeForSpeech(chars, owners, lang)`. For 'it' it uses the Italian rules. Gated off for Italian (English only): years, number ranges ("fifty to sixty"), decimals ("one point five"), English unit words, "Class II" numerals, "about" for "~", "to the power of" for "^", and the spelling of capitals (it asks an English word list). Kept for Italian: "~" before a number is "circa", "10^3" is "10 alla 3", other ~ ^ | are a pause, pH is "P H". New for Italian: "1,5 mm" is "1,5 millimetri", "1 mm" is "1 millimetro" (also cm, µm, ml, kg, Hz). An English or unknown text keeps the English rules unchanged.
- Ligature repair and the Skip settings are unchanged and work as before. They run before the Speech rewrite.
- `extension/pdf/tts.js`: the Mac voice list of the reader shows the best 6 English voices and then the best 2 Italian voices (Alice on a Mac). `SystemEngine.voiceOf(lang)` gives the first voice of a language. When the voice server does not answer, a Sentence asked for an Italian natural voice is read by an Italian Mac voice. The syllable count of the estimated Word timing counts accented vowels ("perché", "più").
- `extension/pdf/app.js`: `readingVoice()` gives the voice that reads, by the language of the Book. Every voice request uses it: the Sentence, the Read-ahead, the preview of a Book sentence, the audio export, and the answers of Ask Claude (an answer in Italian is read by an Italian voice). The settings button names the voice that really reads. A line under the voice list says why, for example "This book is in Italian, so Sara reads it." With the Mac voice chosen, a Mac voice of the wrong language goes to the first Mac voice of the Book's language.
- `extension/pdf/index.html`: the line `voiceHint`, with the existing `status` class.

## Word timing for Italian

The voice server gives no Word timing for Italian (`/times` answers an empty list). The reader then uses its estimate from the length of the sound and the syllables of each word, so the Word highlight moves and the reading goes on. The web player moves the highlight by how far the sound has played, as before. Both are tested in their old tests; the new syllable count only adds accented vowels.

## Tests

- `tests/node/italian-reading.test.mjs` (new, 23 tests): the language check on Italian, English, short, mixed and German text; the copy in content.js is the same function; the voice rule; the Italian Speech rewrite (numbers pass through, units in Italian, capitals not spelled, signs); English unchanged; the language of a made Book in `buildDocument`; the reader app with an Italian Book (Sara reads, the settings name Sara and say why, a chosen Nicola reads with no line); the Mac voice fallback (Sara and Nicola to Alice, Heart to Samantha); the Mac voice list with Italian voices; the web player with no lang, a wrong lang, lang="it", an English page with an Italian voice, an unknown page, Russian, and the Mac voice; Nicola in the server and in the known voices.
- `tests/test_server.py`: one new test, both Italian voices are offered.
- Five test harnesses that load app.js with fake modules now also give it `language.js`.
- Totals: Node 563 tests, 563 pass, 0 fail. Python 48 tests, OK.

## What is not checked

- No sound was heard. The live voice server still runs the old code: it must restart to offer Nicola. Nicola's voice file is already in the model cache on this Mac.
- That espeak-ng says Italian digits, "1,5" and "50-60" well was not heard; the rule follows what the Italian phonemizer is made to do. "Classe II" is left as printed; how the Italian voice says Roman numerals was not heard.
- An Italian Book with English quotes is read all in Italian; a mixed page of a web site goes by most of its text.
- The add-on was not loaded in Chrome. A check for the owner: reload the add-on, restart the voice server, open an Italian page with no lang, and open an Italian PDF.
