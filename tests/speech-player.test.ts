import assert from "node:assert/strict";
import { test } from "node:test";
import { createSpeechPlayer, stopSpeech, type SpeechMedia, type SpeechPlayerState } from "../components/speech-player.ts";
function fixture(fetcher: typeof fetch) {
	let calls=0,pauses=0,revoked=0,blocked=false;
	let state: SpeechPlayerState={phase:"idle",text:""};
	const media: SpeechMedia={src:"",currentTime:0,onended:null,onerror:null,play:async()=>{calls++},pause:()=>{pauses++},load:()=>{}};
	const player=createSpeechPlayer({fetch:fetcher,audio:()=>media,createURL:()=>"blob:test",revokeURL:()=>{revoked++},blocked:()=>blocked,changed:s=>state=s});
	return {player,media,state:()=>state,calls:()=>calls,pauses:()=>pauses,revoked:()=>revoked,block:()=>{blocked=true;stopSpeech();}};
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
