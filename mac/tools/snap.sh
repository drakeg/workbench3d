#!/bin/zsh
# Renders the sample model (or APP_SNAPSHOT_FILE) in light and dark, then a model window and every
# Settings tab, into /tmp/Workbench3D-shots, and quits.
# Usage: tools/snap.sh
#        APP_SNAPSHOT_PAGES=model,settings tools/snap.sh
#        APP_SNAPSHOT_FILE=~/Desktop/cabinet.wb3d tools/snap.sh
set -u
app=~/Applications/Workbench3D.app/Contents/MacOS/Workbench3D
shots=/tmp/Workbench3D-shots
# A crashed run leaves saved window state, and the next launch would wait on a "reopen windows?" alert.
rm -rf ~/Library/Saved\ Application\ State/io.github.drakeg.workbench3d.savedState
rm -rf $shots
APP_SNAPSHOT=$shots $app "$@"
