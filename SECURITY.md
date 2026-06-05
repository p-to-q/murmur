# Security Policy

## Supported branch

Security fixes should target the active development line for Murmur, which is
currently `main` unless a release branch is explicitly announced.

## Reporting a vulnerability

Please do not file public GitHub issues for suspected security problems.

Instead, report with:

- a short description of the issue
- affected route, page, or worker
- reproduction steps or proof of concept
- any logs, support codes, or screenshots
- impact estimate if you have one

Until a dedicated inbox exists, use private repository channels or the project
owner's direct contact path.

## Response expectations

We aim to:

1. acknowledge a report within 3 business days
2. confirm severity and reproduction status as quickly as practical
3. ship a fix or mitigation before public discussion when possible

## Scope reminders

High-priority examples in this repo include:

- auth or session bypass
- billing / credit abuse
- unsafe file upload or export handling
- secret exposure
- injection routes in user-controlled content
- worker endpoints that allow unwanted remote execution or data exfiltration
