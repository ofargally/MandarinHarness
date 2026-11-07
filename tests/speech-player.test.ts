import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpeechPlayer, stopSpeech, type SpeechMedia, type SpeechPlayerState } from "../components/speech-player.ts";
import type { SpeechPlaybackRate } from "../src/core/speech.ts";
function fixture(fetcher: typeof fetch, ended?: () => void) {
	let calls=0,pauses=0,revoked=0,blocked=false;
	let state: SpeechPlayerState={phase:"idle",text:""};
	const transitions: SpeechPlayerState[] = [];
	const startedRates: SpeechPlaybackRate[] = [];
	const media: SpeechMedia={src:"",currentTime:0,playbackRate:1,preservesPitch:true,onended:null,onerror:null,play:async()=>{calls++},pause:()=>{pauses++},load:()=>{}};
	const player=createSpeechPlayer({fetch:fetcher,audio:()=>media,createURL:()=>"blob:test",revokeURL:()=>{revoked++},blocked:()=>blocked,changed:s=>{state=s;transitions.push(s);},started:rate=>startedRates.push(rate),ended});
	return {player,media,state:()=>state,transitions,startedRates,calls:()=>calls,pauses:()=>pauses,revoked:()=>revoked,block:()=>{blocked=true;stopSpeech();}};
}
const response=()=>new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"audio/mpeg"}});
test("replay reuses audio; stop and disposal release playback resources",async()=>{
	let requests=0;const f=fixture(async()=>{requests++;return response()});
	await f.player.read("茶");assert.equal(f.state().phase,"playing");
	f.player.stop();assert.equal(f.state().phase,"ready");await f.player.read("茶");assert.equal(requests,1);assert.equal(f.calls(),2);
	f.player.dispose();assert.equal(f.revoked(),1);assert.equal(stopSpeech(),false);
});
test("late response after Stop or dictation cannot start playback",async()=>{
	let finish!:(r:Response)=>void;const f=fixture(()=>new Promise(r=>finish=r));
	const run=f.player.read("茶");f.block();finish(response());await run;assert.equal(f.calls(),0);f.player.dispose();
});
test("new Read wins even if old network ignores abort",async()=>{
	const completions:((r:Response)=>void)[]=[];const f=fixture(()=>new Promise(r=>completions.push(r)));
	const old=f.player.read("旧"),current=f.player.read("新");completions[1]!(response());await current;completions[0]!(response());await old;
	assert.equal(f.state().text,"新");assert.equal(f.calls(),1);f.player.dispose();
});
test("Stop during a pending play permission promise prevents late playback",async()=>{
	const f=fixture(async()=>response());let finish!:()=>void;
	f.media.play=()=>new Promise<void>(r=>finish=r);
	const reading=f.player.read("茶");await new Promise(r=>setTimeout(r,0));
	assert.equal(stopSpeech(),true);finish();await reading;
	assert.equal(f.state().phase,"ready");assert.ok(f.pauses()>0);f.player.dispose();
});
test("only a current natural end completes listening; stopped and disposed callbacks cannot unlock it", async () => {
	let ended = 0;
	const f = fixture(async () => response(), () => { ended++; });
	await f.player.read("茶");
	const oldEnd = f.media.onended!;
	f.player.stop(); oldEnd.call(f.media as HTMLAudioElement, new Event("ended"));
	assert.equal(ended, 0);
	await f.player.read("茶");
	f.media.onended!.call(f.media as HTMLAudioElement, new Event("ended"));
	assert.equal(ended, 1);
	const lastEnd = f.media.onended!;
	f.player.dispose(); lastEnd.call(f.media as HTMLAudioElement, new Event("ended"));
	assert.equal(ended, 1);
});
test("coexisting idle players do not steal ownership; playback and dictation stop the active player", async () => {
	const selection = fixture(async () => response());
	const listening = fixture(async () => response());
	await selection.player.read("你好");
	await listening.player.read("茶");
	assert.equal(selection.state().phase, "ready");
	assert.equal(listening.state().phase, "playing");
	const unused = fixture(async () => response());
	assert.equal(listening.state().phase, "playing", "mounting controls must not interrupt audio");
	assert.equal(stopSpeech(), true);
	assert.equal(listening.state().phase, "ready");
	unused.player.dispose(); selection.player.dispose(); listening.player.dispose();
});
test("play permission failure is retryable and never completes a listening attempt", async () => {
	let ended = 0;
	const f = fixture(async () => response(), () => { ended++; });
	f.media.play = async () => { throw new Error("permission denied"); };
	await f.player.read("茶");
	assert.equal(f.state().phase, "error"); assert.equal(ended, 0);
	f.player.dispose();
});
test("decoder error plus rejected play reports only one failure per playback attempt", async () => {
	let ended = 0;
	const f = fixture(async () => response(), () => { ended++; });
	f.media.play = async () => {
		f.media.onerror!.call(f.media as HTMLAudioElement, new Event("error"));
		throw new Error("decoder failed");
	};
	await f.player.read("茶");
	assert.equal(f.transitions.filter(s => s.phase === "error").length, 1);
	await f.player.read("茶");
	assert.equal(f.transitions.filter(s => s.phase === "error").length, 2);
	assert.equal(ended, 0);
	f.player.dispose();
});
test("switching speeds restarts the same recording with pitch preservation and rejects the old end", async () => {
	let requests = 0, ended = 0;
	const f = fixture(async () => { requests++; return response(); }, () => { ended++; });
	await f.player.read("茶");
	const oldEnd = f.media.onended!;
	f.media.currentTime = 0.5;
	await f.player.read("茶", 0.75);
	assert.equal(requests, 1); assert.equal(f.media.currentTime, 0);
	assert.equal(f.media.playbackRate, 0.75); assert.equal(f.media.preservesPitch, true);
	oldEnd.call(f.media as HTMLAudioElement, new Event("ended"));
	assert.equal(ended, 0);
	f.media.onended!.call(f.media as HTMLAudioElement, new Event("ended"));
	assert.equal(ended, 1);
	await f.player.read("茶"); assert.equal(f.media.playbackRate, 1);
	assert.deepEqual(f.startedRates, [1, 0.75, 1]);
	f.player.dispose();
});
test("selecting slow speed during generation reuses the pending request", async () => {
	let requests = 0, finish!: (r: Response) => void;
	const f = fixture(() => { requests++; return new Promise(resolve => { finish = resolve; }); });
	const normal = f.player.read("茶");
	await f.player.read("茶", 0.75);
	finish(response()); await normal;
	assert.equal(requests, 1); assert.equal(f.media.playbackRate, 0.75);
	assert.deepEqual(f.startedRates, [0.75]);
	f.player.dispose();
});
test("a superseded play promise cannot pause a newer speed on the same media", async () => {
	const f = fixture(async () => response());
	const finish: Array<() => void> = [];
	f.media.play = () => new Promise<void>(resolve => { finish.push(resolve); });
	const old = f.player.read("茶"); await new Promise(resolve => setTimeout(resolve, 0));
	const slow = f.player.read("茶", 0.75);
	finish[1]!(); await slow;
	const pauses = f.pauses(); finish[0]!(); await old;
	assert.equal(f.pauses(), pauses); assert.equal(f.state().phase, "playing");
	assert.deepEqual(f.startedRates, [0.75]);
	f.player.dispose();
});
test("failed slow playback does not record slow assistance", async () => {
	const f = fixture(async () => new Response(JSON.stringify({ error: { message: "unavailable" } }), { status: 503 }));
	await f.player.read("茶", 0.75);
	assert.deepEqual(f.startedRates, []); assert.equal(f.state().phase, "error");
	f.player.dispose();
});
