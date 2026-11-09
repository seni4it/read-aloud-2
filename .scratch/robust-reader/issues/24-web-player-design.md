# 24. Web-page player and add-on window: the same player, the same look

GitHub issue: #25
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Use the `key-design` skill (read `book/QUICK_RULES.md`, sub-chapters 1.1, 4.1, 6.1, 6.2, 6.4, 8.1, 8.4). It is a private reference: apply the rules, copy none of its content. Follow the Design Direction section of the spec.

The player on web pages uses the same tokens, the same order of controls and the same states as the reader player bar of ticket 21. The add-on window has one main action ('Listen to this page'), then voice and speed, then the switches in one group with one label style, then the links as quiet text. The paste page uses the same tokens and one main action. The page styles of a web site must not change the player: keep it inside its own style scope.

## Acceptance criteria

- [ ] Side-by-side screenshots of the reader player and the web-page player show the same order, sizes and colours.
- [ ] On a page with a dark theme and on a page with a light theme the player has the same look.
- [x] The add-on window has one filled button and each switch is 32 px high or more with its label on the left.
- [x] A Node test finds no colour value in content.js, popup.html or paste.html outside the token names.
- [ ] Screenshots in light and dark mode at 1280, 1024 and 400 px are in the ticket report, with the list of rules that were applied.

## Blocked by

- 20 (tokens)
- 21 (player bar)
- 15, 18 (they own content.js and the small pages)

## Work report

Date: 10 Nov 2026. Status: done in code and Node tests. The screenshots and the side-by-side check need a browser; this run had none. They are a manual step below.

### What a person sees now

The web-page player is the reader player bar as a floating pill. From left to right: Previous sentence, Play or pause (the round orange button, 48 px), Next sentence, the position (a thin orange progress line, and under it "12 / 340" and "4 min left"), Speed ("1.2×"), Follow (the target), Voice and settings (the sliders icon), and Stop and close. Each round button is 40 px. The bar is white with a thin line and a shadow in light mode, and the dark card tone in dark mode. It follows the light or dark mode of the system, as the reader bar does, so it has the same look on a light site and on a dark site.

- Orange is only on Play, on the "Listen from here" button beside a paragraph, on the hover state of the round Listen button (both start the reading), and on the progress line. The speed button has the neutral border of a field, as the speed list of the reader.
- Speed opens a small list of speeds (0.8× to 4×). The settings button opens a panel with the title "Settings": "Voice" (the voice list) and "Move player" (ticket 25). Escape, the × of the bar or a press outside closes them. With the keyboard, the focus goes into the list or panel when it opens, and back to its button when it closes.
- While the natural voice makes a sentence, a ring turns on the play button after 300 ms, as in the reader. With "Reduce motion" set, it does not turn.
- Each icon button shows its name after 500 ms of hover or keyboard focus. The tooltips open on the side that faces the page (above at the bottom, below at the top, to the side at the left and right edges).
- Under 480 px the round buttons are 32 px, play is 40 px, the position is narrower and "min left" is hidden. The bar stays on one row.
- The Listen button, the "Listen from here" button and the "Listen" bubble of a selection use the same tokens. "Listen from here" stays 32 px.

The add-on window: one filled button, "Listen to this page", at the top. Then Voice and Speed. Then one group "Settings" with the six switches: each row is 32 px high or more, its words on the left and the box on the right, all in one label style (14 px). Then the voice server status. Then the links as quiet grey text, underlined, darker on hover. The paste page already had the tokens and one main button ("Listen"); it did not change.

### How the tokens reach the player

The player is in a closed shadow root on other sites, so it cannot load extension/pdf/tokens.css. content.js keeps the values that the player uses in one block, `TOKENS`, between the comments `// tokens:start` and `// tokens:end`, with three parts: the light values (root), the dark values and the reduced-motion values. The style sets them on `:host`, after `all: initial`, so the variables of a site cannot change the player. No other line of content.js holds a colour value. A test compares each value with tokens.css (with each `var()` resolved), in light mode, dark mode and reduced motion, so the two cannot drift.

### Rules applied (my own words)

