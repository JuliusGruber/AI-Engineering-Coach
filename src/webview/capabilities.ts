/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Host capability detection.
 *
 * The dashboard runs in two hosts: the VS Code extension (full local agent, can
 * call the language model) and the Copilot app canvas (read-only data view, no
 * model access). Features that need the local agent are gated on `llm`. */

import { rpc } from './shared';

export interface HostCapabilities {
  host: 'vscode' | 'canvas';
  llm: boolean;
}

let caps: HostCapabilities = { host: 'vscode', llm: true };

export async function loadCapabilities(): Promise<void> {
  try {
    const result = await rpc<Partial<HostCapabilities>>('getCapabilities');
    if (result && typeof result === 'object') {
      caps = { host: result.host === 'canvas' ? 'canvas' : 'vscode', llm: result.llm !== false };
    }
  } catch {
    /* keep the default full-capability profile */
  }
}

export function capabilities(): HostCapabilities {
  return caps;
}

export function llmAvailable(): boolean {
  return caps.llm;
}

/** Short note shown next to greyed-out, agent-dependent features. */
export const LLM_UNAVAILABLE_NOTE = 'Open in VS Code with the local Copilot agent to use this.';
