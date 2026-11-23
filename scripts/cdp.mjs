/**
 * Minimal Chrome DevTools Protocol helper for desktop smoke tests.
 *
 * WebView2 must be started with:
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222
 *
 * Usage:
 *   node scripts/cdp.mjs targets
 *   node scripts/cdp.mjs eval "document.title"
 *   node scripts/cdp.mjs eval-file scripts/tmp-eval.js
 *   node scripts/cdp.mjs screenshot artifacts/ui.png
 *   node scripts/cdp.mjs click "button[title='设置']"
 *
 * This helper is development-only; production builds do not enable a remote
 * debugging port by themselves.
 */
const port = process.env.PATA_CDP_PORT ?? "9222";
const baseUrl = `http://127.0.0.1:${port}`;

async function getPageTarget() {
  const targets = await fetch(`${baseUrl}/json`).then((res) => {
    if (!res.ok) {
      throw new Error(`CDP target endpoint returned ${res.status}`);
    }
    return res.json();
  });
  const page = targets.find(
    (target) => target.type === "page" && target.webSocketDebuggerUrl,
  );
  if (!page) {
    throw new Error("No WebView page target found. Is the app running with remote debugging?");
  }
  return page;
}

async function openSocket() {
  const target = await getPageTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (typeof message.id === "number" && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

function keyParams(combination) {
  const parts = combination
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  let modifiers = 0;
  let keyToken = null;
  for (const part of parts) {
    if (part === "alt") modifiers |= 1;
    else if (part === "ctrl" || part === "control") modifiers |= 2;
    else if (part === "meta" || part === "win" || part === "super") modifiers |= 4;
    else if (part === "shift") modifiers |= 8;
    else keyToken = part;
  }
  if (!keyToken) throw new Error("key combination must include a non-modifier key");

  let key;
  let code;
  let vk;
  if (/^[a-z]$/.test(keyToken)) {
    key = keyToken;
    code = `Key${keyToken.toUpperCase()}`;
    vk = keyToken.toUpperCase().charCodeAt(0);
  } else if (/^[0-9]$/.test(keyToken)) {
    key = keyToken;
    code = `Digit${keyToken}`;
    vk = keyToken.charCodeAt(0);
  } else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(keyToken)) {
    const number = Number(keyToken.slice(1));
    key = keyToken.toUpperCase();
    code = key;
    vk = 111 + number;
  } else {
    throw new Error(`Unsupported test key: ${keyToken}`);
  }

  return {
    modifiers,
    key,
    code,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  };
}

async function evaluate(socket, expression) {
  const result = await socket.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    const message =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      "Runtime evaluation failed";
    throw new Error(message);
  }
  return result.result?.value;
}

async function main() {
  const [command, argument] = process.argv.slice(2);
  if (!command) {
    console.error("Usage: node scripts/cdp.mjs <targets|eval|click|screenshot> [argument]");
    process.exitCode = 2;
    return;
  }

  if (command === "targets") {
    console.log(JSON.stringify(await getPageTarget(), null, 2));
    return;
  }

  const socket = await openSocket();
  try {
    if (command === "eval") {
      if (!argument) throw new Error("eval requires an expression");
      console.log(JSON.stringify(await evaluate(socket, argument), null, 2));
    } else if (command === "eval-file") {
      if (!argument) throw new Error("eval-file requires a path");
      const fs = await import("node:fs/promises");
      const expression = await fs.readFile(argument, "utf8");
      console.log(JSON.stringify(await evaluate(socket, expression), null, 2));
    } else if (command === "click") {
      if (!argument) throw new Error("click requires a selector");
      const selector = JSON.stringify(argument);
      const clicked = await evaluate(
        socket,
        `(() => {
          const element = document.querySelector(${selector});
          if (!element) return false;
          element.click();
          return true;
        })()`,
      );
      console.log(clicked ? "clicked" : "not found");
    } else if (command === "screenshot") {
      if (!argument) throw new Error("screenshot requires a file path");
      const fs = await import("node:fs/promises");
      const result = await socket.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
      });
      await fs.writeFile(argument, Buffer.from(result.data, "base64"));
      console.log(`wrote ${argument}`);
    } else if (command === "file") {
      if (!argument) {
        throw new Error("file requires selector|absolute-path");
      }
      const [selector, filePath] = argument.split("|");
      if (!selector || !filePath) {
        throw new Error("file requires selector|absolute-path");
      }
      const path = await import("node:path");
      const document = await socket.send("DOM.getDocument", { depth: -1 });
      const node = await socket.send("DOM.querySelector", {
        nodeId: document.root.nodeId,
        selector,
      });
      if (!node.nodeId) {
        throw new Error(`selector not found: ${selector}`);
      }
      await socket.send("DOM.setFileInputFiles", {
        files: [path.resolve(filePath)],
        nodeId: node.nodeId,
      });
      console.log("file set");
    } else if (command === "key") {
      if (!argument) throw new Error("key requires a combination such as ctrl+alt+p");
      const params = keyParams(argument);
      await socket.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        ...params,
      });
      await socket.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        ...params,
      });
      console.log(`sent ${argument}`);
    } else {
      throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    socket.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
