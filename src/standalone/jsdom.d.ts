// src/standalone/jsdom.d.ts
// Minimal ambient types for the `jsdom` library, used only by
// standalone-html.test.ts to parse rendered markup. jsdom ships no bundled
// declarations and the standalone fork adds no new (dev)dependencies, so we
// declare just the surface the tests touch. `Document` comes from the DOM lib
// already in the tsc program (exercised by src/webview's jsdom-environment tests).
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    readonly window: { document: Document };
  }
}
