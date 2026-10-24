#!/usr/bin/env bash
# Boot an iPhone simulator, install the app, launch it, verify it stays up, take screenshots.
set -uo pipefail
BUNDLE=com.boristhoris.ringer3d
APP=build/Build/Products/Debug-iphonesimulator/App.app
mkdir -p smoke
UDID=$(xcrun simctl list devices available -j | python3 -c '
import json,sys
d=json.load(sys.stdin)["devices"]
c=[x for k,v in d.items() if "iOS" in k for x in v if x["name"].startswith("iPhone")]
print(c[-1]["udid"])')
echo "Simulator: $UDID"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"
xcrun simctl spawn "$UDID" log stream --style compact --predicate 'process == "App"' > smoke/ios-log.txt 2>&1 &
LOGPID=$!
PID=$(xcrun simctl launch "$UDID" "$BUNDLE" | awk '{print $NF}')
echo "launched pid $PID"
sleep 45
xcrun simctl io "$UDID" screenshot smoke/ios-menu.png
sleep 10
xcrun simctl io "$UDID" screenshot smoke/ios-menu-later.png
kill $LOGPID || true
RUNNING=$(xcrun simctl spawn "$UDID" launchctl list | grep -c "$BUNDLE" || true)
echo "running entries: $RUNNING" | tee smoke/ios-status.txt
grep -iE "error|exception|crash" smoke/ios-log.txt | grep -viE "nw_|networkd|CFNetwork|TIC |RBS|BoardServices" | tail -40 | tee smoke/ios-errors.txt
if [ "$RUNNING" = "0" ]; then echo "App is not running"; exit 1; fi
echo "iOS smoke test passed"
