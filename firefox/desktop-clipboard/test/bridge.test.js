const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

function harness(origin = "https://desktop.kendell.uk", hash = "#/client/abc") {
    const handlers = new Map();
    const intervals = [];
    const remote = [];
    let localText = "copied locally";

    const document = {
        documentElement: {},
        visibilityState: "visible",
        hasFocus: () => true,
        addEventListener(type, fn) {
            const list = handlers.get(type) || [];
            list.push(fn);
            handlers.set(type, list);
        },
        dispatchEvent(event) {
            for (const handler of handlers.get(event.type) || [])
                handler(event);
        }
    };
    const window = {
        addEventListener: document.addEventListener.bind(document)
    };
    window.top = window;
    const navigatorContent = {
        clipboard: {
            async readText() { return localText; },
            async writeText(text) { localText = text; }
        }
    };
    const navigatorPage = {
        clipboard: {
            async readText() { throw new Error("Unprivileged read"); },
            async writeText() { throw new Error("Unprivileged write"); }
        }
    };

    class ClipboardData {
        constructor(value) {
            Object.assign(this, value);
        }
    }
    const clipboardService = {
        async setClipboard(data) {
            remote.push(data.data);
            await navigatorPage.clipboard.writeText(data.data);
        }
    };
    window.angular = {
        element() {
            return {
                injector() {
                    return {
                        get(key) {
                            if (key === "ClipboardData")
                                return ClipboardData;
                            if (key === "clipboardService")
                                return clipboardService;
                            throw new Error("Unknown service");
                        }
                    };
                }
            };
        }
    };

    function CustomEvent(type, init) {
        this.type = type;
        this.detail = init.detail;
    }

    const base = {
        document, window, CustomEvent,
        location: { origin, hash },
        setTimeout, clearTimeout,
        setInterval(callback) { intervals.push(callback); },
        console
    };
    const page = { ...base, navigator: navigatorPage };
    const content = { ...base, navigator: navigatorContent };
    vm.runInNewContext(source("page.js"), page, { filename: "page.js" });
    vm.runInNewContext(source("content.js"), content, { filename: "content.js" });

    return {
        document, window, intervals, remote, navigatorPage,
        get localText() { return localText; },
        set localText(value) { localText = value; }
    };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

test("only the exact HTTPS desktop hostname is patched", async () => {
    for (const origin of [
        "https://knowledge.kendell.uk",
        "https://foo.desktop.kendell.uk",
        "http://desktop.kendell.uk"
    ]) {
        const h = harness(origin);
        await assert.rejects(h.navigatorPage.clipboard.readText(), /Unprivileged/);
    }
});

test("privileged read/write and clipboard synchronisation", async () => {
    const h = harness();
    assert.equal(await h.navigatorPage.clipboard.readText(), "copied locally");
    await h.intervals[0]();
    await settle();
    assert.deepEqual(h.remote, ["copied locally"]);

    await h.navigatorPage.clipboard.writeText("copied remotely");
    assert.equal(h.localText, "copied remotely");
    await h.intervals[0]();
    await settle();
    assert.deepEqual(h.remote, ["copied locally"], "remote copies must not echo back");

    h.localText = "copied again";
    await h.intervals[0]();
    await settle();
    assert.deepEqual(h.remote, ["copied locally", "copied again"]);
});

test("clipboard polling stays off outside the remote desktop", async () => {
    const h = harness("https://desktop.kendell.uk", "");
    await h.intervals[0]();
    await settle();
    assert.deepEqual(h.remote, []);
});
