import { SPEECH_PROFILE } from "../../config.ts";
import { keyValue } from "./keys.ts";
import { stores } from "./stores.ts";
import { createSpeechHandler, createSpeechService } from "./speech-service.ts";

const service = createSpeechService({ cache: stores.speechCache, profile: () => SPEECH_PROFILE, key: () => keyValue("ELEVENLABS_API_KEY") });
export const speechPOST = createSpeechHandler(service);
