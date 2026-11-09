# Spec: a robust, fast and precise Read Aloud 2

Status: ready-for-agent
Date: 9 Nov 2026
GitHub issue: #1
Words: see `GLOSSARY.md`. Evidence: the three audit files in `audit/`.

## Problem Statement

The owner listens to web pages, PDFs and books for many hours. Read Aloud 2 works, but it has faults that he meets in daily use:

- The reading stops and does not start again (a drag of the seek bar, one failed sentence, a voice server that does not answer).
- The reading starts a paragraph again when he changes the speed or the voice.
- Words and lines are lost or said wrongly in PDFs (lines that start with a number, non-Latin text, "37°C", "5 μm", words cut at a line end, "et al.").
- The reader and the voice server use more memory than necessary (page pictures that stay, a scanned book that reads all its pages at once, a sound cache with no limit).
- Web pages become slow, because the add-on works on each page before he presses play.
- Some controls are small, have low contrast, or have no keyboard focus mark. In dark mode the word highlight almost disappears.
- The project has no tests for the browser code, so each fix can break another part.

## Solution

Make the present features correct, lighter and easier to see. Add no new feature. Give all screens one design that follows the `key-design` rules (see Design Direction). Give the project a test bench first, then repair one area at a time, each with its tests. The areas are: the voice server, the reader transport, the reader page drawing, the voice requests, the highlights, the reader look, the PDF text, the scanned pages, the web-page reading, the add-on background, the library page, the small add-on pages, and the design of all screens.

## User Stories

1. As a listener, I want the reading to go on after I drag the seek bar, so that I do not press play again.
2. As a listener, I want a change of speed or voice to continue from the present word, so that I do not hear the paragraph twice.
3. As a listener, I want the Preview button to work each time, so that I can compare voices.
4. As a listener, I want one failed sentence to be tried again, so that the book does not stop.
5. As a listener, I want a clear message when the voice server does not answer, so that I know what to do.
6. As a listener, I want the sentence that I ask for to come before the read-ahead, so that a jump starts fast.
7. As a listener with wireless earphones, I want the word highlight to move with the sound, so that I can follow the text.
8. As a listener, I want a faster speed to keep the pitch of the voice, so that fast reading sounds natural.
9. As a reader, I want the sentence mark to stay after a zoom or a window resize, so that I do not lose my place.
10. As a reader of long books, I want the reader to release pages that I do not see, so that the Mac stays fast.
11. As a reader, I want a second PDF to open clean, so that I never see the marks of the first PDF.
12. As a reader, I want a message when a file cannot open, so that I do not look at an empty page.
13. As a reader, I want one damaged page to be passed, so that I can read the other pages of the book.
14. As a reader, I want every body line to be read, also a line that starts or ends with a number, so that no data is lost.
15. As a reader of non-English text, I want Cyrillic, Hebrew, Greek and money signs to stay in the text, so that the voice can read them.
16. As a dentist, I want units and signs said correctly ("37 degrees C", "5 micrometres"), so that clinical values are right.
17. As a reader, I want a word that is cut at a line end to be joined, and a real compound to keep its hyphen.
18. As a reader, I want every damaged ligature word to be repaired, not only each second one.
19. As a reader, I want a drop cap or a small note mark not to change how a line is read.
20. As a reader of rotated pages, I want the lines in their correct sequence.
21. As a reader of scanned books, I want only the next 2 pages to be read ahead, so that a 300-page scan does not stop the tab.
22. As a reader of scanned books, I want a time limit on text recognition, so that the book does not wait without end.
23. As a web listener, I want "Smith et al. reported" to stay one sentence.
24. As a web listener, I want a long address or code with no spaces not to be read letter by letter.
25. As a web listener, I want lines divided by line breaks to be read as separate words.
26. As a web listener, I want "Listen" on a selection to read each selected text, also in a side box or a code block.
27. As a web listener, I want a page with a cookie class on its body to be read.
28. As a web listener, I want the page not to jump up when the site replaces its content.
29. As a web listener, I want Follow to work on sites that scroll inside a box.
30. As a web listener, I want the player to stay on the screen on each site.
31. As a web listener, I want to type in a form while I listen, and Follow to stay on.
32. As a browser user, I want the add-on to do almost no work on a page before I ask it to read, so that pages stay fast.
33. As a browser user, I want no errors from old tabs after the add-on updates itself.
34. As a browser user, I want the add-on not to reload itself while a reader tab is open.
35. As a listener with two tabs, I want the tab that I stopped not to take the voice back.
36. As a library user, I want search to be fast and not to send a request for each book on each key.
37. As a library user, I want a clear message when an add, an import or a restart fails.
38. As a keyboard user, I want a focus mark on every control and a way to mark a sentence with the keyboard.
39. As a user, I want every control to be at least 32 px high and every text to have enough contrast.
40. As a dark-mode user, I want to see the word highlight and my saved highlights on the page.
41. As a user of a narrow window, I want the Ask pane not to press the page to an unreadable width.
42. As a note taker, I want a click on a saved highlight to open its menu and not to start the reading.
43. As a note taker, I want two fast changes to be saved in the correct sequence.
44. As the owner, I want the voice server to keep its memory bounded and to keep its log small.
45. As the owner, I want the same PDF added twice to be one book.
46. As the owner, I want big books and the reader files to load from the browser cache.
47. As a developer, I want one command that runs all tests, so that each fix is checked.
48. As a developer, I want a check that compares the read text of sample PDFs before and after a change, so that a text fix does not make another book worse.
49. As the owner, I want one look on the reader, the library, the add-on window and the web-page player, so that the four screens feel like one tool.
50. As the owner, I want each screen to show one main action, so that I know where to press.
51. As the owner, I want the player bar on one row at each window width, so that no control drops to a second row.
52. As the owner, I want voice, speed and skip settings in one settings panel, so that the page and the contents list have more room.
53. As the owner, I want the library to open on the book that I read last, with one button that continues it.
54. As the owner, I want a book card to show a clean title and how much is left, not a file name.
55. As the owner, I want the play button to show that the voice is being made, so that a wait of some seconds is not a mystery.
56. As the owner, I want each icon button to show its name and its key after a short hover.

