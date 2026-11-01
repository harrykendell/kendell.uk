/* Runs in Firefox's page execution world, before Guacamole loads. */
(() => {
    "use strict";

    if (location.origin !== "https://desktop.kendell.uk" || window !== window.top)
        return;

    const REQUEST = "kendell:desktop-clipboard:request:v1";
    const RESPONSE = "kendell:desktop-clipboard:response:v1";
    const TIMEOUT_MS = 3000;
    const POLL_MS = 700;
    const pending = new Map();
    let nextId = 0;
    let lastSyncedText;
    let synchronising = false;

    function bridge(operation, text) {
        return new Promise((resolve, reject) => {
            const id = ++nextId;
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error("Kendell clipboard bridge timed out"));
            }, TIMEOUT_MS);

            pending.set(id, { resolve, reject, timer });
            document.dispatchEvent(new CustomEvent(REQUEST, {
                detail: JSON.stringify({ id, operation, text })
            }));
        });
    }

    document.addEventListener(RESPONSE, (event) => {
        if (typeof event.detail !== "string")
            return;

        let message;
        try {
            message = JSON.parse(event.detail);
        }
        catch {
            return;
        }

        const request = pending.get(message.id);
        if (!request)
            return;

        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.ok)
            request.resolve(message.text);
        else
            request.reject(new Error(message.error || "Clipboard access denied"));
    });

    // Guacamole 1.6.0 already calls navigator.clipboard.readText/writeText
    // and has a working RDP clipboard channel. Delegate only those methods
    // to our privileged Firefox content script; preserve the rest of the API.
    const clipboard = navigator.clipboard;
    if (!clipboard)
        return;

    function patch(name, implementation) {
        try {
            Object.defineProperty(clipboard, name, {
                configurable: true,
                writable: true,
                value: implementation
            });
        }
        catch (error) {
            // An unpatchable method should fail visibly, not silently leave
            // privileged clipboard access looking as though it is enabled.
            console.warn("Kendell clipboard: cannot patch", name, error);
        }
    }

    patch("readText", () => bridge("readText"));
    patch("writeText", async (value) => {
        const text = String(value);
        await bridge("writeText", text);
        // A remote->local copy has already been propagated by Guacamole.
        // Don't echo it back to the remote clipboard on the next poll.
        lastSyncedText = text;
    });

    function activeClient() {
        // The root route hosts a pre-flight page. Never read the clipboard
        // until Guacamole is actually displaying a remote connection.
        return document.visibilityState === "visible"
            && document.hasFocus()
            && /^#\/?client\//.test(location.hash);
    }

    function getInjector() {
        const ng = window.angular;
        if (!ng || !document.documentElement)
            return null;
        return ng.element(document.documentElement).injector() || null;
    }

    async function resync() {
        if (!activeClient() || synchronising)
            return;

        const injector = getInjector();
        if (!injector)
            return;

        synchronising = true;
        try {
            const text = await bridge("readText");
            if (!activeClient() || !text || text === lastSyncedText)
                return;

            // Use Guacamole's existing Angular clipboard service, which
            // broadcasts updates to the existing RDP clipboard streams.
            const ClipboardData = injector.get("ClipboardData");
            const clipboardService = injector.get("clipboardService");
            await clipboardService.setClipboard(new ClipboardData({
                type: "text/plain",
                data: text
            }));
            lastSyncedText = text;
        }
        catch {
            // The local clipboard may temporarily be unavailable, or the
            // RDP session may be disconnecting. Retry only while focused.
        }
        finally {
            synchronising = false;
        }
    }

    // Mouse-based paste works as well as Ctrl+V because the RDP clipboard is
    // synchronised while the remote-desktop tab is active. Reads stop when
    // the tab loses focus, reducing unnecessary access to the local clipboard.
    window.addEventListener("focus", resync);
    document.addEventListener("pointerdown", resync, true);
    document.addEventListener("contextmenu", resync, true);
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("hashchange", resync);
    window.addEventListener("keydown", (event) => {
        if (event.key === "Control" || (event.ctrlKey && event.key.toLowerCase() === "v"))
            void resync();
    }, true);
    setInterval(resync, POLL_MS);
})();
