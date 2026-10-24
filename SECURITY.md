# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | ✅ |

## Reporting a vulnerability

If you discover a security vulnerability in FlowForge, please report it privately
rather than opening a public issue.

**Email:** archibaldwan@163.com

> Note: this mailbox is a placeholder and must be replaced with a real,
> monitored address before the project goes live.

Please include as much of the following as you can:

- A description of the vulnerability and its impact
- Step-by-step instructions or a proof of concept to reproduce it
- The version / commit you tested against
- Any suggested mitigation, if you have one

We will acknowledge reports within a few days and work with you on a fix and
disclosure timeline.

## Scope notes

- FlowForge is a fully local, browser-based application. The dev proxy
  (`src/server/proxy.ts`) is the only component that touches provider
  credentials, and it runs on the developer's machine.
- Reports about the underlying model providers themselves (Ark, Doubao speech)
  are out of scope; please report those to the respective vendors.
