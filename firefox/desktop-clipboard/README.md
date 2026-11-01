# Kendell Desktop Clipboard (Firefox)

A minimal WebExtension for **https://desktop.kendell.uk** only.

Guacamole 1.6 already implements RDP clipboard transfer, but Firefox does not
allow ordinary websites to retain the clipboard-read permission. This
extension gives the exact Guacamole origin a narrow bridge to Firefox's
privileged text clipboard methods.

## What it does

- Replaces only the page's `navigator.clipboard.readText()` and
  `navigator.clipboard.writeText()` with calls to the isolated extension
  content script.
- Synchronises changed **text** into Guacamole's existing clipboard service
  while an active remote-desktop tab has focus (every 700 ms and on focus).
  This supports keyboard and mouse-based paste after synchronisation.
- Preserves remote-to-local copying through the existing Guacamole service.
- Declares only `clipboardRead`, `clipboardWrite`, and the exact
  `https://desktop.kendell.uk/*` host permission.
- Does not contact any other service, use a background worker, store clipboard
  history, or monitor clipboard contents in background tabs.
- Declares no independent data collection for Mozilla signing. Clipboard text
  is deliberately relayed to the **user's Guacamole remote desktop** while
  its tab is focused; there is no telemetry or external analytics.

**Limitations:** This bridges text only. Image, rich-text and file clipboard
transfer depend on Guacamole/RDP support and are not implemented here.
A paste immediately after switching to the tab can race with RDP clipboard
synchronisation; if that happens, retry the paste after a moment.

## Install

**For development/testing (unsigned; removed on Firefox restart):**

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on**.
3. Choose this directory's `manifest.json`.
4. Reload the `desktop.kendell.uk` tab.

**For a permanent installation:** Standard Firefox requires an XPI **signed
by Mozilla**. Create an unlisted, signed XPI using an AMO developer account
and `web-ext sign --channel=unlisted`, then install the signed XPI. Do not
globally disable Firefox extension signature enforcement or clipboard security.

## Test

1. Open the Guacamole desktop in Firefox.
2. Copy new text from a local application; focus Guacamole.
3. Paste in the remote desktop using Ctrl+V, then the remote context menu.
4. Copy different text from the remote desktop; paste into a local application.
5. Visit another origin: the extension must not inject into it.

Sources are plain JavaScript, with no build step.
