// Real HTTP boundary reproduction. No business service is mocked, no failed call is retried.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
const playwright = await import(pathToFileURL(process.argv[2] ?? "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs").href);
const { request } = playwright;
const evidence = [];
for (const closeConnection of [false, true]) {
  let nextSocket = 0;
  const ids = new WeakMap(), calls = new Map(), events = [];
  const server = createServer((req, res) => {
    const id = ids.get(req.socket), count = (calls.get(id) ?? 0) + 1; calls.set(id, count);
    events.push({ socket: id, path: req.url, count, connection: req.headers.connection });
    // A peer may drop an existing persistent connection without returning an HTTP response.
    if (count > 1) { req.socket.destroy(); return; }
    res.writeHead(req.url === "/prime" ? 200 : 403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: req.url === "/prime" ? "PRIMED" : "DENIED" }));
  });
  server.on("connection", socket => ids.set(socket, ++nextSocket));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const context = await request.newContext({ extraHTTPHeaders: closeConnection ? { Connection: "close" } : undefined });
  let observed;
  try {
    assert.equal((await context.get(`${base}/prime`, { maxRetries: 0 })).status(), 200);
    try {
      const response = await context.get(`${base}/check`, { maxRetries: 0 });
      observed = { status: response.status(), body: await response.json() };
    } catch (error) { observed = { transportError: /ECONNRESET|socket hang up/.test(error.message) }; }
    if (closeConnection) assert.deepEqual(observed, { status: 403, body: { status: "DENIED" } });
    else assert.deepEqual(observed, { transportError: true });
    evidence.push({ closeConnection, observed, events });
  } finally {
    await context.dispose(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
console.log(JSON.stringify({ check: "persistent socket loss stays a failure; isolated API probes retain exact HTTP status with no retries", evidence }, null, 2));
