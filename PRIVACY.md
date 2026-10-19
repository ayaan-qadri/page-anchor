# Privacy Policy for Page Anchor

**Last Updated:** October 20, 2026

Page Anchor ("the Extension", "we", "us", or "our") is committed to protecting your privacy. This Privacy Policy outlines how Page Anchor handles data when you use our browser extension and associated services.

---

## 1. Overview

Page Anchor operates on a **client-side, local-first architecture**:

- **Local storage**: Your drawings, annotations, note text, and preferences are saved on your own device.
- **No account required**: You can use Page Anchor without signing up or signing in.
- **You stay in control**: You can delete your data at any time and export a backup whenever you choose.

---

## 2. Local Data Storage

All data you create and manage within Page Anchor is stored **exclusively on your local device**:

- **Stored Data**: Your strokes, shapes, text notes, the URL and page title each drawing belongs to, and your extension preferences (tool colours, widths, and keyboard shortcuts).
- **Storage Mechanism**: Data is persisted using the browser's built-in, sandboxed `chrome.storage.local` / `browser.storage.local` API.
- **Data Retention & Control**: Your data stays on your machine until you delete an individual page from the Extension's Settings panel, clear the extension data, or uninstall the extension. You have full control to export and import your annotations as JSON backups at any time.

---

## 3. Permissions & Justification

Page Anchor only requests browser permissions that are strictly necessary to provide its core drawing and annotation functionality:

| Permission | Purpose & Scope |
| :--- | :--- |
| **`storage`** | Persists your drawings, text notes, and preferences locally on your machine so they reappear when you revisit a page. |
| **`activeTab`** | Allows the Extension to interact with the current tab when you open the popup or activate drawing mode. |
| **`scripting`** | Injects the drawing overlay into the active webpage DOM upon user interaction. Not requested in the Firefox or Safari builds. |
| **`<all_urls>`** (Host Permission) | Enables the drawing overlay to appear on any website you choose to annotate; the Extension cannot know those pages in advance. |

---

## 4. Backups You Create

Page Anchor can export your annotations to a `.json` file and restore them. Those files are created and read entirely on your device by you; the Extension does not upload them anywhere.

---

## 5. Third-Party Websites & Services

When you use Page Anchor to draw on external websites, the interaction occurs entirely within your local browser session. Page Anchor is not responsible for the privacy practices, cookies, or data handling policies of third-party websites you annotate.

---

## 6. Changes to This Policy

We may update this Privacy Policy periodically to reflect changes in our extension features or applicable browser store requirements. Any changes will be posted to this repository with an updated revision date.

---

## 7. Contact & Support

If you have questions, feedback, or security inquiries regarding this Privacy Policy, please reach out via:

- **GitHub Repository**: [https://github.com/ayaan-qadri/page-anchor](https://github.com/ayaan-qadri/page-anchor)
- **Issue Tracker**: [https://github.com/ayaan-qadri/page-anchor/issues](https://github.com/ayaan-qadri/page-anchor/issues)
- **Security Inquiries**: [https://github.com/ayaan-qadri/page-anchor/security](https://github.com/ayaan-qadri/page-anchor/security)
