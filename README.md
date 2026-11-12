# Workbench

Workbench is a local workspace for organizing Codex threads and, over time, other developer workflows.

The first module is a local Kanban board for Codex chats with four columns:

- **Unsorted**
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
     |------------------|
Codex app-server   Codex desktop state (read-only)
     |                  |
Local threads      Projects and assignments
```

Workbench statuses are manual and independent from Codex's native sidebar sections. Moving a card never changes Codex sections such as Pinned. Assignments are stored locally in `%LOCALAPPDATA%\Workbench\state.json`. A chat can be opened directly through its `codex://threads/<thread-id>` link.

Project names, paths, and explicit chat assignments are read without modification from `%USERPROFILE%\.codex\.codex-global-state.json`. If that internal desktop format is unavailable or changes, Workbench falls back to the app-server project ID and working directory.

Workbench also reads the desktop's unread-chat state and shows it as a live badge. Runtime badges such as **Active** or **Approval required** come from the app-server status. These runtime events are connection-scoped, so Workbench can only show them for chats loaded through its own app-server connection; it does not observe the separate Codex desktop process internally.

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
- Organize chats manually across Unsorted, Todo, In Progress, and Done
- Move cards with drag and drop
- List all local Codex projects and filter chats by their explicit project assignment
- Persist statuses locally without changing Codex sidebar organization
- Search titles, previews, projects, and Codex sections
- Hide chats after three days in Done, with a manual toggle and automatic inclusion in search results
- Open a chat in Codex through its native deep link
- Show live badges for unread chats and available app-server activity states
- Refresh automatically when thread metadata changes
- Refresh on window focus, visibility changes, and a periodic fallback
- Keep all Workbench services bound to localhost

## Roadmap

- [x] Local backend and app-server lifecycle
- [x] Codex chat overview
- [x] Automatic chat updates
- [x] Unsorted / Todo / In Progress / Done board
- [x] Drag-and-drop thread movement
- [x] Search and project filters
- [x] Direct links back to Codex
- [ ] Archived-thread view
- [ ] Local packaging and one-click startup

## Principles

- Local-first
- No separate copy of conversation content
- No OpenAI API key required for local thread management
- Bind local services to `localhost` only
- Keep Codex as the source of truth for chat metadata
- Keep Workbench status explicit, manual, and local

## Project status

Workbench is experimental and currently in active prototyping. The Kanban board and local status persistence are implemented. The Codex app-server interface is experimental and may change between Codex releases.

## Disclaimer

Workbench is an independent project and is not an official OpenAI product.