## Design Direction

The owner's instruction of 9 Nov 2026: think bigger and use the `key-design` rules. The design work is one programme, not a list of small repairs. Rule numbers are the sub-chapters of `book/QUICK_RULES.md` in the `key-design` skill. That skill is a private reference: apply its rules, copy none of its content.

What the screens show today (looked at on 9 Nov 2026, window of 1024 px):

- Reader player bar: 13 controls, and the speed control drops to a second row. Rule 1.1 asks for one main focus and 3 to 5 choices.
- Reader top bar: "Open PDF" is the filled button, but the main action of the screen is Play. Rules 4.1 and 6.1: the brand colour and the filled style go only to the main action.
- Reader side bar: 7 skip settings and 2 buttons stay open below the contents list and take half of its height. An orange strip shows numbers for developers.
- Library: 5 controls in the top bar, of which 2 are maintenance. The cards show file names that are cut. No part of the page says "continue where you stopped".
- Colours: three style files each have their own colour names and many colour values written in place. Rule 4.4 asks for one set of tokens in three layers.
- Text sizes: 12, 13, 13.5, 14, 15, 16, 17, 18, 20 and 26 px are all in use. Rule 3.3 asks for one scale.

The direction:

1. One token file for all screens: primitive colours, semantic colours with a light and a dark mode, a type scale (12, 14, 16, 20, 28 px with line heights in multiples of 4 px), a spacing scale in steps of 4 and 8 px, two corner radii. Rules 2.1, 2.2, 3.2, 3.3, 4.1, 4.3, 4.4, 4.5.
2. Orange is only the play button, the word highlight and the progress. All other controls are neutral. Rule 4.1.
3. The player bar is the same component on the reader and on web pages: previous, play, next, position, time left, speed, and one settings button. One row at each width from 360 px. Rules 1.1, 6.1, 6.3, 6.4, 5.2.
4. Voice, engine, voice preview and the skip settings move to one settings panel that opens from the player bar. Rules 1.1, 7.4, 9.1.
5. The library opens on a "Continue listening" block for the last book, then the grid. Maintenance actions move to one "More" menu. Rules 1.1, 6.2, 7.1, 7.3, 7.8.
6. Each control has the six states of rule 6.4, and each icon button has a tooltip with its key after 500 ms. Hover feedback comes within 100 ms. Motion stops when the system asks for reduced motion. Rules 6.4, 10.1, 10.5.
7. Each empty state and each wait has its own message and one action. Rules 5.5, 10.5.

