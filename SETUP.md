# Laptop and iPhone setup

Aer0lith runs as a website on a laptop or as an installed Capacitor app on an iPhone. The native app bundles the production website; it does not need a running laptop server after installation. Android is not configured in this repository.

## Laptop: first-time setup

Install Git and Node.js **22.12 or newer** with npm. On macOS, install the full Xcode app as well if you plan to build for iPhone. Open Xcode once to finish its required setup. Check the tools with `node --version`, `npm --version`, and `xcodebuild -version`.

For a new checkout:

```bash
git clone https://github.com/include-steve-kx/aer0lith.git
cd aer0lith
npm ci
npm run dev
```

For the existing checkout on Steve's Mac:

```bash
cd /Users/stevekx/Desktop/github-projects/aer0lith
npm ci
npm run dev
```

Open the URL printed by Vite, normally http://127.0.0.1:5173. Vite may choose the next port if that one is occupied. Press Control-C to stop it. Source edits reload the browser automatically.

To test and build for production, run `npm run verify`. To serve the resulting `dist` folder locally, run `npm run preview` and open its printed URL. A web build can be hosted as static files; opening `dist/index.html` directly from the filesystem is not the supported workflow.

## iPhone: one-time setup

1. Use a Mac with full Xcode installed and selected as the active developer directory. `xcode-select -p` should point inside Xcode.app. If it points to CommandLineTools, select Xcode in Xcode > Settings > Locations > Command Line Tools.
2. Sign into your Apple account in Xcode > Settings > Accounts. Run `npm ci` in the repository and `npm run ios:open`. Select the App target's Signing & Capabilities tab and confirm a development team is available. The checked-in project uses team `8UU4AK7Z68` and bundle ID `com.stevekx.aer0lith`.
3. Connect the iPhone by USB, unlock it, and trust the Mac if prompted. Enable Settings > Privacy & Security > Developer Mode on the phone and complete its restart/confirmation if needed.
4. On first launch, iOS may ask you to trust the developer under Settings > General > VPN & Device Management. Complete this on the phone.

The project uses Swift Package Manager, so CocoaPods is not needed. These steps were verified with Xcode 26.5 and Steve's iPhone 13 mini running iOS 18.6.2. Signing and device pairing are local prerequisites; a shell command cannot accept phone trust prompts for you.

## Copy-paste: build, install, and launch on Steve's iPhone

Paste this **entire block into Terminal on Steve's Mac**. It uses the existing checkout and the connected iPhone 13 mini. It installs the repository's locked npm dependencies, builds the web app, copies it into the native project, signs the native app, installs it, and launches it. It does not start a development server. It builds the current checkout, including local edits; commit or review those edits before deploying a particular revision.

```bash
(
  set -eu
  cd /Users/stevekx/Desktop/github-projects/aer0lith

  AER0LITH_PHONE_UDID='00008110-001A15103684801E'
  AER0LITH_TEAM_ID='8UU4AK7Z68'
  AER0LITH_BUNDLE_ID='com.stevekx.aer0lith'
  AER0LITH_BUILD_DIR="$PWD/.build/ios-device"

  npm ci
  npm run build
  npm run ios:sync

  xcodebuild \
    -project ios/App/App.xcodeproj \
    -scheme App \
    -configuration Debug \
    -destination "id=$AER0LITH_PHONE_UDID" \
    -derivedDataPath "$AER0LITH_BUILD_DIR" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$AER0LITH_TEAM_ID" \
    PRODUCT_BUNDLE_IDENTIFIER="$AER0LITH_BUNDLE_ID" \
    build

  xcrun devicectl device install app \
    --device "$AER0LITH_PHONE_UDID" \
    "$AER0LITH_BUILD_DIR/Build/Products/Debug-iphoneos/App.app"

  xcrun devicectl device process launch \
    --device "$AER0LITH_PHONE_UDID" \
    --terminate-existing \
    "$AER0LITH_BUNDLE_ID"
)
```

The parentheses isolate the shell options; any failed step stops the block without closing your Terminal. Re-running replaces the installed development build with the same bundle ID. Local app preferences are normally preserved. `.build/` contains generated native build output and is ignored by Git.

### Another Mac or iPhone

Change the `cd` path, device UDID, development team, and (if your team cannot sign the existing ID) bundle ID in the block. The signing overrides apply only to that build. List phones with:

```bash
xcrun devicectl list devices
npx cap run ios --list
```

`devicectl list devices` displays CoreDevice identifiers. To obtain the hardware UDID required by `xcodebuild -destination`, run:

```bash
xcrun devicectl device info details --device '<identifier from the list>'
```

Use the `hardwareProperties.udid` value for `AER0LITH_PHONE_UDID`; `devicectl` accepts that UDID too. Only select the intended phone.

You can alternatively use `npm run ios:open`, select the phone and development team in Xcode, then press Run. Always run `npm run build` and `npm run ios:sync` after web edits before a native build; Xcode alone does not rebuild the website.

## Landscape-only native app

`ios/App/App/Info.plist` declares only `UIInterfaceOrientationLandscapeLeft` and `UIInterfaceOrientationLandscapeRight` under both `UISupportedInterfaceOrientations` and `UISupportedInterfaceOrientations~ipad`. Either landscape direction works; portrait is excluded. `UIRequiresFullScreen` enables the full-screen compatibility behavior needed by older iPadOS orientation restrictions. Modern iPadOS window management may still resize or letterbox a window; this does not force the whole iPad system into landscape.

This is a native build configuration, not an in-game toggle, and takes effect after rebuilding and reinstalling. No orientation plugin is required. The laptop/mobile browser version remains responsive to the browser window; these native settings do not lock Safari. To restore native portrait support, add `UIInterfaceOrientationPortrait` to the corresponding arrays and rebuild.

References: [Capacitor orientation configuration](https://capacitorjs.com/docs/guides/screen-orientation), [Apple supported orientations](https://developer.apple.com/documentation/bundleresources/information-property-list/uisupportedinterfaceorientations), and [Apple full-screen compatibility](https://developer.apple.com/documentation/bundleresources/information-property-list/uirequiresfullscreen).

## Troubleshooting

- **Phone unavailable or locked:** connect by USB, unlock it, confirm trust/Developer Mode, and run `xcrun devicectl list devices` again.
- **Signing team/profile errors:** open `npm run ios:open`, check the Apple account and App target signing team, and select the phone as the run destination. The command permits Xcode to update provisioning using that account. Personal development profiles may expire and require another build/install. Do not delete unrelated apps to solve signing limits.
- **Old visuals on the phone:** rebuild the website, sync Capacitor, then build/install the native app. Browser hot reload does not update the installed app.
- **Black or blank startup:** confirm `dist/index.html` exists after the web build and that sync copied assets to `ios/App/App/public`; inspect device logs in Xcode if it persists.
- **Low frame rate:** try Settings > Final Output > Render Resolution > Balanced / 80% or Adaptive. Appearance settings are saved separately in each browser and installed app.
- **Build warning about a large JavaScript chunk:** this is currently a Vite size warning, not a failed build. Check that the command actually exits successfully.
