# Home Fin for iPhone, iPad and Mac

A native SwiftUI app laid out like the Netflix iPhone app, with Liquid Glass:
the welcome mosaic, Netflix-style sign-in, "Choose your profile" over today's
No. 1, Home with Series / Films / Categories pills and a billboard that tints
the page, title pages as sheets, a Netflix-style player, Search, My Home Fin,
downloads for watching offline, requests and the admin approval queue. One app
target runs on iPhone, iPad and Mac (native macOS, not Catalyst).

Liquid Glass (the tab bar, buttons, pills, sheets) needs iOS 26 / macOS 26 and
appears automatically there. On iOS 18–18.x and macOS 15 the same controls use
a frosted-glass look instead, so older devices still work.

```
apple/
  project.yml        XcodeGen spec: the Xcode project is generated from this
  HomeFin/           the app (SwiftUI)
    App/             start-up, AppModel, preferences, the download manager
    Onboarding/      welcome, server address, sign in, profiles + PIN pad
    Main/            tabs, the shared header (AirPlay, Downloads, bell), offline mode
    Home/            pills, billboard, rows, categories
    Detail/          the title sheet: Play / Download, rate, share, episodes
    Player/          custom Netflix-style controls on AVPlayer (PiP, AirPlay,
                     speed, episodes, audio & subtitles, lock, brightness)
    Downloads/       Download buttons and the Downloads page
    Search/          suggestions, results, "Not here yet" requests
    Requests/        your / household requests, admin queue, request sheet
    Settings/        My Home Fin, the Profiles sheet, App Settings, Sign In a TV
    Theme/           colours, buttons, badges, and Glass.swift (Liquid Glass)
  HomeFinKit/        Swift package with no UI: Jellyfin + accounts clients,
                     playback plans, the home-screen planner, downloads and
                     offline progress. Has tests.
```

## What you need

* A Mac with **Xcode 26** or newer (for the Liquid Glass APIs). The app runs on
  iOS / iPadOS 18 or later and macOS 15 or later.
* Your Apple Developer account signed in to Xcode (Xcode → Settings → Accounts).
* XcodeGen: `brew install xcodegen`.

## Build and run it on your own devices

```sh
cd apple
xcodegen            # makes HomeFin.xcodeproj (run again after pulling changes)
open HomeFin.xcodeproj
```

1. Click the **HomeFin** project, then the **HomeFin** target, then
   **Signing & Capabilities**. Pick your team. If Xcode says the bundle ID
   `uk.co.levetmedia.homefin` is taken, change it to something of yours
   (also in `project.yml` so it sticks).
2. At the top of the window, pick a run destination: your plugged-in iPhone
   or iPad, a simulator, or **My Mac**. Press ▶︎.
3. On first launch, type your server address, e.g. `http://192.168.55.30:8096`
   at home or your public `https://…` address. Then sign in with your Home Fin
   email (or a Jellyfin username if accounts are off).

The first build is the moment of truth. This app was written without access
to a Mac, so expect a handful of compile errors. They'll be small (a
modifier that's iOS-only, a type the compiler wants spelt out). Paste them
back and they'll be fixed.

## Sending it to friends and family (TestFlight)

TestFlight is Apple's beta app: people install it from the App Store, then
install Home Fin through it. No App Store listing needed.

1. **Create the app record** at [App Store Connect](https://appstoreconnect.apple.com)
   → Apps → **+** → New App. Tick **iOS** and **macOS**, name "Home Fin"
   (pick another if it's taken; this name is only what testers see), and
   choose the bundle ID from step 1 above.
2. **Upload a build.** In Xcode pick **Any iOS Device (arm64)** as the
   destination, then **Product → Archive**. When the Organizer opens:
   **Distribute App → TestFlight & App Store → Distribute**.
   Do it again with **Any Mac** as the destination for the Mac version.
3. **Bump the build number** before every new upload: target → General →
   *Build* (or `CURRENT_PROJECT_VERSION` in `project.yml`). Apple rejects a
   repeated number.
4. **Invite people.** App Store Connect → your app → **TestFlight**:
   * *Internal testing*: up to 100 people on your developer team. No review,
     available minutes after upload.
   * *External testing*: anyone with an email address, or a **public link**
     you can text round the family. The first build gets a short Beta App
     Review (usually within a day). In "Test Information" explain it's a
     personal media-server client and give a test server login, since the
     reviewer needs to get past sign-in.
5. People install **TestFlight** from the App Store (iPhone, iPad or Mac),
   open your invite link, and tap Install. Builds expire after 90 days, so
   upload a fresh one now and then.

Your friends will need a server address they can reach from outside your
house, e.g. your Cloudflare tunnel's `https://` address. `192.168.…` only
works on your home Wi-Fi.

## How it talks to the server

* Jellyfin's API directly for browsing, images and playback. Films and
  episodes in MP4 (H.264 / HEVC) play directly. Everything else (MKV, other codecs)
  is transcoded to HLS by the server, the same as
  the Jellyfin iOS app.
* The Home Fin accounts service (`/homefin-api`) for email sign-in, profiles,
  PINs, trending and requests, when the server has accounts turned on.
* Progress is reported to Jellyfin every 10 seconds, so Continue Watching
  matches the web app and TVs.
* Streaming quality is set in App Settings: on Wi-Fi (Auto by default) and on
  mobile data (Automatic caps it at 4 Mbps; Save Data, Maximum Data and Wi-Fi
  Only work as on Netflix).
* Downloads keep the original file when the device plays it as it is (MP4 /
  MOV with H.264 or HEVC), otherwise the server converts a copy to MP4
  (Standard ≈ 720p, Higher ≈ 1080p). They keep downloading with the app
  closed. Positions watched offline are sent to the server when it's next
  reachable. With no connection at launch, the app opens straight to
  Downloads.
* The sign-in token lives in the Keychain. Sign out removes it.

## Testing HomeFinKit

The non-UI code builds and tests anywhere Swift runs, Linux included:

```sh
cd apple/HomeFinKit
swift test                                  # unit tests
HOMEFIN_IT_SERVER=http://127.0.0.1:8097 \
HOMEFIN_IT_USER=admin HOMEFIN_IT_PASS=… \
HOMEFIN_IT_EMAIL=you@example.com HOMEFIN_IT_EMAIL_PASS=… \
swift test                                  # + tests against a real server
```