## Implementation Decisions

- No new feature. The navy and orange identity stays, but the layout and the styles of all screens are redone to the Design Direction above. No function is removed: a control that leaves a bar moves to a panel or a menu.
- All colour, size, space and radius values live in one token file. A style file outside it holds no colour value. If two copies of the token file must exist (the add-on package and the pages that the voice server serves), a test fails when they differ.
- The voice server stays one program with the Python standard library and the voice model that is installed. Its cache has a limit in bytes and in entries. It serves static files and books with validation headers and byte ranges. It stops work for a listener that closed the connection.
- Speed without pitch change: the voice model makes the sound at the asked speed, and the browser plays it at rate 1. The speed becomes a part of the cache key on both sides. If the sound quality at a speed is worse than today, that speed keeps the present method. The owner listens before this becomes the default.
- Each request to the voice server from a page has a time limit. A request for a sentence that is no longer wanted is cancelled. A wanted sentence is never served as read-ahead.
- The reader keeps at most the pictures of the pages near the screen. A page render that is no longer wanted is cancelled.
- The PDF text rules that remove furniture (running heads, copyright blocks, contents pages) act only on small or separated type, never on body-size lines alone.
- The filter for characters keeps every character that has a meaning in Unicode. It removes only private-use, unassigned and control characters.
- The web-page reader does no page scan before the first sign that the owner wants to listen (pointer on the listen button, selection, or play). Its player lives on the root element of the page.
- The add-on decides "a reader is open" by asking the browser, not by a counter in memory.
- Tests: the server tests use the Python standard library. The browser logic tests use the test runner that comes with Node, with no package install. Code that has logic worth a test is moved to a module that the page and the test both load.
- A version number change is done one time, by the coordinator, at the end of the ticket run.
- Reuse rule: before a ticket builds a helper, it checks for a maintained library. No candidate is known now: each fix is a small change in present code.

## Testing Decisions

- A good test checks what the owner sees or hears (sentences, word sequence, reply codes, state of play), not how the code does it.
- Server: tests start the server on a free port with a temporary library and no voice model. Prior art: the server test file that this work added.
- PDF text: a comparison check on sample PDFs. It writes the sentences of each sample before and after a change and shows the difference. Prior art: the commit messages "checked against three books, old and new". A change is accepted when no sample reads worse.
- Sentence cutting, speech rewrite, ligature repair, word timing schedule: unit tests with Node.
- Reader transport, drawing, look, web-page player: checked in the test window of the project with the built-in browser, with a written list of steps in the ticket. Screenshots for each design ticket, in light and dark mode, at 1280, 1024 and 400 px. A Node test checks the contrast of each text and background token pair (4.5 to 1 or more) and that no style file outside the token file holds a colour value.
- The model is not loaded in automatic tests. One manual check with the real voice comes after the server restart.

## Out of Scope

- New features (EPUB, Word, Google Docs, new voices, cloud voices).
- The older Read Aloud version 1 chat reader.
- The vendored PDF library.
- The Chrome Web Store package and the YouTube upload.
- A new brand (name, logo, colours other than navy and orange).
- A reflowed reading view of a PDF (a new feature; a later spec can add it).

## Further Notes

- The owner listens with this tool all day. A restart of the voice server and a reload of the add-on stop his reading for some seconds: do them only at an agreed time.
- The repository is public. No patient data and no private path of a book goes into an issue, a test file or a commit.
- Reference speed and memory before the work (9 Nov 2026, test copy of the server): first sentence 3.96 s after start, cached sentence 0.06 s, the test copy used 903 MB of memory after its first sentences, and the live server showed 160 MB.
