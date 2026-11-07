# Listening exercises MVP

Listening is available during both initial assessment and teaching. The agent decides when spoken Mandarin serves the learning goal, and chooses **single-answer multiple choice or free recall** for that exercise. Prompt and answer languages can be English or Chinese. There is no separate listening session mode or question frequency quota.

## Learner experience

- A listening question shows **Listen** and **Play** above the question text. The question and answer choices or free-recall input are visible immediately below the audio controls. The spoken sentence is not displayed.
- Press **Play** for normal 1× speed or the adjacent **0.75×** button for slower playback. Both use the same recording with pitch preservation, including during post-answer review; adjust system volume beforehand. Stop and unlimited replay are available. Highlight-and-read keeps its normal-speed behavior.
- Pressing either playback action restarts the sentence at that speed. Switching during audio preparation reuses the pending request; switching after loading reuses the loaded recording. No separate slow synthesis is requested.
- Selecting a choice or drafting an answer is possible before listening, but **Submit answer** is disabled until one complete playback ends at either speed. Stopping early, switching speeds mid-sentence, an audio error or dictation interruption does not complete that attempt. A previously completed playback still counts when a later replay is stopped. A different question requires its own playback.
- After submission, the transcript appears, with replay available. Existing multiple-choice grading/Why and free-recall committed-answer/model-feedback behavior is retained regardless of whether the answer was right or wrong.
- If audio fails, use **Retry**. After a failed retry, **Continue another way** returns the technical problem to the agent. It is not an incorrect answer or an “I don't know.” The agent should assess the learning goal another way and leave listening ability unassessed; a written alternative cannot establish listening comprehension.

## Agent and storage integration

Existing graded tools accept optional `listening: { text: "我想要一杯热茶。" }`. Probe uses `probe`/`recall`; teaching uses `quiz`/`explain`, retaining required teaching `type` and validated plan `nodeId`. The ordinary Quizzing preference still governs written checks. Both answer formats are exposed for listening; the alternate format requires `listening` in its declared schema and execution guard. Listening multi-select is rejected.

The agent commits the answer before asking. Prompt guidance says not to reveal the spoken sentence/translation in preceding prose or visible question/details, and to avoid clues that make the audio unnecessary. Audio is generated only when Play is pressed, through the existing `/api/speech` service/cache and configured ElevenLabs credentials. Loaded replay reuses the current recording; service cache behavior and its 256 MiB limit remain unchanged.

The existing native question call and answer result carry the exercise across reopening and review. A newly mounted pending question requires listening again; an in-memory unconfirmed-submission draft can preserve completion and speed history while the same question recovers. Successful answer records include the transcript, completion flag and rates at which playback actually started. The compact model result identifies the listening modality without repeating authored text, and reports `playbackRates` / `slowPlaybackUsed` when known. Slow playback is valid practice and does not reduce correctness; the agent should distinguish supported listening from evidence of normal-speed comprehension. Older results without rate metadata have unknown speed history. Post-answer replay does not change the original performance record. An audio failure produces `outcome: "audio_unavailable"` and `assessment: "unassessed"`, without correctness/confidence.

0.75× is a trial option, not a scientifically established optimum. Local pitch preservation does not guarantee artifact-free Mandarin tones; evaluate actual listening quality before deciding whether a separately generated slower rendition is needed. See the sibling design/research record for study details.

Concealment is normal UI behavior, consistent with existing committed answers: tool arguments and speech requests remain inspectable in browser developer tools. It is not an exam-security boundary. Saved custom prompt overrides may need adjustment if they contradict the new listening guidance.

## Verification

- `NODE_ENV=test node --import tsx --test tests/listening.test.ts tests/speech-player.test.ts` checks contracts, both phases/formats/preferences, invalid authoring, pending/result persistence, transcript rendering and playback controller behavior.
- `node scripts/smoke-listening.mjs` exercises the real dock/editors/answered card and native Chrome audio using a temporary local server and synthetic WAV. Markdown paint is stubbed. No model/provider calls or paid synthesis.
- Existing question, pending, chat-flow, rendering, phase, parsing and export suites cover compatibility. Use a fresh `LH_DATA_DIR` for settings-independent runs.

Real learner trials are the next quality check: automated tests prove mechanics, not the pedagogical effectiveness or the agent's question-selection quality.

## Deferred

Separate Practice mode, multiple-select listening, multiple voices, dialogue/intent questions, speaker/turn playback controls, speed menus, vocabulary history and new mastery scoring. Revisit these after trying the MVP in real conversations.
