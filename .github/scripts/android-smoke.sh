#!/usr/bin/env bash
# Install the debug APK, launch it, and verify it keeps running without WebView JS errors.
set -uo pipefail
PKG=com.boristhoris.ringer3d
mkdir -p smoke
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb logcat -c
adb shell am start -n "$PKG/.MainActivity"
sleep 45
adb exec-out screencap -p > smoke/android-menu.png
# Tap "Quick match" roughly where the card sits in landscape/portrait is device-dependent,
# so just capture a second frame later to show the live demo match moving.
sleep 10
adb exec-out screencap -p > smoke/android-menu-later.png
adb logcat -d > smoke/android-logcat.txt
PID=$(adb shell pidof "$PKG" | tr -d '\r')
echo "pid: ${PID:-none}" | tee smoke/android-status.txt
grep -E "Capacitor/Console|chromium.*CONSOLE|Uncaught|FATAL EXCEPTION" smoke/android-logcat.txt | tail -60 | tee smoke/android-console.txt
if [ -z "$PID" ]; then echo "App is not running"; exit 1; fi
if grep -qE "FATAL EXCEPTION|Uncaught" smoke/android-logcat.txt; then echo "Crash or uncaught JS error"; exit 1; fi
echo "Android smoke test passed"
