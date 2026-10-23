#!/usr/bin/env bash
# Archive PosturePulse AI, upload it to TestFlight, and wait until Apple has processed it.
#
#   apps/ios-client/scripts/testflight.sh              # archive + upload + wait
#   apps/ios-client/scripts/testflight.sh --no-upload  # archive + verify signing only
#   apps/ios-client/scripts/testflight.sh --no-wait    # upload and return immediately
#
# Needs: Xcode, xcodegen, uv (for the processing check), and an App Store Connect API key
# at ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8 (never commit it; *.p8 is gitignored).
# Build number = UTC timestamp (yymmddHHMM), so it always increases and needs no project edit.
set -euo pipefail

KEY_ID="${ASC_KEY_ID:-JG79VW74QA}"
ISSUER_ID="${ASC_ISSUER_ID:-bbcff6e1-7d7c-46aa-9b7c-7da72e9a2990}"
TEAM_ID="${ASC_TEAM_ID:-3J5T92268T}"
APP_ID="${ASC_APP_ID:-6818384831}"   # PosturePulse AI (com.beaive.posturepulse)
KEY_PATH="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8}"

UPLOAD=1; WAIT=1
for arg in "$@"; do
  case "$arg" in
    --no-upload) UPLOAD=0; WAIT=0 ;;
    --no-wait) WAIT=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

[ -f "$KEY_PATH" ] || { echo "API key not found: $KEY_PATH" >&2; exit 1; }
cd "$(dirname "$0")/.."

BUILD="$(date -u +%y%m%d%H%M)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/posturepulse-testflight.XXXXXX")"
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$KEY_PATH"
      -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER_ID")

echo "==> xcodegen"; xcodegen generate >/dev/null

echo "==> archive (build $BUILD)"
xcodebuild archive -project PosturePulse.xcodeproj -scheme PosturePulse -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$WORK/PosturePulse.xcarchive" \
  -derivedDataPath "$WORK/dd" CURRENT_PROJECT_VERSION="$BUILD" "${AUTH[@]}" \
  | grep -E "error:|ARCHIVE (SUCCEEDED|FAILED)" || true
[ -d "$WORK/PosturePulse.xcarchive" ] || { echo "archive failed (see above)" >&2; exit 1; }

APP="$WORK/PosturePulse.xcarchive/Products/Applications/PosturePulse.app"
codesign -dv "$APP" 2>&1 | grep -E "Identifier|TeamIdentifier"
echo "build number in archive: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Info.plist")"

if [ "$UPLOAD" = 0 ]; then echo "==> --no-upload: archive verified, nothing sent"; rm -rf "$WORK"; exit 0; fi

cat > "$WORK/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>method</key><string>app-store-connect</string>
<key>destination</key><string>upload</string>
<key>teamID</key><string>$TEAM_ID</string>
<key>signingStyle</key><string>automatic</string>
<key>uploadSymbols</key><true/>
<key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
EOF

echo "==> upload to App Store Connect"
xcodebuild -exportArchive -archivePath "$WORK/PosturePulse.xcarchive" \
  -exportOptionsPlist "$WORK/ExportOptions.plist" -exportPath "$WORK/export" "${AUTH[@]}" \
  | grep -E "error|Upload succeeded|EXPORT (SUCCEEDED|FAILED)" | sort -u

if [ "$WAIT" = 1 ]; then
  echo "==> waiting for Apple to process build $BUILD (usually 2-10 minutes)"
  ASC_KEY_PATH="$KEY_PATH" ASC_KEY_ID="$KEY_ID" ASC_ISSUER_ID="$ISSUER_ID" ASC_APP_ID="$APP_ID" BUILD="$BUILD" \
  uv run --quiet --with pyjwt --with cryptography python - <<'PY'
import json, os, sys, time, urllib.error, urllib.request
import jwt

def call(path):
    token = jwt.encode(
        {"iss": os.environ["ASC_ISSUER_ID"], "iat": int(time.time()), "exp": int(time.time()) + 600, "aud": "appstoreconnect-v1"},
        open(os.environ["ASC_KEY_PATH"]).read(), algorithm="ES256", headers={"kid": os.environ["ASC_KEY_ID"]})
    req = urllib.request.Request("https://api.appstoreconnect.apple.com" + path, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

path = f"/v1/builds?filter[app]={os.environ['ASC_APP_ID']}&filter[version]={os.environ['BUILD']}&limit=1"
for _ in range(60):
    data = call(path).get("data", [])
    state = data[0]["attributes"]["processingState"] if data else "not visible yet"
    print(" ", state, flush=True)
    if state == "VALID":
        print("Build ready in TestFlight. Internal testers can install it from the TestFlight app.")
        sys.exit(0)
    if state in ("FAILED", "INVALID"):
        print("Apple rejected the build (see App Store Connect).", file=sys.stderr); sys.exit(1)
    time.sleep(30)
print("Still processing after 30 minutes; check App Store Connect.", file=sys.stderr); sys.exit(1)
PY
fi
rm -rf "$WORK"
echo "==> done"
