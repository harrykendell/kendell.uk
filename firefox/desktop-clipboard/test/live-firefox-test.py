#!/usr/bin/env python3
"""Smoke-test packaged Firefox extension in a disposable geckodriver profile.

Requires geckodriver listening on port 4446. Clipboard contents are NEVER
printed. This test only reads the clipboard; it does not modify it.
"""
import base64
import io
import zipfile
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

PORT = int(os.environ.get("WEBDRIVER_PORT", "4446"))
SERVER = f"http://127.0.0.1:{PORT}"
SOURCE = Path(__file__).resolve().parents[1]
TEST_ORIGIN = "https://example.com"


def disposable_test_addon():
    """Same implementation, temporary example.com scope only in test profile."""
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in ("manifest.json", "page.js", "content.js"):
            content = (SOURCE / name).read_text(encoding="utf-8")
            archive.writestr(name, content.replace(
                "https://desktop.kendell.uk", TEST_ORIGIN))
    return output.getvalue()



def request(method, path, data=None):
    body = None if data is None else json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        SERVER + path,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"WebDriver {path}: {exc.code} {exc.read().decode()[:900]}") from exc
    if "value" in result and isinstance(result["value"], dict) and "error" in result["value"]:
        raise RuntimeError(f"WebDriver {path}: {result['value']}")
    return result.get("value")


def main():
    session = request("POST", "/session", {
        "capabilities": {
            "alwaysMatch": {
                "browserName": "firefox",
                "moz:firefoxOptions": {"args": ["--headless"]},
            }
        }
    })
    session_id = session["sessionId"]
    root = f"/session/{session_id}"
    try:
        encoded = base64.b64encode(disposable_test_addon()).decode("ascii")
        addon_id = request("POST", f"{root}/moz/addon/install",
                           {"addon": encoded, "temporary": True})
        print("Installed into isolated test Firefox:", addon_id)

        request("POST", f"{root}/url",
                {"url": TEST_ORIGIN})
        current = request("GET", f"{root}/url")
        print("Page origin loaded:", current.split("/")[2] if "/" in current else current)

        state = request("POST", f"{root}/execute/sync", {
            "script": """
                return {
                    origin: location.origin,
                    pagePatched: !!navigator.clipboard &&
                        String(navigator.clipboard.readText).includes('bridge('),
                    nativeClipboardAvailable: !!navigator.clipboard
                }
            """,
            "args": []
        })
        print("Page patch detection:", state)

        if state["origin"] == TEST_ORIGIN:
            assert state["pagePatched"], "Extension did not patch page clipboard"
            read = request("POST", f"{root}/execute/async", {
                "script": """
                    const done = arguments[arguments.length - 1];
                    navigator.clipboard.readText()
                      .then(value => done({ok: true, length: value.length}))
                      .catch(err => done({ok: false, error: err.name}));
                """,
                "args": []
            })
            print("Permissioned clipboard read:", read)
            assert read["ok"], "Privileged clipboard read failed"
            request("POST", f"{root}/url", {"url": "https://example.org"})
            other = request("POST", f"{root}/execute/sync", {
                "script": """
                    return {
                        origin: location.origin,
                        patched: !!navigator.clipboard &&
                            String(navigator.clipboard.readText).includes('bridge(')
                    }
                """,
                "args": []
            })
            print("Different origin remains unpatched:", other)
            assert other["origin"] == "https://example.org"
            assert not other["patched"]
        else:
            print("Test origin unavailable: packaged addon loaded, live permission test skipped")
    finally:
        request("DELETE", root)


if __name__ == "__main__":
    main()
