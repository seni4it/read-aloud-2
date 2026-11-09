# Checks that need a real Chrome

Automatic tests cannot show these. Do them after the add-on is reloaded, at a time agreed with the owner.

## Ticket 16: add-on background

1. Sound page closed: start play in a web tab. Close the sound page (chrome://extensions, "Inspect views: offscreen.html", close). Press play at once. Expect an error message, not a silent "playing". Normal play must still start with no message "Audio player did not take the sentence".
2. Two tabs: read in tab A, stop it, read in tab B with a natural voice for 30 s. Tab A must not start again.
3. Self-update: open a PDF in the reader of the add-on and wait 5 minutes. Change `version` in the manifest on disk. The add-on must not reload while the reader is open. Close the reader: it reloads in about 1 minute.
4. Voice server that waits: open the add-on window while the voice server loads its model. The Mac voice shows after about 2 s.
5. No broadcast from a web tab: read in a web tab with the paste page open. The paste page must still show the word highlight when it reads itself.

Not known until checked: that `chrome.runtime.getContexts` lists a reader tab with its full address, and that the reply `true` of the sound page reaches the background when other add-on pages also listen.

## Ticket 17: library page (real browser necessary)

1. Open the library page. The cards show, with the line "Audio: N MP3s" or "Making audio N%" where it applies.
2. With the Network panel open, type 5 letters in the search box. No `/export` request is sent.
3. For a book with no cover yet, no more than 5 `/library/cover/<id>` requests are sent. Hide the card with a search: the requests stop.
4. With the voice server stopped, add a PDF. The message "Could not add …" shows, and "Adding…" does not stay.
5. Choose a key file that is not JSON in the YouTube panel. The message "That is not the key file from Google." shows.
6. With the voice server stopped, press the restart button. It shows "Restart failed" and can be pressed again after about 2.5 seconds.
7. Look at a "PDF" cover placeholder in light mode and in dark mode.

Not repaired, for ticket 23: the remove button has no message when the voice server is stopped. The light placeholder has a contrast of 4.05 to 1; the token rule asks for 4.5 to 1.
