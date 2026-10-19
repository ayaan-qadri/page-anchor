# Security Policy

## Privacy & Data Handling

Page Anchor is designed with a **privacy-first, client-only architecture**:

- **100% Local Storage**: All drawings, text notes, and preferences are stored locally in your browser via `chrome.storage.local` / `browser.storage.local`.
- **Your Content Stays Local**: Page Anchor does not send your drawings, notes, page content, or browsing history to any remote server or third-party service.
- **No Remote Code**: The extension is fully self-contained. It ships no `eval`, no dynamically fetched scripts, and no remotely hosted logic.

---

## Security Safeguards

- **Isolated Shadow DOM**: All injected UI components (the floating toolbar, colour popover, and text editor) live within an encapsulated Shadow DOM tree to prevent CSS bleed and protect against host-page script tampering.
- **Safe DOM Insertion**: Dynamic values rendered in the toolbar, popup, and options pages are inserted as text, never parsed as HTML. Bundled icon markup is converted through `DOMParser`, which does not execute scripts.
- **Untrusted Backup Hardening**: Imported backups are validated before use. Stored page titles and URLs are only ever rendered as text, and a stored URL is only converted into a clickable link when it uses a safe `http(s)` scheme.
- **Storage Quota Handling**: Storage write failures, including quota exhaustion, are detected and surfaced to the user instead of failing silently.

---

## Reporting a Vulnerability

If you discover a potential security vulnerability within Page Anchor:

1. Please do **not** open a public issue on GitHub.
2. Submit a private security advisory via [GitHub Security Advisories](https://github.com/ayaan-qadri/page-anchor/security/advisories/new) or contact the maintainer directly.
3. Please provide a detailed description of the vulnerability, reproduction steps, and potential impact.
4. We will acknowledge receipt within 48 hours and work on a patch release promptly.
