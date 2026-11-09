# Checks that need a real Chrome

Automatic tests cannot show these. Do them after the add-on is reloaded, at a time agreed with the owner.

## Ticket 16: add-on background

1. Sound page closed: start play in a web tab. Close the sound page (chrome://extensions, "Inspect views: offscreen.html", close). Press play at once. Expect an error message, not a silent "playing". Normal play must still start with no message "Audio player did not take the sentence".
2. Two tabs: read in tab A, stop it, read in tab B with a natural voice for 30 s. Tab A must not start again.
3. Self-update: open a PDF in the reader of the add-on and wait 5 minutes. Change `version` in the manifest on disk. The add-on must not reload while the reader is open. Close the reader: it reloads in about 1 minute.
4. Voice server that waits: open the add-on window while the voice server loads its model. The Mac voice shows after about 2 s.
5. No broadcast from a web tab: read in a web tab with the paste page open. The paste page must still show the word highlight when it reads itself.

Not known until checked: that `chrome.runtime.getContexts` lists a reader tab with its full address, and that the reply `true` of the sound page reaches the background when other add-on pages also listen.
