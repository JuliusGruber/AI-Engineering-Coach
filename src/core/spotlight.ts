/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * "Spotlighting" via datamarking (Microsoft, 2024 — "Defending Against Indirect
 * Prompt Injection Attacks With Spotlighting").
 *
 * Indirect prompt injection works because a model can't tell trusted instructions
 * from untrusted data when both are plain text. Datamarking makes the untrusted
 * span mechanically distinct: every whitespace run in it is replaced with a marker
 * character, so the model keeps a continuous "this is data" signal even when the
 * snippet contains text like "ignore previous instructions". The system prompt
 * (see UNTRUSTED_DATA_GUARD) tells the model what the marker means.
 *
 * Apply to attacker-influenceable FREE TEXT (transcript snippets, prompt examples,
 * quiz samples) before embedding it in an LLM prompt. Don't apply it to content
 * whose exact formatting the model must assess (e.g. context-file review) — use
 * delimiting there instead.
 */

import { redactSecrets } from './redact-secrets';

/** Marker that replaces whitespace in datamarked text. */
export const SPOTLIGHT_MARKER = '^';

/**
 * Redact secrets, then datamark. Redaction runs FIRST, while whitespace is still
 * intact, because some redaction patterns (auth headers, PEM blocks) depend on it;
 * datamarking after would strip the whitespace and let those secrets through.
 * Text with no whitespace is returned redacted but unmarked (a single token can't
 * carry injected instructions).
 */
export function spotlight(text: string): string {
  if (!text) return text;
  // Normalize any pre-existing markers so attacker-inserted ones can't forge a
  // data boundary, redact while whitespace is intact, then datamark.
  const scrubbed = redactSecrets(text.replaceAll(SPOTLIGHT_MARKER, ' '));
  return scrubbed.replaceAll(/\s+/g, SPOTLIGHT_MARKER);
}
