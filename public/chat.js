// CalColor Academy — customer-facing chat widget (vanilla, no dependencies).
// Self-contained: injects its own styles + DOM, streams answers from the
// standalone chatbot API. Served as a static asset from this same Vercel
// project (at /chat.js) so it can be embedded from anywhere, e.g. Webflow's
// site-wide footer code:
//   <script src="https://YOUR-API.vercel.app/chat.js"
//           data-api="https://YOUR-API.vercel.app/api/chat" defer></script>
// If data-api is omitted, it calls "/api/chat" on the same origin.
(function () {
  var script = document.currentScript;
  var API_URL = (script && script.getAttribute('data-api')) || '/api/chat';
  var MAX_HISTORY = 6; // turns kept for follow-up context

  var PRIMARY = '#1154f7'; // matches the site's :root --royal-blue
  var history = []; // [{role:'user'|'assistant', content:string}]
  var busy = false;

  // ---- styles ---------------------------------------------------------------
  var css = [
    '.cc-fab{position:fixed;right:20px;bottom:20px;z-index:9998;width:60px;height:60px;border-radius:50%;',
    'background:' + PRIMARY + ';color:#fff;border:none;cursor:pointer;box-shadow:0 6px 20px rgba(17,84,247,.35);',
    'font-size:26px;display:flex;align-items:center;justify-content:center;transition:transform .15s ease}',
    '.cc-fab:hover{transform:scale(1.06)}',
    '.cc-panel{position:fixed;right:20px;bottom:92px;z-index:9999;width:360px;max-width:calc(100vw - 40px);',
    'height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:16px;overflow:hidden;',
    'box-shadow:0 16px 48px rgba(20,20,40,.28);display:none;flex-direction:column;',
    'font-family:Inter,system-ui,-apple-system,sans-serif}',
    '.cc-panel.cc-open{display:flex}',
    '.cc-head{background:' + PRIMARY + ';color:#fff;padding:16px 18px;font-weight:600;font-size:1rem;',
    'display:flex;align-items:center;justify-content:space-between}',
    '.cc-head small{display:block;font-weight:400;opacity:.85;font-size:.78rem;margin-top:2px}',
    '.cc-close{background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;opacity:.9}',
    '.cc-body{flex:1;overflow-y:auto;padding:16px;background:#f7f7fb;display:flex;flex-direction:column;gap:10px}',
    '.cc-msg{max-width:85%;padding:10px 13px;border-radius:14px;font-size:.92rem;line-height:1.45;white-space:pre-wrap;word-wrap:break-word}',
    '.cc-user{align-self:flex-end;background:' + PRIMARY + ';color:#fff;border-bottom-right-radius:4px}',
    '.cc-bot{align-self:flex-start;background:#fff;color:#1a1a2e;border:1px solid #e6e6ef;border-bottom-left-radius:4px}',
    '.cc-bot a{color:' + PRIMARY + '}',
    '.cc-foot{border-top:1px solid #e6e6ef;padding:10px;display:flex;gap:8px;background:#fff}',
    '.cc-input{flex:1;border:1px solid #d8d8e0;border-radius:10px;padding:10px 12px;font-family:inherit;font-size:.92rem;resize:none;max-height:96px}',
    '.cc-input:focus{outline:none;border-color:' + PRIMARY + '}',
    '.cc-send{background:' + PRIMARY + ';color:#fff;border:none;border-radius:10px;padding:0 16px;cursor:pointer;font-weight:600}',
    '.cc-send:disabled{opacity:.5;cursor:default}',
    '.cc-typing{display:inline-block;color:#9a9ab0;font-style:italic}',
  ].join('');
  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ---- DOM ------------------------------------------------------------------
  var fab = document.createElement('button');
  fab.className = 'cc-fab';
  fab.setAttribute('aria-label', 'Chat with CalColor');
  fab.innerHTML = '&#128172;'; // speech balloon

  var panel = document.createElement('div');
  panel.className = 'cc-panel';
  panel.innerHTML =
    '<div class="cc-head"><div>CalColor Assistant<small>Ask about classes, camps &amp; registration</small></div>' +
    '<button class="cc-close" aria-label="Close">&times;</button></div>' +
    '<div class="cc-body"></div>' +
    '<div class="cc-foot">' +
    '<textarea class="cc-input" rows="1" placeholder="Type your question..."></textarea>' +
    '<button class="cc-send">Send</button></div>';

  document.body.appendChild(fab);
  document.body.appendChild(panel);

  var body = panel.querySelector('.cc-body');
  var input = panel.querySelector('.cc-input');
  var sendBtn = panel.querySelector('.cc-send');
  var closeBtn = panel.querySelector('.cc-close');

  function addMsg(role, text) {
    var el = document.createElement('div');
    el.className = 'cc-msg ' + (role === 'user' ? 'cc-user' : 'cc-bot');
    el.textContent = text;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  // Minimal, safe linkification of URLs, emails, and phone numbers in bot text.
  function linkify(el) {
    var text = el.textContent;
    el.innerHTML = '';
    var re = /(https?:\/\/[^\s]+)|([\w.+-]+@[\w-]+\.[\w.-]+)|(\(\d{3}\)\s?\d{3}-\d{4})/g;
    var last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement('a');
      if (m[1]) { a.href = m[1]; a.target = '_blank'; a.rel = 'noopener'; a.textContent = m[1]; }
      else if (m[2]) { a.href = 'mailto:' + m[2]; a.textContent = m[2]; }
      else { a.href = 'tel:' + m[3].replace(/[^\d]/g, ''); a.textContent = m[3]; }
      el.appendChild(a);
      last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }

  function openPanel() {
    panel.classList.add('cc-open');
    if (body.children.length === 0) {
      addMsg('bot', 'Hi! I can help with questions about CalColor Academy — programs, tuition, registration, free trials, make-up classes, summer camp, and more. What would you like to know?');
    }
    input.focus();
  }
  function closePanel() { panel.classList.remove('cc-open'); }

  fab.addEventListener('click', function () {
    panel.classList.contains('cc-open') ? closePanel() : openPanel();
  });
  closeBtn.addEventListener('click', closePanel);

  // Auto-grow the textarea.
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  sendBtn.addEventListener('click', send);

  async function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    input.style.height = 'auto';

    addMsg('user', text);
    var botEl = addMsg('bot', '');
    botEl.innerHTML = '<span class="cc-typing">typing…</span>';

    try {
      var res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: history.slice(-MAX_HISTORY) }),
      });

      if (!res.ok || !res.body) {
        throw new Error('HTTP ' + res.status);
      }

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var answer = '';
      botEl.textContent = '';
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        answer += decoder.decode(chunk.value, { stream: true });
        botEl.textContent = answer;
        body.scrollTop = body.scrollHeight;
      }
      answer = answer.trim() || 'Sorry, I had trouble responding. Please try again.';
      botEl.textContent = answer;
      linkify(botEl);

      history.push({ role: 'user', content: text });
      history.push({ role: 'assistant', content: answer });
      if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    } catch (err) {
      botEl.textContent =
        'Sorry, I could not reach the assistant right now. Please call our front desk at (408) 818-8818 or email cu@calcolor.com.';
      linkify(botEl);
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }
})();
