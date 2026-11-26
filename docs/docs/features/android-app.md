# Android app

The Android app runs Nexote on the phone itself, without a server. Notes are Markdown files in a folder on the phone, in the same format as on a server, and the app shows the same [touch interface](./mobile-app) as the browser. The app can be paired with your Nexote server; syncing the notes follows in the next version.

## Install

The app is not in the Play Store. Every [release](https://github.com/2TAP2B/nexote/releases) has the APK attached as `nexote-<version>.apk`. It needs Android 8 or later.

- **With Obtainium:** add `https://github.com/2TAP2B/nexote` as an app. [Obtainium](https://github.com/ImranR98/Obtainium) installs the APK and offers each new release as an update.
- **By hand:** download the APK on the phone and open it. Android asks once to allow installs from the browser or file manager you used.

Updates install over the old version; the notes stay where they are. Every release is signed with the same key, so Android accepts each update.

## First start

1. Pick the folder for your notes. **Use this folder** takes `Documents/Nexote` in the phone's storage; **Choose another folder** opens the system folder picker.
2. Turn on **Allow access to manage all files** for Nexote on the settings page Android opens, then go back.

Android only lets an app work with files in a folder of your choice through this permission. Nexote uses it for that folder only.

A new folder starts with an empty Default vault. A folder that already holds Nexote data opens with its notes, for example after reinstalling the app.

## What works

Everything in the interface works on the phone alone: notes, the editor, journal, tags, search, collections, [Quick notes](./quick-notes) and threads, images, PDFs and note history. **Open** on a PDF shows it in the phone's PDF viewer.

- **Accounts:** there is no sign-in. The app has one local user, so sign-out, passkeys, invites, members and sharing are hidden, and so is git sync.
- **AI and voice memos:** the phone connects to your AI and speech-to-text endpoints directly. The addresses in **Settings › AI** must be reachable from the phone, for example in the home network or over Tailscale. See [AI](./ai).
- **Sharing to Nexote:** in the share menu of another app, **Nexote** opens Quick notes with the shared text or link in the composer and shared images attached. Nothing is posted until you send it.
- **Back button:** Back closes the open sheet, dialog or settings page first, then returns to the note pane, then to the previous note. With nothing left to go back to, it leaves the app.
- **Dark mode:** the status and navigation bars follow the app's theme.

## Settings › Storage

**Settings › Storage** shows the folder the app uses. **Change folder** opens the system folder picker. Another folder is a separate set of notes: the notes in the old folder stay there, and the app opens the new folder's notes, or an empty set.

## Settings › Server

Pairing connects the app to your Nexote server, so it can sync with your account there.

1. On the server, open **Settings › Devices** and choose **Connect**. It shows a QR code, the server address and a code, valid for 10 minutes and usable once.
2. In the app, open **Settings › Server** and choose **Scan QR code**. Without a camera, or on the same phone, use **Copy link** on the server and paste the link in the app, or enter the address and the code.

The app gets a key of its own that only works for syncing: it can't sign in to the server or change the account. The server keeps only a hash of it; the app keeps it encrypted with a key from the Android keystore, outside the notes folder. **Settings › Devices** on the server lists the paired phones with the last contact, and **Disconnect** there stops the key at once. A phone that hasn't contacted the server for 180 days is disconnected automatically.

The server address has to start with `https://` and have a certificate Android trusts: a public one, or one from a certificate authority you installed on the phone under **Settings › Security › Encryption & credentials**. Plain `http://` only works for `localhost`, for development.

**Disconnect** in the app unpairs the phone; the notes on it stay.

## Your files

The folder has the same layout as a server's data directory (see [Data format](../reference/data-format)): the vaults are folders of `.md` files, next to a few JSON files for spaces and settings. Other apps can open and back up the notes, and a sync tool such as Syncthing can copy the folder to other devices. Nexote reads the files from disk, so changes made by other apps show up when a list or note loads again. Don't edit a note in another app while it is open in Nexote: the next save in Nexote can replace that edit.

The app's engine accepts connections only from the app itself on the phone: it listens on `127.0.0.1` and checks a secret that only the app's own window knows.

## Build it yourself

The app is the frontend's static export plus the Go backend, compiled for Android with gomobile, in a small Kotlin app (`android/`). With Nix:

```bash
nix develop .#android
android/build-engine.sh                       # frontend export + engine library
cd android && ./gradlew assembleDebug         # app/build/outputs/apk/debug/
```

`build-engine.sh` needs `ANDROID_HOME` and `ANDROID_NDK_HOME`, which the devshell sets. Debug builds can be inspected in Chrome's `chrome://inspect`.
