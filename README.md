# Workbench

Workbench is a local workspace for organizing Codex threads and, over time, other developer workflows.

The first module is a local Codex chat overview that will grow into a Kanban-style board mapping Codex threads to three native sections:

- **Todo**
- **In Progress**
- **Done**

## Why Workbench?

Codex threads can accumulate quickly across projects. Workbench aims to provide a focused overview without duplicating or exporting conversation data. Thread titles, IDs, projects, timestamps, and section assignments are read from the local Codex installation.

## Integration approach

Workbench will run locally and communicate with the Codex app-server. The browser UI talks to a small local backend, which connects to Codex over its local protocol.

```text
Workbench UI
     |
Local backend
     |
Codex app-server
     |
Local Codex threads and sections
```

Status changes use Codex's native thread sections instead of a separate status database. This keeps the board and the Codex sidebar synchronized. A thread can be opened directly in the desktop app through its `codex://threads/<thread-id>` deep link.

## Feasibility status

The core integration has been validated locally:

- Listing existing Codex threads
- Creating and deleting a thread section
- Moving a thread into a section
- Reading the assignment through a fresh app-server connection
- Restoring the original state
- Opening local threads through the registered `codex://` protocol

The read-only integration is implemented and validated against a local Codex installation.

## Run locally

Requirements:

- Node.js 24 or newer
- A local Codex installation available as `codex`

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The local API binds to `127.0.0.1:4100`.

## Current functionality

- Read active chats directly from the local Codex app-server
- Deduplicate historical session entries by thread ID
- Search titles, previews, projects, and sections
- Open a chat in Codex through its native deep link
- Refresh automatically when thread metadata changes
- Refresh on window focus, visibility changes, and a periodic fallback
- Keep all Workbench services bound to localhost

## Roadmap

- [x] Local backend and app-server lifecycle
- [x] Read-only Codex chat overview
- [x] Automatic chat updates
- [ ] Todo / In Progress / Done board
- [ ] Drag-and-drop thread movement
- [ ] Search and project filters
- [ ] Direct links back to Codex
- [ ] Archived-thread view
- [ ] Local packaging and one-click startup

## Principles

- Local-first
- No separate copy of conversation content
- No OpenAI API key required for local thread management
- Bind local services to `localhost` only
- Keep Codex as the source of truth

## Project status

Workbench is experimental and currently in active prototyping. The read-only Codex integration is implemented; Kanban write operations are next. The Codex app-server interface is also experimental and may change between Codex releases.

## Disclaimer

Workbench is an independent project and is not an official OpenAI product.
