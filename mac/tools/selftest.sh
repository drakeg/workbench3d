#!/bin/zsh
# Runs the in-app self-test (in-memory models only). Exit code 0 when every check passed.
set -u
rm -rf ~/Library/Saved\ Application\ State/io.github.drakeg.workbench3d.savedState
~/Applications/Workbench3D.app/Contents/MacOS/Workbench3D --selftest
