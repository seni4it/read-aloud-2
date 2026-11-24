# Glossary of Read Aloud 2: the pruning, round 1

I pruned the glossary after the new word "Report". It has 34 entries on 144 lines. With your yes to each card, it has 30 entries. Eleven decisions are below.

## What the checks found

- Five agents examined the glossary. They changed no file of the project.
- One agent wrote 12 instructions in your loose style. The glossary gave 1 clear action for 5 of them, 2 possible actions for 5, and a wrong action for 2.
- One agent read only the glossary and answered 15 questions about the project. It was sure of 11 answers and unsure of 4.
- One agent searched for words that the glossary tells us to avoid. I checked each finding.

## What I repaired already

These words were decided before, so they are not questions. All tests pass, and the repair is committed.

- The restart button said "helper" in 3 messages. Now it says "voice server".
- Comments and one label said "system voice". Now they say "Mac voice".
- The README and the empty list of highlights said "marker button". Now they say "highlight button".
- The heading of the voice sampler said "Natural voices (Kokoro)". Now it says "Natural voices".
- The entry Library used the word "collection", which its own line tells us to avoid. Now it says "The books that the desktop app shows."

## The 17 entries that stay as they are

- Add-on, Voice server, Reader, Voice sampler, Natural voice, Sentence, Word timing, Read-ahead, Speech rewrite.
- Listen button, Player bar, Word highlight, Book, Reading position, Audio export, Conversation, Hostile check.

## The other 17 entries

- 1 entry is repaired already: Library.
- 11 entries get a shorter text or a clearer text: cards 1 to 5.
- 5 entries go out: cards 6 and 7.

---

## Your decisions

### 1. Seven entries say only what the thing is

- Recommended: Yes for all 7. Write the name of an entry in the comment to take it out of this card.
- The principle: an entry says what the thing is. How it works, and a list that can change, stay in the README.
- Mac voice becomes: "A voice that is built into the Mac."
- Speed method becomes: "The way a natural voice gets faster or slower. The owner chooses it in the settings."
- Follow becomes: "The page moves with the voice, so that the word that is read stays in view."
- Skip setting becomes: "A switch that leaves one kind of text out of the reading, for example citations or tables."
- Scanned page becomes: "A PDF page that is only a picture and has no text."
- Ask Claude becomes: "The feature that answers the owner's questions about a book."
- Group becomes: "A named set of highlights. Each group has its own colour."

### 2. Report gets a clearer text

- Recommended: Yes.
- New text: "The file where the add-on writes what it did: one line for each Sentence that it read and for each fault."
- Words to avoid for it: log, error log, error report.
- I wrote the first text today. The agent that read only the glossary did not understand it.

### 3. Highlight says "text in the reader"

- Recommended: Yes.
- New text: "A piece of text in the reader that the owner kept, in one group."
- The old text said "book text". But a PDF that you open in Chrome also keeps highlights, and it is not a book of the library.

### 4. Key point gets a text that does not use the word "conversation"

- Recommended: Yes.
- New text: "A highlight that is also copied to a folder outside the book, for other work with Claude."
- In the glossary, Conversation means the questions and answers of one book. The old text of Key point used the same word for a chat of the Claude app. That gave 2 meanings to 1 word.

### 5. Desktop app: "desktop reader" becomes a word to avoid

- Recommended: Yes.
- The README has the heading "Desktop reader with a library". The glossary word is Desktop app.
- With your yes, the heading becomes "Desktop app with a library", and "desktop reader" goes on the avoid line.

### 6. Two entries that only the code uses go out

- Recommended: Yes for both. Write a name in the comment to keep that entry.
- Sound memory: 7 lines of code and 1 line of the docs use it. The code itself says "cache".
- Ligature repair: 7 lines of code and 1 line of the docs use it. It is one step of the PDF text code.
- The principle: a word that people do not say goes to the code and its comments.

### 7. Three more entries go out

- Recommended: Yes for all 3. Write a name in the comment to keep that entry.
- Chapter: it has its usual meaning, and the entry Audio export already says "one for each chapter".
- Book folder: the entry Book already names the text, the highlights and the conversation of a book. Only 3 lines of code use the word.
- Sources: it is 1 setting of Ask Claude, and its list of choices can change. It belongs in the README.

### 8. A new entry: Chat reader

- Recommended: Yes.
- New text: "The page that reads the Claude chats aloud. It is a separate program from the add-on."
- Words to avoid for it: version 1, Read Aloud 1.
- The word "reader" has 2 meanings in the project now: the Reader of PDFs, and the reader of your chats. Since today, the reader of the chats uses the voice server, so agents will meet both.

### 9. No new entry for the answer model and for the small play button

- Recommended: Yes, add no entry now.
- One agent proposed 2 new entries: "Answer model" (Normal, Fast, Deep in Ask Claude) and "Paragraph button" (the small play button beside a paragraph).
- No work needs these words now. A glossary stays short when a word comes in only when the work needs it.

### 10. The names of code files stay

- Recommended: Yes, keep them.
- Four names hold a word to avoid: the folder `extension`, and the files `viewer.js`, `notes.js` and `audio-cache-size.mjs`.
- These are names for the code, not text for people. A new name for each needs changes in many files and gives a risk of faults.

### 11. Push the commits of Read Aloud 2 to GitHub

- Recommended: Yes.
- The project has 2 commits that are not on GitHub: the work of today, and the repair of the words. Before today, each commit of this project was pushed.
- I push only Read Aloud 2. The reader of the chats has 4 commits that are not on GitHub, and 3 of them are older than today; I leave them.
