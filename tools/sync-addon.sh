#!/bin/sh
# Keep a copy of the add-on on the disk inside the Mac.
#   tools/sync-addon.sh
# Why: Chrome loads the add-on unpacked from a folder. When the project is on an external disk and that disk is
# not ready when Chrome starts, Chrome removes the add-on from its list. A copy in the home folder is always there.
# The copy goes to $RA2_ADDON_COPY, or to ~/read-aloud-2/extension. Load the add-on in Chrome from that folder.
# rsync makes the copy equal to extension/ (files that left the project also leave the copy).
# A git post-commit hook can run this script after each commit: see docs/testing.md.
cd "$(dirname "$0")/.." || exit 1
dest="${RA2_ADDON_COPY:-$HOME/read-aloud-2/extension}"
mkdir -p "$dest" || exit 1
rsync -a --delete --exclude '.DS_Store' extension/ "$dest/" || exit 1
echo "The add-on copy is up to date: $dest"
