# Spec: Italian voices that the owner can find

## Problem Statement

The owner asked for Italian reading. Version 2.11.0 added a second Italian natural voice (Nicola) next to Sara, and a language check. After he reloaded the add-on he said: "i still dont have italian in chrome and i updated it to the new version".

Checked on 10 Nov 2026: his Chrome runs version 2.11.0; the voice server lists five natural voices, two of them Italian; the settings list of the Player bar shows Sara and Nicola on a test page. No fault was found in the code. So the product has the voices, but it does not let him see that fact, and it does not help him when something on his side is old:

- A tab that was open before a reload of the add-on keeps the old Player bar. The old Player bar goes away without a word.
- The voice lists are flat. "Sara, Italian female" is the fourth line of five, with no language heading.
- No screen shows the version of the add-on or the number of voices that came from the voice server.
- The web player does not say which voice reads an Italian page, or why. The reader already says it.

## Solution

Each screen that lists voices groups them by language, with "Italian" as a heading. Each screen can show the version and the voice count. A tab with an old Player bar tells the owner to reload the page. The Player bar says which voice reads the page and why.

## User Stories

1. As the owner, I want a heading "Italian" in the voice list of the Player bar, so that I find Sara and Nicola at once.
2. As the owner, I want the same headings in the add-on popup, so that both lists look the same.
3. As the owner, I want the same headings in the voice list of the reader, so that I find the Italian voices for a Book.
4. As the owner, I want the same headings in the voice sampler, so that I can hear the Italian voices together.
5. As the owner, I want the headings to come from the voice server, so that a new language shows with no change of the add-on.
6. As the owner, I want the Mac voices to keep their place below the natural voices, so that nothing I know moves.
7. As the owner, I want a message on a page whose Player bar is old, so that I know I must reload the page.
8. As the owner, I want that message to have one button, "Reload this page", so that one click repairs it.
9. As the owner, I want that message to go away when I close it, so that it does not cover the page.
10. As the owner, I want the popup to show the version of the add-on, so that I know the reload worked.
11. As the owner, I want the popup to show how many natural voices came from the voice server, and how many are Italian, so that I know the voice server is new.
12. As the owner, I want the same line at the end of the settings of the Player bar, so that I do not need the popup.
13. As the owner, I want the same line in the settings panel of the reader.
14. As the owner, I want a clear line when the voice server is old and has no Italian voice, so that I know it must restart.
15. As the owner, I want a line in the settings of the Player bar that says which voice reads this page and why, for example "This page is in Italian, so Sara reads it."
16. As the owner, I want to choose which Italian voice reads Italian text, Sara or Nicola, and keep my English voice for English text, so that I do not change the voice on each page.
17. As the owner, I want the choice to hold in the web player and in the reader.
18. As a listener with a screen reader, I want each heading and each status line to be read aloud by its role.

## Implementation Decisions

- The voice server answer for the voice list already gives an `accent` for each voice. The language group comes from it: American and British are "English"; Italian is "Italian"; an unknown accent is its own group, named by the accent.
- One pure function groups a voice list by language. The reader imports it. The web player keeps a copy, as it cannot import; a test keeps the copies equal (the same method as the language check of ticket 32).
- The groups keep the server order inside each group. English is first, then Italian, then others, then the Mac voices.
- The old-tab message is made with plain DOM in the shadow root of the Player bar, with no add-on call, because an old tab has no add-on connection. The reload button calls the page reload only.
- The version comes from the add-on manifest at run time. The reader opened from the voice server, which has no add-on, shows no version; it shows the voice count only.
- The Italian voice choice is one new stored setting with the default Sara. The voice rule of ticket 32 uses it in place of the fixed Sara. A chosen Italian voice as the main voice keeps its meaning.
- All new text is plain English, short, and uses the words of the glossary: Player bar, voice server, natural voice, Mac voice, reader, voice sampler, add-on.
- The look uses the present tokens and classes. No new colour.
- One version bump at the end.

## Testing Decisions

- Test behaviour only: the grouped list for a given server answer, the text of each line, the voice that reads for a given language and setting.
- The group function, the voice rule and the status line text are pure functions with node tests, next to the tests of the language check.
- The web player has node tests that load its file with a stub of the add-on calls; the old-tab message gets a test of this kind.
- The voice server needs no change. If its tests are touched, run them.
- No real Chrome check by the agents. The owner decided to stop the test rounds on 10 Nov 2026. He tries it himself after a reload.

## Out of Scope

- The reader of the chat on port 8791. It is a different, older program with an English voice only. It is not changed here.
- New Italian voices beyond Sara and Nicola.
- Word timing from the voice server for Italian.
- Other languages.

## Further Notes

- His Chrome loads the add-on from the working folder. A half-changed file breaks his reading when he reloads. Commit whole tickets, and tell him when to reload.
- After a reload of the add-on, each open page needs a page reload. Story 7 makes the product say this itself.

GitHub: spec is issue 31. Tickets 01 to 04 are issues 32, 33, 34, 35.
