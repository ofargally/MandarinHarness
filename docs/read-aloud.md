# Read selected text

Highlight conversational text and choose **Read**. The popup offers Stop, status/error feedback and replay. Repeating Read reuses the loaded audio; other selections and later sessions use a persistent disk cache before calling ElevenLabs.

## Setup

1. Add an ElevenLabs API key under **Settings → Providers → Read aloud**. The existing server-side credential manager stores it; the browser only receives masked status.
2. The user-selected voice is configured in `SPEECH_PROFILE.voiceId` in `config.ts`. This library voice requires a paid ElevenLabs plan for API use. After the user upgraded, the live test succeeded on 2026-11-04; replay used identical disk-cached audio with no additional provider call. The current profile uses `eleven_flash_v2_5`, `zh`, normal speed and MP3 output. Model/voice quality has not been auditioned. The profile is independent of the teaching-model settings; no voice-picker UI is added.
3. Restart after changing the profile. Do not put the API key in source code or the speech profile.

Text in learner messages, Markdown responses, expanded agent-thinking content shared question/practice renderers, and the editable Your thinking / Thinking while reading fields is eligible. Select within one rendered prose passage. Code, math, controls, other editable drafts, file chips, PDF content and embedded media are excluded. Already-visible streaming prose can be selected; the spoken text is frozen at Read. Selection across markup such as bold text works. Tab from a valid selection focuses Read; Escape in the popup closes it. Starting dictation stops speech; Read is unavailable during dictation.

The player owns only one active recording. New Read replaces it; navigation and Stop prevent late network responses from starting playback. The server finishes already-dispatched bounded generation and caches it even when playback is canceled, so cancellation does not promise billing cancellation.

## Cache and limits

Audio is stored under `PATHS.data/cache/speech`, respecting `LH_DATA_DIR`. The default budget is 256 MiB including metadata. Files are keyed by a hash of the text, provider, model, voice, output settings and profile version; raw text and credentials are not stored in metadata. Audio itself remains local learner content.

Successful recordings survive restart and are shared across chats. Concurrent identical requests share generation. Failed requests are not cached. Checksum validation, atomic writes, startup cleanup and least-recently-used eviction keep partial/corrupt entries from being served. A cache write failure still returns generated audio for immediate playback, with a warning.

Removing a key prevents uncached synthesis but retains cached audio. Deleting a chat does not delete shared audio. To clear the disposable cache, stop the app and remove only its `cache/speech` directory. Profile changes use a different cache identity; bump `profileVersion` when a same-profile recording should be regenerated.

Selections are limited to 2,000 Unicode code points, requests to 32 KiB, responses to 10 MiB, and provider requests to 30 seconds. At most two distinct generations run simultaneously. There are no automatic retries of potentially billed calls.

## Verification

- `node --import tsx --test tests/speech-*.test.ts`: isolated cache, request, provider and playback tests; synthetic data only.
- `node scripts/smoke-speech.mjs`: isolated Chromium selection/native audio smoke using a generated tone, no ElevenLabs traffic. Requires installed Chrome (or `CHROME_PATH`) and permission to launch it/listen locally. Uses a temporary profile.
- Run typecheck/lint and relevant credential, dictation, keyboard and rendering regressions.

Real Mandarin quality and packaged Electron playback require a configured voice and an actual listening check. Unit tests do not establish either.

Latest browser check (2026-11-04): the isolated Chromium smoke passed selection across emphasis, keyboard activation, native synthetic audio, replay without another request, dictation coordination, question-option text, code exclusion and unmount cleanup. It made no ElevenLabs calls.
