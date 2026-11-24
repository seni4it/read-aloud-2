# Desktop app: the same voice as in Chrome

I found why the desktop app sounded different, and I repaired it. Two decisions are at the end.

## The cause

- Both places use the same natural voice, Heart. Your settings in the desktop app are correct.
- The difference was the pitch. In the desktop app, a faster speed made the voice higher.
- At speed 1.2, the voice was 3 semitones higher. At speed 1.5, it was 7 semitones higher. So it sounded like another voice, and a higher speed made it worse.
- In Chrome on a web page, the add-on keeps the pitch at each speed. That is why it sounds good there.

## The repair

- The reader of the desktop app now plays a faster sound the same way as the add-on does. The pitch stays at each speed.
- Now you can increase the speed in the desktop app. The choices go from 0.8 to 2.
- The same repair is in the PDF reader of the add-on in Chrome. It had the same fault.

## How you get it

- Desktop app: close the book and open it again. The app then loads the repaired reader.
- Chrome: the add-on updates itself to version 2.13.1 in about 1 minute, when no PDF reader tab is open.
- A page that was open before the update shows "Read Aloud 2 was updated. Reload this page to listen."

## What I tested

- 660 tests of the add-on and 52 tests of the voice server pass. 5 tests are new.
- In a test browser with no sound, the reader read a sample PDF at speed 1.5. It played 14.4 seconds of sound in 9.6 seconds, with the pitch kept, and with no error.
- Not tested: the sound by ear. Please listen in the desktop app and tell me if it is the same voice now.

## Your answer on the last page

- You said yes: the pauses of the natural voice stay as they are.

---

## Your decisions

### 1. Save this repair in git and push it to GitHub

- Recommended: Yes.
- I changed 4 files in the folder of Read Aloud 2. Nothing is committed yet.

### 2. Give the desktop app a report, as the add-on has

- Recommended: Yes.
- The add-on in Chrome writes each sentence and each fault to its report. The desktop app does not, so I cannot see its faults.
- With your yes, the reader of the desktop app writes the same lines, and its side bar gets a "Report a problem" button.
