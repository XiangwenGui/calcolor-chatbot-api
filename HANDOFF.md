# CalColor Chatbot — Handoff to CalColor Staff

This document hands ownership of the customer-facing chatbot from the current
build (run under the developer's personal Vercel and OpenRouter accounts) to
CalColor Academy's own accounts, so CalColor controls its own costs, keys, and
uptime.

**Status:** the API is deployed and the widget is verified working end-to-end
(both `/chat.js` and `/api/chat`, including a full in-browser test of the
exact footer snippet — see step 11). What's left is account ownership: a
CalColor Vercel account, CalColor's own OpenRouter key with prepaid credits and
auto top-up disabled, and someone with Webflow access pasting the footer snippet
on the live site.

## Updated architecture note

The live site (**calcolor.com**) is built and hosted on **Webflow**, which the
developer does not have access to. This repo is the **chatbot API only** — it is
the one real production dependency.

This mirrors how the old Microsoft Copilot chatbot worked: it was added to the
live site as a small code snippet pasted into Webflow's site-wide **footer
code**. The new chatbot uses the same pattern — one `<script>` tag in
Webflow's footer, pointing at this project's API.

Because Webflow can't host a standalone `.js` file, the chat widget script
(`public/chat.js`) is served *from* the Vercel project itself, alongside the API,
at:

```
https://calcolor-chatbot-api.vercel.app/chat.js
```

and Webflow's footer snippet just references that URL.

## What CalColor is taking ownership of

Two things, in two different accounts:

1. One **Vercel project** — `calcolor-chatbot-api` — which serves
   `POST /api/chat` (the RAG backend) and `GET /chat.js` (the widget script,
   self-contained, no dependencies).
2. One **OpenRouter account**, which is where the per-message cost actually
   lands and where the spend ceiling is set.

Plus the **GitHub repo** (`rgluo93/calcolor-chatbot-api`, private), which is
wired to the Vercel project for push-to-deploy.

The knowledge base (`kb/*.md`) is what the bot answers from — editing it is the
main ongoing maintenance task.

**Two separate people/roles are involved below** — the developer (Vercel/API
side) and whoever at CalColor has Webflow access (site side). Neither can do
the other's steps.

## Checklist

### Developer side (Vercel + OpenRouter + GitHub)

- [ ] **1. Create a CalColor Vercel account** (or confirm one already exists)
      using a CalColor-owned email, e.g. `cu@calcolor.com`.

- [ ] **2. Transfer the `calcolor-chatbot-api` Vercel project** from the
      developer's account to the CalColor account (Project Settings →
      Transfer).
      **Note:** this project is connected to a GitHub repo for push-to-deploy.
      A git-connected project can only be transferred if the *receiving* Vercel
      account has the **Vercel GitHub App installed and granted access to that
      repo**. Install it on the CalColor account first, or the transfer will
      fail or land with the git connection broken. After transfer, re-check
      Settings → Git that the connection survived and that **Production Branch
      is `main`** and **Root Directory is empty / `./`**.

- [ ] **3. Transfer the GitHub repo** `rgluo93/calcolor-chatbot-api` to a
      CalColor-owned GitHub account or org (Settings → Transfer ownership), or
      have CalColor fork/clone it and re-point the Vercel project at their copy.
      **Keep it private** — `kb/*.md` contains tuition rates, policies, and
      staff information.

