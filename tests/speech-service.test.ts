import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpeechHandler, createSpeechService, speechCacheKey } from "../src/server/speech-service.ts";
import { createElevenLabsSynthesizer } from "../src/server/elevenlabs-speech.ts";
import { parseSpeechRequest, type SpeechAudio, type SpeechProfile, type SpeechCache } from "../src/core/speech.ts";
const profile: SpeechProfile = { profileVersion: "1", voiceId: "test-voice", modelId: "eleven_flash_v2_5", languageCode: "zh", outputFormat: "mp3_44100_128" };
const audio: SpeechAudio = { audio: new Uint8Array([0xff,0xfb,1,2]), mimeType: "audio/mpeg" };
function cache(): SpeechCache { const map = new Map<string, SpeechAudio>(); return { get: async key => map.get(key) ?? null, put: async (key, bytes, mimeType) => { map.set(key,{audio:bytes,mimeType}); } }; }
test("request keeps Mandarin/script/punctuation and counts codepoints", () => {
	assert.equal(parseSpeechRequest({text:"  你好，\n 世界！ "}).text,"你好， 世界！");
	assert.doesNotThrow(() => parseSpeechRequest({text:"𠮷".repeat(2000)}));
	assert.throws(() => parseSpeechRequest({text:"𠮷".repeat(2001)}));
	assert.throws(() => parseSpeechRequest({text:"\u0000"}));
	assert.notEqual(speechCacheKey("茶",profile),speechCacheKey("茶",{...profile,voiceId:"another"}));
	assert.notEqual(speechCacheKey("茶",profile),speechCacheKey("茶。",profile));
});
test("identical concurrent requests generate once and cached audio works without key", async () => {
	let calls = 0, apiKey: string | undefined = "secret";
	const service = createSpeechService({ cache:cache(), profile:()=>profile,key:()=>apiKey,synthesize:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return audio;} });
	await Promise.all([service({text:"你好"}),service({text:"你好"})]); assert.equal(calls,1);
	apiKey=undefined; assert.equal((await service({text:"你好"})).cache,"hit"); assert.equal(calls,1);
	await assert.rejects(service({text:"再见"}),/API key/);
});
test("failure is not cached; disk failure does not discard generated audio", async()=>{
	let calls=0;
	const service=createSpeechService({cache:cache(),profile:()=>profile,key:()=>"key",synthesize:async()=>{if(++calls===1)throw new Error("fail");return audio;}});
	await assert.rejects(service({text:"茶"})); assert.equal((await service({text:"茶"})).cache,"miss"); assert.equal(calls,2);
	const noDisk=createSpeechService({cache:{get:async()=>{throw Error("disk")},put:async()=>{throw Error("disk")}},profile:()=>profile,key:()=>"key",synthesize:async()=>audio});
	assert.ok((await noDisk({text:"茶"})).warning);
});
test("HTTP rejects oversized/invalid input and sanitizes internal failures",async()=>{
	let calls=0;const handler=createSpeechHandler(async()=>{calls++;throw Error("SECRET")});
	const request=(body:string)=>new Request("http://localhost/api/speech",{method:"POST",headers:{"content-type":"application/json"},body});
	assert.equal((await handler(request("x".repeat(33000)))).status,413);
	assert.equal((await handler(request("{"))).status,400); assert.equal(calls,0);
	const res=await handler(request('{"text":"茶"}')); assert.equal(res.status,502); assert.ok(!(await res.text()).includes("SECRET"));
});
test("ElevenLabs sends key only to fixed endpoint, returns bytes, maps errors and times out",async()=>{
	let seen: RequestInit|undefined;
	const synth=createElevenLabsSynthesizer({fetch:async(url,init)=>{assert.ok(String(url).startsWith("https://api.elevenlabs.io/v1/text-to-speech/test-voice"));seen=init;return new Response(new Uint8Array(audio.audio),{headers:{"content-type":"audio/mpeg"}})}});
	await synth({text:"茶",profile:profile as SpeechProfile & {voiceId:string},apiKey:"secret"});
	assert.equal((seen!.headers as Record<string,string>)["xi-api-key"],"secret");assert.equal(JSON.parse(seen!.body as string).language_code,"zh");
	const fail=createElevenLabsSynthesizer({fetch:async()=>new Response("PRIVATE",{status:401})});
	await assert.rejects(fail({text:"茶",profile:profile as SpeechProfile & {voiceId:string},apiKey:"key"}),/rejected the API key/);
	const slow=createElevenLabsSynthesizer({timeoutMs:5,fetch:()=>new Promise(()=>{})});
	await assert.rejects(slow({text:"茶",profile:profile as SpeechProfile & {voiceId:string},apiKey:"key"}),/too long/);
});
test("distinct generation is bounded while same-text callers can join", async()=>{
	let done!:(audio:SpeechAudio)=>void;
	const service=createSpeechService({cache:cache(),profile:()=>profile,key:()=>"key",maxConcurrent:1,synthesize:()=>new Promise(r=>done=r)});
	const first=service({text:"茶"});await new Promise(r=>setTimeout(r,0));
	const joined=service({text:"茶"});await assert.rejects(service({text:"饭"}),/busy/);
	done(audio);await Promise.all([first,joined]);
});

test("paid-plan voice rejection becomes actionable without exposing provider details", async () => {
 const synthesize = createElevenLabsSynthesizer({fetch:async()=>new Response(JSON.stringify({detail:{status:"payment_required",message:"PRIVATE PROVIDER DETAILS"}}),{status:402})});
 const service = createSpeechService({cache:cache(),profile:()=>profile,key:()=>"key",synthesize});
 const response = await createSpeechHandler(service)(new Request("http://localhost/api/speech",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:"茶"})}));
 assert.equal(response.status,402);
 const body = await response.json();
 assert.equal(body.error.code,"speech_payment_required");
 assert.match(body.error.message,/paid plan/);
 assert.ok(!JSON.stringify(body).includes("PRIVATE"));
});