- One main action per screen, in the brand colour: Play on the bar, "Listen to this page" in the add-on window. All other controls are neutral.
- The same component looks the same everywhere: the web player has the order, sizes, colours and states of the reader bar.
- Few choices in sight: voice and the place of the player are in one panel that opens after a press.
- One label style in a group; the words of a switch on its left, the control on the right; each target 32 px or more.
- Links are quiet text, not buttons.
- Each control has default, hover, pressed and focus states; an icon button shows its name after 500 ms; hover feedback within 100 ms; no motion with reduced motion.
- Colours, sizes, spaces, radii and times come from one token file.

### Files changed

- extension/content.js: the player markup and style, the token block, the speed list, the settings panel, the play spinner, the position and time left.
- extension/popup.html: the switches in one group "Settings", rows of 32 px or more, quiet links.
- tests/node/web-player-design.test.mjs (new, 15 tests after the review repairs).

### Tests (tests/node/web-player-design.test.mjs)

- content.js has one block of token values: root, dark and reduced motion
- each value of the copy in content.js is the value of tokens.css, in light mode, dark mode and reduced motion
- the player style uses only tokens that the copy sets, so a site cannot change them
- no colour value in content.js outside the token block
- no colour value in popup.html and paste.html
- the web player has the controls of the reader bar in the same order
- the sizes are the sizes of the reader bar: 40 px buttons, 48 px play, 32 and 40 px in a narrow window
- orange only for play, the play-from-here buttons and progress
- every icon button of the bar has a name and a tooltip; the speed and settings buttons say that they open a list
- the add-on window has one filled button: Listen to this page
- the add-on window: main action, then voice and speed, then the switches in one group, then the links
- each switch of the add-on window is 32 px high or more, with its words on the left
- the links of the add-on window are quiet text
- the paste page has one main action and loads the token file

The earlier tests of content.js (web-idle-cost, web-follow-player, web-sentences) still pass: no scan or observer at page load, the `stopped` handling and the language for each sentence did not change.

### Open points

- extension/content.css (the word highlight and the sentence shade on web pages) still holds colour values. It was not in the files of this ticket. Its orange and its shade have the token values; the text colour on the word is #111111, and the token --color-on-word is #0f172a.
- The order test reads extension/pdf/index.html, which another agent is changing. If the reader bar changes its order, this test shows it.

### Check in a real Chrome (step by step)

1. Reload the add-on in chrome://extensions, then reload two tabs: a site with a light theme and a site with a dark theme.
2. On each site press the round Listen button. See the bar at the bottom: previous, play (orange), next, position, speed, follow, settings, close.
3. Open the reader (a PDF) in a third tab. Put the reader bar and the web bar side by side. Compare: the order, the 40 px buttons, the 48 px play, the white bar in light mode.
4. Switch macOS to dark mode. See both bars in the dark card tone, play still orange.
5. Hover each button for half a second: a dark label with its name shows above it.
6. Press Speed: the list opens above. Choose 1.5×: the bar shows 1.5×, and the reading goes faster.
7. Press Settings: the panel shows Voice and Move player. Press Escape: it closes.
8. Press Tab until the settings button has the focus ring, then Enter: the panel opens and has the focus.
9. Make the window 1280, 1024 and 400 px wide (light and dark). Take a screenshot each time. At 400 px the bar is on one row and fully on the screen.
10. Open the add-on window: one orange button at the top, then Voice and Speed, then the group "Settings" with six switches (words left, box right), then the grey links.
11. Open "Listen to pasted text": one orange "Listen" button.

### Review repairs (10 Nov 2026)

1. The dark and reduced-motion token checks looped only over the names in the copy. A new test, "each dark and reduced-motion token of tokens.css that the player uses is in the copy, with its value", loops over the names that tokens.css sets for dark mode and for reduced motion. It keeps each name that the player uses, in its style or in the script (the snap time). It then requires each one in the copy, with the same value.
2. The size checks that read CSS text are now named "text check: ..." in their titles. The switch-height check now also resolves its token in tokens.css and requires 32 px or more. The real clamp of the bar in a 400 px window is tested in the move test file (ticket 25).
3. With reduced motion the waiting ring on play no longer turns: "animation: none" in a reduced-motion rule (tested in the move test file).
