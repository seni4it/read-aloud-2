# 23. Library: continue listening first, clean cards, one main action

GitHub issue: #24
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Use the `key-design` skill (read `book/QUICK_RULES.md`, sub-chapters 1.1, 5.5, 6.1, 6.2, 7.1, 7.3, 7.8, 10.5). It is a private reference: apply the rules, copy none of its content. Follow the Design Direction section of the spec.

The library page opens on a 'Continue listening' block for the book that was read last: cover, title, part of the book that is done, time left, and one button 'Continue listening'. Below it is the grid. A card shows a clean title (no underscores, no source tag, no file ending), a progress line and one status text such as '12% done, 40 min left' or 'New'. The whole card opens the book. The top bar holds search, sort and '+ Add PDF' as the one main action. 'Restart the voice server' and 'YouTube' move to one 'More' menu. The empty library shows one message and the 'Add PDF' action. While the list loads, the page shows card placeholders.

## Acceptance criteria

- [ ] With one book or more that was started, the first block is 'Continue listening' and its button opens the book at the reading position.
- [ ] A file name with underscores and a source tag shows as a clean title on the card. The full file name is in the tooltip.
- [ ] The top bar has search, sort, the 'More' menu and one filled button.
- [ ] Restart and YouTube work from the 'More' menu.
- [ ] An empty library, a loading library and a stopped voice server each show their own message.
- [ ] Screenshots in light and dark mode at 1280, 1024 and 400 px are in the ticket report, with the list of rules that were applied.

## Blocked by

- 20 (tokens)
- 17 (library page repairs)
