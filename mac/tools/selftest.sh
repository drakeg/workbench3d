#!/bin/zsh
# Runs the in-app self-test against a fresh store in /tmp. Exit code 0 when every check passed.
set -u
rm -rf ~/Library/Saved\ Application\ State/io.github.drakeg.workbench3d.savedState
store=/tmp/Workbench3D-self.store
rm -f $store $store-shm $store-wal
APP_STORE=$store ~/Applications/Workbench3D.app/Contents/MacOS/Workbench3D --selftest