- [ ] **4. Create a CalColor OpenRouter account** at
      [openrouter.ai](https://openrouter.ai) using a CalColor-owned email, and
      **buy a fixed amount of prepaid credits** (~$20 ≈ 20,000 questions).
      OpenRouter charges a ~5.5% fee on credit purchases; inference itself is
      pass-through pricing, so the ~$0.001/question figure still holds.

- [ ] **5. Turn Auto Top-Up OFF.** Credits page → confirm auto top-up is
      disabled, and re-open the page after buying credits to confirm it is
      *still* off.
      **This is the single most important setting in this document.** Auto
      top-up silently recharges from a saved card, which converts the hard
      prepaid ceiling into an unbounded postpaid account — exactly the failure
      mode that produced the old Copilot bot's ~$3k bill, with extra steps.
      OpenRouter has no budget-alert or auto-stop feature; the prepaid balance
      *is* the cap, and this setting is what keeps it a cap.

- [ ] **6. Create two API keys with per-key monthly limits**
      (openrouter.ai → Keys):
  - `calcolor-prod` — $10/month limit → used for Production
  - `calcolor-preview` — $2/month limit → used for Preview deployments

      Two keys because preview deployments build on every branch and PR; a
      runaway branch must not be able to drain the production budget. If the
      key settings allow a **model allowlist**, restrict both keys to
      `openai/gpt-5-mini` and `openai/text-embedding-3-small` so a typo'd
      `CHAT_MODEL` can't route to an expensive frontier model.

- [ ] **7. Set environment variables** on the `calcolor-chatbot-api` Vercel
      project (Production + Preview):
  - `OPENROUTER_API_KEY` = `calcolor-prod` key for Production,
    `calcolor-preview` key for Preview.
  - `ALLOWED_ORIGINS` — already set and deployed to
    `https://calcolor.com,https://www.calcolor.com`. Verified live (see step
    11). If the snippet also needs testing on Webflow's own `*.webflow.io`
    staging domain before publishing, add that origin here temporarily.
  - Optional overrides (defaults are fine to leave): `CHAT_MODEL`,
    `EMBED_MODEL`, `MIN_SCORE`, `TOP_K`, `MAX_OUTPUT_TOKENS`,
    `REASONING_EFFORT`, `FRONT_DESK_PHONE`, `FRONT_DESK_EMAIL`, `TRIAL_URL`.
  - Note: Vercel project transfer carries env vars over, so this doesn't need
    to be redone after step 2 — just confirm it after transfer.

- [ ] **8. Add a Vercel WAF rate-limit rule** on this project: per-IP, ~20
      requests/minute on `/api/chat`. `ALLOWED_ORIGINS` only inspects the
      `Origin` header, which is trivially spoofable by a script; the WAF rule is
      the only control that actually stops an abuse loop.

- [ ] **9. Do NOT rebuild the vector index unless the KB changed.**
      `data/vectors.json` is committed and is what the bot retrieves from. If
      you do change `kb/*.md`:
  ```bash
  npm ci
  npm run build:index      # needs OPENROUTER_API_KEY in .env
  git add data/vectors.json && git commit && git push
  ```
      Be aware this **invalidates the eval baseline** in
      `month_test_sim/baseline-2026-08-03.log` — the committed index was built
      through the old Vercel AI Gateway at reduced (float16) precision, and a
      rebuild writes full-precision vectors. Re-run the eval and re-baseline
      afterwards. Also note there is no automatic batching: the whole KB is
      embedded in one request, so a KB grown past the endpoint's input limit
      fails hard rather than splitting.

- [x] **10. Serve the widget script as a static file.** Done — `public/chat.js`
      exists (Vercel serves anything in `public/` at the matching path), so it
      is live at `https://calcolor-chatbot-api.vercel.app/chat.js`.

- [ ] **11. Deploy** — this project is push-to-deploy. Merge the PR / push to
      `main` and Vercel builds and promotes automatically. There is no
      `vercel --prod` step any more.

- [x] **12. Confirm both URLs work** before handing off to Webflow. Done —
      verified two ways:
  - `curl` checks: `/chat.js` returns 200 with the widget script;
    `/api/chat` returns a grounded answer for an allowed origin, `403` for a
    disallowed one. **Every curl needs `-H 'Origin: https://calcolor.com'`** —
    without it, production returns 403.
  - **Full in-browser click-through**: built a local test page containing
    the exact footer snippet under test, temporarily allowed its origin in
    `ALLOWED_ORIGINS`, and confirmed in a real browser — bubble renders,
    panel opens, a real question streams a grounded answer, an out-of-scope
    question escalates to the front desk, no CORS errors in the console.
    Test-only origins were removed and the API redeployed back to the clean
    `https://calcolor.com,https://www.calcolor.com` allowlist afterward — no
    leftover test config in production.

      **This was verified against the pre-migration (AI Gateway) deployment.**
      Repeat both checks after step 11 puts the OpenRouter build live. The
      widget, CORS and URLs are unchanged; the model calls are not. On the
      grounded call, confirm the body is **non-empty** — an empty `200` is the
      signature of reasoning effort not reaching the wire.

- [ ] **13. Send the exact footer snippet (below) to whoever has Webflow
      access.**

- [ ] **14. Retire the developer's keys** once CalColor confirms the widget is
      live and working on calcolor.com: revoke the developer's OpenRouter key,
      and remove the leftover `AI_GATEWAY_API_KEY` Vercel env var from the
      pre-migration setup. Do this **last** — deleting `AI_GATEWAY_API_KEY`
      gives up the ability to instantly roll back to a pre-OpenRouter build,
      because Vercel's Instant Rollback restores a previous *build* but does
      **not** restore environment variables.

### Webflow side (whoever has site access)

**These four steps are completely unchanged by the OpenRouter migration.** The
API kept the same Vercel project and therefore the same hostname, which is the
whole reason the migration reused the existing project rather than creating a
new one. If the snippet is already live on calcolor.com, nothing here needs to
be touched at all.

- [ ] **15. Open Webflow → Project Settings → Custom Code → Footer Code**
      (site-wide, applies to every page — same place the old Copilot snippet
      lived).
- [ ] **16. Paste this snippet:**
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
- [ ] **17. Save and Publish** the Webflow site — Custom Code changes require
      a full publish, not just saving in the Designer.
- [ ] **18. Test end-to-end on the live site**: open calcolor.com, confirm
      the chat bubble appears, ask a real question (grounded answer) and an
      out-of-scope question (should escalate to front-desk contact). Check
      the browser console for CORS errors — if present, double-check
      `ALLOWED_ORIGINS` in step 7 matches the exact domain shown in the
      address bar.

## Ongoing maintenance

To update what the bot knows:

1. Edit the relevant file(s) in `kb/*.md` — one topic per file, plain factual
   language.
2. Rebuild the index, commit it, and push:
   ```bash
   npm run build:index
   git add data/vectors.json
   git commit -m "Update KB"
   git push
   ```
   Pushing to `main` deploys. See step 9 about the eval baseline.

No Webflow changes are needed for KB updates — only for changing the footer
snippet itself (e.g. if the API's domain ever changes). Decide who at
CalColor (or whether the original developer stays on) owns the KB-edit step.

## How you would know it broke

This deserves its own section, because the failure is designed to look fine.

If the OpenRouter call fails — expired key, exhausted credits, outage —
`retrieve()` throws, the endpoint catches it, and the customer receives
**HTTP 200 with the same friendly front-desk escalation message a healthy
confidence gate produces**. A completely broken bot reads as a working one.

The machine-readable difference is a response header:

- `X-Escalated: low-confidence` — healthy: retrieval worked, the gate declined
  to answer.
- `X-Escalated: error` — **broken**: retrieval itself failed.

So:

- Any monitoring must assert on **the header**, not the message text.
- Watch Vercel function logs for `retrieval_error` and `generation_error`.
- Watch the OpenRouter dashboard for a spend curve that **flatlines**. A bot
  silently escalating every question costs almost nothing, so a sudden drop to
  near-zero spend is the cheapest available breakage signal.
- If credits run out mid-answer the bubble can come back **empty** rather than
  escalating. An empty reply is always a real fault, never a normal state.

## Notes

- **Model routing is pinned to OpenAI's first-party endpoint** for both the chat
  and embedding models (see `lib/models.ts`). OpenRouter would otherwise be free
  to route to Azure endpoints, including `azure/swedencentral`, which is
  EU-hosted — a data-residency question that did not exist under the previous
  setup. The pin closes that, and also keeps embeddings in the same space the
  committed index was built in. If anyone relaxes `provider.order` later, the EU
  routing question comes back.
- **The only data leaving the system is what a parent types into the chat
  bubble**, plus the KB excerpt used as context. No student records, no billing
  data, no account identifiers are sent to the model.
- `.env.local` contains a `VERCEL_OIDC_TOKEN` — auto-generated by the Vercel CLI
  on `vercel link`, not a secret to copy or manage manually. It regenerates
  automatically once CalColor re-links the project.
- The old copy of this service still exists in the `calcolor` repo under
  `customer facing chatbot/chatbot-api/`. It is kept deliberately as a rollback
  artifact and can be deleted once production has run on OpenRouter for a week.
