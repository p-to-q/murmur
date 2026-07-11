// Test-runner type surface.
//
// Murmur runs on Node in production (Next.js on Vercel); Bun is used ONLY as the
// test runner. Including the full `@types/bun` surface globally would override the
// DOM/Node `fetch`, `Response`, etc. with Bun-runtime variants (e.g. adding the
// required `fetch.preconnect`), which conflicts with product code such as
// `src/lib/auth/proxy-fetch.ts`. So instead of `"types": ["bun"]`, we scope Bun's
// types to just the `bun:test` module declaration, leaving global DOM/Node types
// intact. `@types/bun` is a devDependency so this reference always resolves.
/// <reference types="bun-types/test" />

// Bun exposes `import.meta.dir` (absolute dir of the current file) to code run by
// the Bun test runner. It is not part of the Node/DOM `ImportMeta`, so declare just
// this member here rather than pulling in Bun's full global surface.
interface ImportMeta {
  readonly dir: string;
}
