# 02: A page with an old Player bar says "reload this page"

**What to build:** After a reload of the add-on, a page that was open before keeps an old Player bar that cannot work. Today it goes away without a word. Now a small message shows in its place: "Read Aloud 2 was updated. Reload this page to listen." with a button "Reload this page" and a close button.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] When the web player finds that its add-on connection is gone, it removes the Player bar and the Listen button and shows the message.
- [ ] The message uses no add-on call. The button reloads the page. The close button removes the message.
- [ ] The message shows one time only for a page, and leaves no timer or listener behind.
- [ ] The message has the status role and the look of the Player bar.
- [ ] A node test covers: connection gone gives the message; close removes it.
- [ ] `./run-tests.sh` passes.
