// Run with: node --test
// Checks the guards that keep the public Worker APIs safe. No network access is needed:
// every request below is refused before the Worker would fetch anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import newsroom from "../newsroom-worker.js";
import buffer from "../buffer-worker.js";
import link from "../link-worker.js";

const ORIGIN = "https://studio.falsewinger.com";
const call = (worker, path, { method = "GET", body, headers = {}, env = {}, host = "https://api.test" } = {}) =>
  worker.fetch(new Request(host + path, {
    method,
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env, { waitUntil() {} });

test("newsroom writes are refused when no write key is configured", async () => {
  const res = await call(newsroom, "/api/links", { method: "POST", body: { url: "https://example.com/" } });
  assert.equal(res.status, 503);
});

test("newsroom writes need the right write key, whatever the Origin says", async () => {
  const env = { STUDIO_WRITE_KEY: "secret" };
  for (const headers of [{}, { "X-Studio-Key": "wrong" }]) {
    const res = await call(newsroom, "/api/links", { method: "POST", body: { url: "https://example.com/" }, headers, env });
    assert.equal(res.status, 401);
  }
  const ok = await call(newsroom, "/api/links", { method: "POST", body: { url: "https://example.com/" }, headers: { "X-Studio-Key": "secret" }, env });
  assert.equal(ok.status, 503, "right key passes the guard (then stops only because no database is bound)");
});

test("paid AI headline endpoint needs the write key", async () => {
  const res = await call(newsroom, "/api/short-title", { method: "POST", body: { title: "A headline" }, env: { STUDIO_WRITE_KEY: "secret", AI: {} } });
  assert.equal(res.status, 401);
});

test("server-side fetches refuse private, IP-literal and odd-port targets", async () => {
  for (const url of ["http://localhost/", "http://127.0.0.1/", "http://[::1]/", "http://10.0.0.5/", "http://box.internal/", "http://example.com:8080/", "file:///etc/passwd"]) {
    const res = await call(newsroom, "/api/seo/public-resource", { method: "POST", body: { url } });
    assert.equal(res.status, 400, url);
  }
});

test("the removed open history-write route is gone", async () => {
  const res = await call(newsroom, "/api/ai-audit/history", { method: "POST", body: { url: "https://x.com", score: 1, checks: [] } });
  assert.notEqual(res.status, 201);
});

test("buffer posting needs the write key, whatever the Origin says", async () => {
  const body = { text: "hi", channelIds: ["a".repeat(24)], mode: "now" };
  assert.equal((await call(buffer, "/posts", { method: "POST", body, env: { BUFFER_API_KEY: "b" } })).status, 503);
  assert.equal((await call(buffer, "/posts", { method: "POST", body, env: { BUFFER_API_KEY: "b", STUDIO_WRITE_KEY: "secret" } })).status, 401);
});

test("a malformed short link returns 404 instead of crashing", async () => {
  const res = await link.fetch(new Request("https://link.test/%E0%A4%A"), { DB: {} }, { waitUntil() {} });
  assert.equal(res.status, 404);
});
