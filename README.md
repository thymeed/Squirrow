# Context Keeper

A local-first memory manager for your AI chats. Save facts, decisions, preferences, snippets and file notes per project, then copy the ones you pick into ChatGPT, Claude or any other assistant. No account. Data stays in your browser's IndexedDB.

## Features
- Projects with five entry kinds: fact, decision, preference, snippet, file note
- Full-text search (all terms must match, title hits rank first)
- "Inject context": tick entries, see a token estimate, copy a paste-ready Markdown block
- Keyboard first: `/` search, `n` new entry, `Esc` close
- JSON export/import (round-trips) and Markdown export

## Develop
```
npm install
npm run dev     # local server
npm test        # Vitest
npm run build   # typecheck + production build into dist/
```

## Privacy
Nothing is sent anywhere. There is no backend, analytics or account.

## License
MIT
