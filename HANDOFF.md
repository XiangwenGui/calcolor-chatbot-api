# CalColor Chatbot — Handoff to CalColor Staff

This document hands ownership of the customer-facing chatbot from the current
build (run under the developer's personal Vercel/OpenAI accounts) to CalColor
Academy's own accounts, so CalColor controls its own costs, keys, and uptime.

**Status:** the API is deployed and the widget is verified working end-to-end
(both `/chat.js` and `/api/chat`, including a full in-browser test of the
exact footer snippet — see step 9). What's left is account ownership: a
CalColor Vercel account, CalColor's own AI Gateway key + spend cap, and
someone with Webflow access pasting the footer snippet on the live site.

## Updated architecture note

The live site (**calcolor.com**) is built and hosted on **Webflow**, which the
developer does not have access to. This repo's static site is *not* what's
live in production — only the **chatbot API** (in
`customer facing chatbot/chatbot-api/`) is a real production dependency here.

This mirrors how the old Microsoft Copilot chatbot worked: it was added to the
live site as a small code snippet pasted into Webflow's site-wide **footer
code**. The new chatbot uses the same pattern — one `<script>` tag in
Webflow's footer, pointing at this project's API.

Because Webflow can't host a standalone `.js` file, the chat widget script
(`js/chat.js`) needs to be served *from* the Vercel project itself, alongside
the API. It will live at a public URL like:

```
https://calcolor-chatbot-api.vercel.app/chat.js
```

and Webflow's footer snippet just references that URL.

## What CalColor is taking ownership of

One Vercel project — **`calcolor-chatbot-api`** — which serves two things:

1. `POST /api/chat` — the RAG backend (retrieval + GPT-5 mini via AI Gateway).
   This is the piece that costs money per message and needs its own key and
   spend cap.
2. `GET /chat.js` — the static widget script, self-contained (styles + DOM +
   fetch logic), no dependencies.

The knowledge base (`chatbot-api/kb/*.md`) is what the bot answers from —
editing it is the main ongoing maintenance task.

**Two separate people/roles are involved below** — the developer (Vercel/API
side) and whoever at CalColor has Webflow access (site side). Neither can do
the other's steps.

## Checklist

### Developer side (Vercel + API)

- [ ] **1. Create a CalColor Vercel account** (or confirm one already exists)
      using a CalColor-owned email, e.g. `cu@calcolor.com`.
- [ ] **2. Transfer the `calcolor-chatbot-api` Vercel project** from the
      developer's account to the CalColor account (Project Settings →
      Transfer), *or* re-link fresh via `vercel link` from a repo fork/clone.
- [ ] **3. Create a new AI Gateway API key** under the CalColor Vercel account
      (Dashboard → AI Gateway → API Keys).
- [ ] **4. Set a hard spend cap** on AI Gateway (Dashboard → AI Gateway →
      Budget) — alerts at 50%/80%, auto-stop at 100%. **Do this before going
      live** — this is what prevents a repeat of the old Copilot bot's
      runaway cost.
- [x] **5. Set environment variables** on the `calcolor-chatbot-api` Vercel
      project (Production + Preview):
  - `AI_GATEWAY_API_KEY` = the key from step 3 — **still using the
    developer's key**; only needs replacing with CalColor's own key (step 7).
  - `ALLOWED_ORIGINS` — set and deployed to
    `https://calcolor.com,https://www.calcolor.com`. Verified live (see step
    9). If the snippet also needs testing on Webflow's own `*.webflow.io`
    staging domain before publishing, add that origin here temporarily.
  - Optional overrides (defaults are fine to leave): `CHAT_MODEL`,
    `EMBED_MODEL`, `MIN_SCORE`, `MAX_OUTPUT_TOKENS`, `FRONT_DESK_PHONE`,
    `FRONT_DESK_EMAIL`, `TRIAL_URL`
  - Note: Vercel project transfer carries env vars over, so this doesn't need
    to be redone after step 2 — just confirm it after transfer.
- [x] **6. Add the widget script as a static file the project serves**, so it
      has a public URL Webflow can point to. Done — `chatbot-api/public/chat.js`
      now exists (Vercel serves anything in `public/` as a static asset at the
      matching path), so it will be live at
      `https://calcolor-chatbot-api.vercel.app/chat.js` on the next deploy.
      README updated to match.
- [ ] **7. Rebuild the vector index under the new key**:
  ```bash
  cd "customer facing chatbot/chatbot-api"
  npm install
  AI_GATEWAY_API_KEY=<new key> npm run build:index
  ```
- [ ] **8. Deploy**:
  ```bash
  vercel --prod
  ```
- [x] **9. Confirm both URLs work** before handing off to Webflow. Done —
      verified two ways:
  - `curl` checks: `/chat.js` returns 200 with the widget script;
    `/api/chat` returns a grounded answer for an allowed origin, `403` for a
    disallowed one.
  - **Full in-browser click-through**: built a local test page containing
    the exact footer snippet under test, temporarily allowed its origin in
    `ALLOWED_ORIGINS`, and confirmed in a real browser — bubble renders,
    panel opens, a real question streams a grounded answer, an out-of-scope
    question escalates to the front desk, no CORS errors in the console.
    Test-only origins were removed and the API redeployed back to the clean
    `https://calcolor.com,https://www.calcolor.com` allowlist afterward — no
    leftover test config in production.
- [ ] **10. Send the exact footer snippet (below) to whoever has Webflow
      access.**
- [ ] **11. Retire the developer's AI Gateway key** once CalColor confirms
      the widget is live and working on calcolor.com.

### Webflow side (whoever has site access)

- [ ] **12. Open Webflow → Project Settings → Custom Code → Footer Code**
      (site-wide, applies to every page — same place the old Copilot snippet
      lived).
- [ ] **13. Paste this snippet:**
  ```html
  <script
    src="https://calcolor-chatbot-api.vercel.app/chat.js"
    data-api="https://calcolor-chatbot-api.vercel.app/api/chat"
    defer>
  </script>
  ```
  (If the API project is renamed during transfer, update both URLs above to
  match the new project's `.vercel.app` domain, or a custom domain if one is
  attached to it.)
- [ ] **14. Save and Publish** the Webflow site — Custom Code changes require
      a full publish, not just saving in the Designer.
- [ ] **15. Test end-to-end on the live site**: open calcolor.com, confirm
      the chat bubble appears, ask a real question (grounded answer) and an
      out-of-scope question (should escalate to front-desk contact). Check
      the browser console for CORS errors — if present, double-check
      `ALLOWED_ORIGINS` in step 5 matches the exact domain shown in the
      address bar.

## Ongoing maintenance

To update what the bot knows:

1. Edit the relevant file(s) in `chatbot-api/kb/*.md` — one topic per file,
   plain factual language.
2. Rebuild the index and redeploy:
   ```bash
   npm run build:index
   vercel --prod
   ```

No Webflow changes are needed for KB updates — only for changing the footer
snippet itself (e.g. if the API's domain ever changes). Decide who at
CalColor (or whether the original developer stays on) owns the KB-edit step.

## Notes

- `.env.local` contains a `VERCEL_OIDC_TOKEN` — this is auto-generated by the
  Vercel CLI on `vercel link` and is not a secret to copy or manage manually.
  It regenerates automatically once CalColor re-links the project.
- This repo's root `index.html` / `js/chat.js` are a leftover local
  prototype of the site and are **not** what's live on calcolor.com — the
  real integration point is the Webflow footer snippet above. Keep the repo
  copy in sync with `chatbot-api/public/chat.js` if both are kept around, or
  remove the root copy to avoid confusion about which one is authoritative.
