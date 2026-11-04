import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSpeechCache } from "../src/store/speech-cache.ts";
const key = (text: string) => createHash("sha256").update(text).digest("hex");
async function fixture(t: { after(fn: () => Promise<unknown>): unknown }) { const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lh-speech-")); t.after(() => fs.rm(directory, { recursive: true, force: true })); return directory; }
test("cache survives restart, verifies checksum and rejects unsafe keys", async t => {
	const directory = await fixture(t), cache = createSpeechCache({ directory });
	await cache.put(key("茶"), new Uint8Array([1,2,3]), "audio/mpeg");
	const restarted = createSpeechCache({ directory });
	assert.deepEqual([...(await restarted.get(key("茶")))!.audio], [1,2,3]);
	await fs.writeFile(path.join(directory, `${key("茶")}.mp3`), new Uint8Array([3,2,1]));
	assert.equal(await restarted.get(key("茶")), null);
	await assert.rejects(cache.get("../../other"));
});
test("LRU accounts for metadata, touches entries and evicts the oldest", async t => {
	const directory = await fixture(t), cache = createSpeechCache({ directory, maxBytes: 1300 });
	const audio = new Uint8Array(400);
	await cache.put(key("a"), audio, "audio/mpeg"); await cache.put(key("b"), audio, "audio/mpeg");
	assert.ok(await cache.get(key("a")));
	await cache.put(key("c"), audio, "audio/mpeg");
	assert.equal(await cache.get(key("b")), null); assert.ok(await cache.get(key("a"))); assert.ok(await cache.get(key("c")));
	const size = (await Promise.all((await fs.readdir(directory)).map(async n => (await fs.stat(path.join(directory,n))).size))).reduce((a,b) => a+b,0);
	assert.ok(size <= 1300);
});
test("startup cleans interrupted commits; simultaneous writes serialize", async t => {
	const directory = await fixture(t);
	await fs.writeFile(path.join(directory, `${key("orphan")}.mp3`), "orphan");
	await fs.writeFile(path.join(directory, `${key("temp")}.json.1234.tmp`), "partial");
	const cache = createSpeechCache({ directory });
	await Promise.all([1,2,3].map(n => cache.put(key("same"), new Uint8Array([n]), "audio/mpeg")));
	assert.deepEqual([...(await cache.get(key("same")))!.audio], [3]);
	assert.deepEqual((await fs.readdir(directory)).sort(), [`${key("same")}.json`,`${key("same")}.mp3`].sort());
});
test("valid JSON with invalid metadata is cleaned as a miss", async t => {
	const directory = await fixture(t), identity = key("bad metadata");
	await fs.writeFile(path.join(directory, `${identity}.json`), "null");
	await fs.writeFile(path.join(directory, `${identity}.mp3`), "bad");
	assert.equal(await createSpeechCache({ directory }).get(identity), null);
	assert.deepEqual(await fs.readdir(directory), []);
});
