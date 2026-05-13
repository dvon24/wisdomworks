/**
 * Widget embed loader — `<script src="...wisdomworks.app/api/widget/embed.js?key=wk_..."></script>`
 *
 * Returns a JS bundle that mounts a chat bubble + window on the customer's
 * site. Designed to be tiny (~6KB minified), zero dependencies, and to
 * work standalone (no React/Vue required on the host site).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const apiKey = url.searchParams.get('key') ?? '';
  // Origin where the widget gets mounted — pulled from the request, not
  // user-supplied, so an attacker can't spoof
  const apiBase = url.origin;

  // The widget JS itself. Inlined as a template literal so we can stamp
  // the apiKey + apiBase at request time.
  const widget = `
(function () {
  'use strict';
  if (window.__wwWidgetMounted) return;
  window.__wwWidgetMounted = true;

  var API_KEY = ${JSON.stringify(apiKey)};
  var API_BASE = ${JSON.stringify(apiBase)};

  // Stable visitor id in localStorage so conversation history persists
  var VISITOR_KEY = 'ww_visitor_id';
  var visitorId = '';
  try {
    visitorId = localStorage.getItem(VISITOR_KEY) || '';
    if (!visitorId) {
      visitorId = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(VISITOR_KEY, visitorId);
    }
  } catch (e) {
    visitorId = 'v_' + Date.now().toString(36);
  }

  // Tiny DOM helpers
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'style') Object.assign(n.style, attrs[k]);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) {
      if (typeof c === 'string') n.appendChild(document.createTextNode(c));
      else if (c) n.appendChild(c);
    });
    return n;
  }

  // ── Floating bubble ───────────────────────────────────────────────
  var BUBBLE_SIZE = 56;
  var bubble = el('div', {
    style: {
      position: 'fixed', right: '20px', bottom: '20px', zIndex: 2147483646,
      width: BUBBLE_SIZE + 'px', height: BUBBLE_SIZE + 'px', borderRadius: '50%',
      background: '#0f766e', color: 'white', cursor: 'pointer',
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      transition: 'transform 0.2s',
    },
    onClick: toggleWindow,
    title: 'Chat with us',
  }, []);
  bubble.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  // ── Chat window ───────────────────────────────────────────────────
  var win = el('div', { style: {
    position: 'fixed', right: '20px', bottom: '90px', zIndex: 2147483647,
    width: '360px', maxHeight: '560px', height: '70vh',
    background: 'white', borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    display: 'none', flexDirection: 'column', overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: '#1a1a1a',
  } });
  var header = el('div', { style: {
    padding: '14px 16px', background: '#0f766e', color: 'white',
    fontWeight: '600', fontSize: '15px', display: 'flex',
    justifyContent: 'space-between', alignItems: 'center',
  }}, ['Chat with us']);
  var closeBtn = el('span', { style: { cursor: 'pointer', fontSize: '20px', lineHeight: '1' }, onClick: toggleWindow }, ['×']);
  header.appendChild(closeBtn);
  var scroll = el('div', { style: {
    flex: '1', overflowY: 'auto', padding: '14px',
    display: 'flex', flexDirection: 'column', gap: '8px',
    fontSize: '14px', lineHeight: '1.5', background: '#f9fafb',
  }});
  var inputRow = el('div', { style: { padding: '10px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: '8px', background: 'white' }});
  var input = el('input', {
    type: 'text', placeholder: 'Type a message…',
    style: { flex: '1', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', outline: 'none' },
    onKeydown: function (e) { if (e.key === 'Enter') send(); },
  });
  var sendBtn = el('button', {
    style: { padding: '10px 16px', background: '#0f766e', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' },
    onClick: send,
  }, ['Send']);
  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);
  win.appendChild(header);
  win.appendChild(scroll);
  win.appendChild(inputRow);

  document.body.appendChild(bubble);
  document.body.appendChild(win);

  function toggleWindow() {
    win.style.display = win.style.display === 'flex' ? 'none' : 'flex';
    if (win.style.display === 'flex' && scroll.children.length === 0) {
      addMessage('assistant', "Hey! Happy to help — what's on your mind?");
    }
    setTimeout(function () { input.focus(); }, 50);
  }

  function addMessage(role, text) {
    var bubble = el('div', { style: {
      maxWidth: '80%', padding: '8px 12px', borderRadius: '14px',
      background: role === 'user' ? '#0f766e' : 'white',
      color: role === 'user' ? 'white' : '#1a1a1a',
      alignSelf: role === 'user' ? 'flex-end' : 'flex-start',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      boxShadow: role === 'user' ? 'none' : '0 1px 2px rgba(0,0,0,0.06)',
    }}, [text]);
    scroll.appendChild(bubble);
    scroll.scrollTop = scroll.scrollHeight;
  }

  function send() {
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    addMessage('user', text);
    var typing = el('div', { style: { color: '#9ca3af', fontStyle: 'italic', alignSelf: 'flex-start', padding: '4px 8px' }}, ['typing…']);
    scroll.appendChild(typing);
    scroll.scrollTop = scroll.scrollHeight;

    fetch(API_BASE + '/api/widget/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: JSON.stringify({ message: text, visitor_id: visitorId }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        typing.remove();
        addMessage('assistant', data.reply || 'Got it — we\\'ll be in touch.');
      })
      .catch(function () {
        typing.remove();
        addMessage('assistant', 'Sorry — something went wrong sending that. Try again?');
      });
  }
})();
`.trim();

  return new Response(widget, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=300', // short cache so updates land
      'Access-Control-Allow-Origin': '*',
    },
  });
}
