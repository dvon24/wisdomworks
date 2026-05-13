/**
 * Booking widget embed loader — `<script src=".../api/widget/booking.js?key=wk_..."></script>`
 *
 * Renders a "Book Now" button. Click → opens a modal with:
 *   1. Service dropdown (loaded from /api/widget/services)
 *   2. Date picker (next 14 days)
 *   3. Time slot list (loaded from /api/widget/availability)
 *   4. Visitor info form (name, email/phone, notes)
 *   5. Submit → /api/widget/book → confirmation
 */

export const dynamic = 'force-dynamic';
export const runtime = 'edge';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const apiKey = url.searchParams.get('key') ?? '';
  const apiBase = url.origin;
  const accent = url.searchParams.get('accent') || '#0f766e';
  const buttonLabel = url.searchParams.get('label') || 'Book Now';

  const widget = `
(function () {
  'use strict';
  if (window.__wwBookingMounted) return;
  window.__wwBookingMounted = true;

  var API_KEY = ${JSON.stringify(apiKey)};
  var API_BASE = ${JSON.stringify(apiBase)};
  var ACCENT = ${JSON.stringify(accent)};
  var BUTTON_LABEL = ${JSON.stringify(buttonLabel)};

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'style') Object.assign(n.style, attrs[k]);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (k === 'html') n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) {
      if (typeof c === 'string') n.appendChild(document.createTextNode(c));
      else if (c) n.appendChild(c);
    });
    return n;
  }

  // ── Trigger button ──
  // Mounts as a floating button OR replaces any element with class
  // 'wisdomworks-book-button' so owners can place it inline if they want.
  var FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  function makeButton() {
    var btn = el('button', {
      style: {
        padding: '12px 20px', background: ACCENT, color: 'white',
        border: 'none', borderRadius: '8px', fontWeight: '600',
        fontSize: '14px', cursor: 'pointer', fontFamily: FONT,
      },
      onClick: openModal,
    }, [BUTTON_LABEL]);
    return btn;
  }

  // Inline mounts
  document.querySelectorAll('.wisdomworks-book-button').forEach(function (slot) {
    slot.innerHTML = '';
    slot.appendChild(makeButton());
  });

  // Floating button (only if no inline slots found)
  if (document.querySelectorAll('.wisdomworks-book-button').length === 0) {
    var floater = makeButton();
    Object.assign(floater.style, {
      position: 'fixed', right: '20px', bottom: '90px', zIndex: 2147483645,
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
    });
    document.body.appendChild(floater);
  }

  // ── Modal infrastructure ──
  var overlay, modal, content;
  var state = { services: [], selectedServiceId: null, selectedDate: null, slots: [], selectedSlot: null };

  function openModal() {
    if (!overlay) buildModal();
    overlay.style.display = 'flex';
    state = { services: [], selectedServiceId: null, selectedDate: null, slots: [], selectedSlot: null };
    renderStep1();
  }

  function closeModal() {
    if (overlay) overlay.style.display = 'none';
  }

  function buildModal() {
    overlay = el('div', { style: {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.5)',
      zIndex: 2147483647, display: 'none', alignItems: 'center', justifyContent: 'center',
      fontFamily: FONT,
    }, onClick: function (e) { if (e.target === overlay) closeModal(); }});
    modal = el('div', { style: {
      width: '90%', maxWidth: '440px', maxHeight: '85vh', overflow: 'auto',
      background: 'white', borderRadius: '12px', boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
      color: '#1a1a1a', position: 'relative',
    }});
    var close = el('span', {
      style: { position: 'absolute', right: '14px', top: '10px', cursor: 'pointer', fontSize: '24px', color: '#9ca3af', lineHeight: '1' },
      onClick: closeModal,
    }, ['×']);
    content = el('div', { style: { padding: '24px' }});
    modal.appendChild(close);
    modal.appendChild(content);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  // ── Step 1: pick service ──
  function renderStep1() {
    content.innerHTML = '';
    content.appendChild(el('h3', { style: { margin: '0 0 16px', fontSize: '18px' }}, ['Book an appointment']));
    var loading = el('div', { style: { color: '#9ca3af' }}, ['Loading services…']);
    content.appendChild(loading);

    fetch(API_BASE + '/api/widget/services', { headers: { 'X-API-Key': API_KEY }})
      .then(function (r) { return r.json(); })
      .then(function (data) {
        loading.remove();
        var services = data.services || [];
        state.services = services;
        if (services.length === 0) {
          content.appendChild(el('div', { style: { color: '#6b7280', fontSize: '14px' }}, [
            'No services available right now. Please reach out directly.',
          ]));
          return;
        }
        services.forEach(function (s) {
          var card = el('div', {
            style: {
              padding: '14px', border: '1px solid #e5e7eb', borderRadius: '8px',
              marginBottom: '8px', cursor: 'pointer', transition: 'background 0.15s',
            },
            onClick: function () {
              state.selectedServiceId = s.id;
              renderStep2();
            },
            onMouseover: function (e) { e.currentTarget.style.background = '#f9fafb'; },
            onMouseout: function (e) { e.currentTarget.style.background = 'white'; },
          }, [
            el('div', { style: { fontWeight: '600', fontSize: '15px' }}, [s.name]),
            el('div', { style: { fontSize: '12.5px', color: '#6b7280', marginTop: '4px' }}, [
              (s.durationMinutes ? s.durationMinutes + ' min' : '') + (s.priceUsd ? '  ·  $' + s.priceUsd.toFixed(2) : ''),
            ]),
            s.description ? el('div', { style: { fontSize: '12px', color: '#9ca3af', marginTop: '6px' }}, [s.description]) : null,
          ].filter(Boolean));
          content.appendChild(card);
        });
      })
      .catch(function () {
        loading.textContent = 'Could not load services. Try again.';
      });
  }

  // ── Step 2: pick time slot ──
  function renderStep2() {
    content.innerHTML = '';
    content.appendChild(el('div', { style: { marginBottom: '12px' }},
      [el('span', { style: { cursor: 'pointer', color: ACCENT, fontSize: '13px' }, onClick: renderStep1 }, ['← Change service'])]));
    content.appendChild(el('h3', { style: { margin: '0 0 12px', fontSize: '17px' }}, ['Pick a time']));
    var loading = el('div', { style: { color: '#9ca3af' }}, ['Loading availability…']);
    content.appendChild(loading);

    fetch(API_BASE + '/api/widget/availability?service=' + encodeURIComponent(state.selectedServiceId) + '&days=14', {
      headers: { 'X-API-Key': API_KEY },
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        loading.remove();
        var slots = data.slots || [];
        if (slots.length === 0) {
          content.appendChild(el('div', { style: { color: '#6b7280', fontSize: '14px' }}, [
            'No open slots in the next 14 days. Try a different service or reach out directly.',
          ]));
          return;
        }
        // Group slots by date
        var byDate = {};
        slots.forEach(function (s) {
          var d = new Date(s.startAt);
          var key = d.toDateString();
          if (!byDate[key]) byDate[key] = [];
          byDate[key].push(s);
        });
        Object.keys(byDate).forEach(function (dateKey) {
          var dateLabel = new Date(dateKey).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
          content.appendChild(el('div', { style: { fontSize: '13px', fontWeight: '600', margin: '12px 0 6px', color: '#374151' }}, [dateLabel]));
          var row = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' }});
          byDate[dateKey].slice(0, 12).forEach(function (slot) {
            var time = new Date(slot.startAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            var btn = el('button', {
              style: {
                padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
                background: 'white', fontSize: '13px', cursor: 'pointer', fontFamily: FONT,
              },
              onClick: function () {
                state.selectedSlot = slot;
                renderStep3();
              },
              onMouseover: function (e) { e.currentTarget.style.background = '#f9fafb'; e.currentTarget.style.borderColor = ACCENT; },
              onMouseout: function (e) { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#d1d5db'; },
            }, [time]);
            row.appendChild(btn);
          });
          content.appendChild(row);
        });
      })
      .catch(function () {
        loading.textContent = 'Could not load availability. Try again.';
      });
  }

  // ── Step 3: contact info form ──
  function renderStep3() {
    content.innerHTML = '';
    content.appendChild(el('div', { style: { marginBottom: '12px' }},
      [el('span', { style: { cursor: 'pointer', color: ACCENT, fontSize: '13px' }, onClick: renderStep2 }, ['← Change time'])]));
    var selectedTime = new Date(state.selectedSlot.startAt).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    content.appendChild(el('div', { style: {
      padding: '10px 12px', background: '#f0fdfa', borderRadius: '6px', marginBottom: '16px',
      fontSize: '13.5px', color: '#0f766e', fontWeight: '500',
    }}, [selectedTime]));

    var nameInput = inputField('Your name', 'name', true);
    var emailInput = inputField('Email', 'email');
    var phoneInput = inputField('Phone (optional)', 'tel');
    var notesInput = el('textarea', {
      style: { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', fontFamily: FONT, marginBottom: '12px', minHeight: '60px', boxSizing: 'border-box' },
      placeholder: 'Anything we should know? (optional)',
    });
    content.appendChild(nameInput);
    content.appendChild(emailInput);
    content.appendChild(phoneInput);
    content.appendChild(notesInput);

    var error = el('div', { style: { color: '#dc2626', fontSize: '13px', marginBottom: '8px', display: 'none' }});
    content.appendChild(error);

    var submitBtn = el('button', {
      style: {
        width: '100%', padding: '12px', background: ACCENT, color: 'white',
        border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '600',
        cursor: 'pointer', fontFamily: FONT,
      },
      onClick: function () {
        var name = nameInput.value.trim();
        var email = emailInput.value.trim();
        var phone = phoneInput.value.trim();
        if (!name) { error.textContent = 'Please enter your name.'; error.style.display = 'block'; return; }
        if (!email && !phone) { error.textContent = 'Email or phone required.'; error.style.display = 'block'; return; }
        error.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Booking…';

        fetch(API_BASE + '/api/widget/book', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
          body: JSON.stringify({
            service_id: state.selectedServiceId,
            start_at: state.selectedSlot.startAt,
            name: name, email: email || undefined, phone: phone || undefined,
            notes: notesInput.value.trim() || undefined,
          }),
        })
          .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
          .then(function (res) {
            if (!res.ok) {
              error.textContent = res.data.error || 'Booking failed.';
              error.style.display = 'block';
              submitBtn.disabled = false;
              submitBtn.textContent = 'Confirm booking';
              return;
            }
            renderConfirmation(name);
          })
          .catch(function () {
            error.textContent = 'Network error. Try again.';
            error.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Confirm booking';
          });
      },
    }, ['Confirm booking']);
    content.appendChild(submitBtn);
  }

  function inputField(placeholder, type, required) {
    var n = el('input', {
      type: type || 'text', placeholder: placeholder + (required ? ' *' : ''),
      style: { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '14px', fontFamily: FONT, marginBottom: '8px', boxSizing: 'border-box' },
    });
    return n;
  }

  function renderConfirmation(name) {
    content.innerHTML = '';
    var when = new Date(state.selectedSlot.startAt).toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    content.appendChild(el('div', { style: { textAlign: 'center', padding: '20px 0' }}, [
      el('div', { style: { fontSize: '40px', marginBottom: '12px' }}, ['✓']),
      el('div', { style: { fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}, ['You\\'re booked, ' + name + '!']),
      el('div', { style: { fontSize: '14px', color: '#6b7280' }}, [when]),
    ]));
    content.appendChild(el('button', {
      style: {
        width: '100%', marginTop: '16px', padding: '12px', background: ACCENT, color: 'white',
        border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: '600',
        cursor: 'pointer', fontFamily: FONT,
      },
      onClick: closeModal,
    }, ['Done']));
  }
})();
`.trim();

  return new Response(widget, {
    headers: {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
