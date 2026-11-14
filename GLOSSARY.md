# Read Aloud 2

Read Aloud 2 reads web pages, PDFs and books aloud on one Mac, with a natural voice, and shows the word that is read. This file gives one name to each thing in the project.

## Language

### The parts

**Add-on**:
The Chrome extension that reads the page the owner is on.
_Avoid_: plugin, extension (in text for the owner)

**Voice server**:
The program on this Mac that makes speech from text. It also keeps the library.
_Avoid_: helper, backend, daemon

**Reader**:
The page that shows a PDF and reads it. The add-on and the desktop app use the same reader.
_Avoid_: viewer, PDF viewer, Paper Reader

**Desktop app**:
The Mac application "Read Aloud" that opens the library in its own window.
_Avoid_: launcher, Mac app, desktop reader

**Voice sampler**:
The page where the owner hears each voice and chooses one.

**Chat reader**:
The page that reads the Claude chats aloud. It is a separate program from the add-on.
_Avoid_: version 1, Read Aloud 1

**Report**:
The file where the add-on writes what it did: one line for each Sentence that it read and for each fault.
_Avoid_: log, error log, error report

### Voices and speech

**Natural voice**:
A voice that the voice server makes with the speech model.
_Avoid_: Kokoro voice, neural voice, AI voice

**Mac voice**:
A voice that is built into the Mac.
_Avoid_: system voice, fallback voice

**Sentence**:
The unit that is sent to a voice as one piece and played as one piece.
_Avoid_: chunk, utterance, segment

**Word timing**:
The start time of each word in the sound of one sentence.
_Avoid_: alignment, timestamps

**Read-ahead**:
The making of the next sentences while the present sentence plays, so that no silence comes between sentences.
_Avoid_: prefetch, preload, buffer

**Speed method**:
The way a natural voice gets faster or slower. The owner chooses it in the settings.
_Avoid_: speed mode, time stretch, tempo

**Speech rewrite**:
The change of printed text into text that a voice says correctly, for example a year, a unit or a Roman numeral.
_Avoid_: normalisation, expansion

### Listening

**Listen button**:
The round button on the edge of a page that starts the reading.

**Player bar**:
The bar with previous sentence, play or pause, next sentence, speed and voice.
_Avoid_: toolbar, controls, mini player

**Word highlight**:
The mark on the word that is read now. Its sentence has a light shade.
_Avoid_: cursor, karaoke

**Follow**:
The page moves with the voice, so that the word that is read stays in view.
_Avoid_: auto-scroll, tracking

**Skip setting**:
A switch that leaves one kind of text out of the reading, for example citations or tables.
_Avoid_: filter

### Documents

**Library**:
The books that the desktop app shows.
_Avoid_: bookshelf, collection

**Book**:
One PDF in the library, with its cover, its reading position, its highlights and its conversation.
_Avoid_: document, file, paper (for a library item)

**Reading position**:
The sentence where the owner stopped in a book.
_Avoid_: progress, bookmark

**Scanned page**:
A PDF page that is only a picture and has no text.
_Avoid_: image page, OCR page

**Audio export**:
The making of MP3 files from a book, one for each chapter.
_Avoid_: download, render

### Notes and questions

**Highlight**:
A piece of text in the reader that the owner kept, in one group.
_Avoid_: note, annotation, marker (see _Word highlight_ for the reading mark)

**Group**:
A named set of highlights. Each group has its own colour.
_Avoid_: category, tag, colour

**Key point**:
A highlight that is also copied to a folder outside the book, for other work with Claude.

**Ask Claude**:
The feature that answers the owner's questions about a book.
_Avoid_: chat, assistant

**Conversation**:
The questions and answers of one book.
_Avoid_: thread, session, chat history

**Hostile check**:
A second, separate examination that tries to prove an answer wrong against the book.
_Avoid_: verification, fact check, review
