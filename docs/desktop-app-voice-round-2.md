# Desktop app, round 2: the repair is pushed, and the app has its report

You said yes to both cards. Both are done. One decision is at the end.

## 1. The repair of the voice is saved

- The repair is committed and pushed to GitHub. I read the answer of the push: it arrived.
- To hear it: close the book in the desktop app and open it again.

## 2. The desktop app has a report now

- The reader of the desktop app writes one line for each sentence that it reads, and a line for each fault. It writes to [the same report file as the add-on](file:///Users/semion/Library/Logs/read-aloud-2-events.log). Each of its lines says "desktop app".
- The button "Report a problem" is in the settings box of the reader, under the heading "Something wrong?". I wrote "side bar" on the last page; the settings box is the correct place for it.
- The same button is in the PDF reader of the add-on in Chrome.
- The add-on is version 2.13.2 now. Chrome updates it in about 1 minute, when no PDF reader tab is open.

## What I tested

- 665 tests of the add-on and 52 tests of the voice server pass. 5 tests are new.
- In a test browser with no sound, I opened the reader as the desktop app has it. It read a sample PDF at speed 1.5 with the pitch kept. Its lines arrived in the report, and the button saved a mark.
- Not tested: the sound by ear in your desktop app.

## When the desktop app does something wrong

1. Open the settings box of the reader.
2. Press "Report a problem".
3. Tell any Claude chat: "read the Read Aloud 2 report".

---

## Your decision

### 1. Save the report of the desktop app in git and push it; and do this for each finished change in this conversation

- Recommended: Yes.
- I changed 6 files in the folder of Read Aloud 2 for the report. They are not committed yet.
- With your yes, I commit and push them now. I also commit and push each later change of Read Aloud 2 in this conversation when its tests pass, with no new card.
