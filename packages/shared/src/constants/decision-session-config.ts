// RD-17 — Decision Lab session persistence limits (OmniMind `/decision-sessions`).

/** Max UTF-8 bytes of the JSON of `personaResponses` + `state` in one request → 413 above. */
export const DECISION_SESSION_STATE_MAX_BYTES = 512 * 1024;

/** The question grows with questionnaire clarifications (≤ 50 answers × 7 000 chars). */
export const DECISION_SESSION_QUESTION_MAX_CHARS = 400_000;

/** `ceoSynthesis` holds the CEO recommendation text only; the full report lives in `state`. */
export const DECISION_SESSION_CEO_SYNTHESIS_MAX_CHARS = 20_000;

export const DECISION_SESSION_LIST_DEFAULT_LIMIT = 20;
export const DECISION_SESSION_LIST_MAX_LIMIT = 100;
