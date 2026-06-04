# Engineering Principles

This document defines how Murmur changes should be made by humans and agents.
It is adapted from the p-to-q template discipline, but narrowed to the needs of
shipping a product-shaped app.

## Core stance

Build the smallest correct change that fits Murmur's current architecture,
behavior, and operational reality.

## Principles

### 1. Read before write

Read the smallest set of files that truly define the surface you are changing:
code, docs, config, nearby patterns, and validation commands.

### 2. Repository patterns beat generic advice

Use local conventions unless they are clearly failing the current task. Extend
an existing path before inventing a parallel one.

### 3. Keep boundaries narrow

Business logic should stay out of incidental framework glue where practical.
Adapters should stay narrow. Side effects should stay visible.

### 4. Preserve the demo path

Murmur should remain usable in local and guest-safe conditions. Fallbacks are
acceptable when they are explicit. Hidden breakage is not.

### 5. Prefer clarity over cleverness

- explicit names over compressed abstractions
- flat control flow over nesting
- visible data flow over indirection
- cohesive modules over generic dumping grounds

### 6. Receipts over claims

Do not say a flow is fixed, supported, or production-ready without evidence:
manual check, build, test, script output, or clearly documented limitation.

### 7. Write down meaningful limits

If a surface is still stubbed, provisional, or experimental, say so plainly in
docs, the PR, or the handoff note.

## Murmur-specific guidance

- Keep vendor/runtime concerns behind `src/lib/platform/`.
- Treat the hum -> arrangement -> export pipeline as a first-class product
  contract.
- Prefer one-purpose PRs with visible outcomes.
- Split large files when the split improves reasoning, not just aesthetics.
