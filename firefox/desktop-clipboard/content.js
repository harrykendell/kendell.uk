/* Only this exact origin receives the privileged clipboard bridge. */
(() => {
    "use strict";

    if (location.origin !== "https://desktop.kendell.uk" || window !== window.top)
        return;

    const REQUEST = "kendell:desktop-clipboard:request:v1";
    const RESPONSE = "kendell:desktop-clipboard:response:v1";
    const MAX_TEXT_LENGTH = 4 * 1024 * 1024;

    // The content script runs in Firefox's isolated extension world. The
    // page never receives WebExtension APIs, only the two text operations.
    document.addEventListener(REQUEST, async (event) => {
        let id;
        try {
            if (typeof event.detail !== "string")
                return;

            const message = JSON.parse(event.detail);
            if (!Number.isSafeInteger(message.id) || message.id < 1)
                return;

            id = message.id;
            let text;
            if (message.operation === "readText") {
                text = await navigator.clipboard.readText();
                if (text.length > MAX_TEXT_LENGTH)
                    throw new Error("Clipboard text exceeds 4 MiB");
            }
            else if (message.operation === "writeText") {
                if (typeof message.text !== "string"
                    || message.text.length > MAX_TEXT_LENGTH)
                    throw new Error("Invalid clipboard text");
                await navigator.clipboard.writeText(message.text);
            }
            else {
                throw new Error("Unsupported clipboard operation");
            }

            document.dispatchEvent(new CustomEvent(RESPONSE, {
                detail: JSON.stringify({ id, ok: true, text })
            }));
        }
        catch (error) {
            if (id === undefined)
                return;
            document.dispatchEvent(new CustomEvent(RESPONSE, {
                detail: JSON.stringify({
                    id,
                    ok: false,
                    error: error instanceof Error ? error.message : "Clipboard unavailable"
                })
            }));
        }
    });
})();
