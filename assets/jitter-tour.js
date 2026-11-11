(() => {
  const viewport = document.getElementById('tour-window');
  const controls = document.querySelector('.tour-controls');
  if (!viewport || !controls) return;

  const strokes = {
    phone: '<path d="m7 3 3 4-2 2c1 3 4 6 7 7l2-2 4 3c-1 4-3 5-6 4C9 19 5 15 3 9 2 6 3 4 7 3Z"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    send: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
    compose: '<path d="m14 5 5 5M5 19l4-1L21 6l-4-4L5 14v5Z"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${strokes[name]}</svg>`;
  const avatar = (initials, color = '') => `<span class="jt-avatar ${color}">${initials}</span>`;
  const contacts = [
    ['NP', 'plum', 'Nina Park', 'Perfect. See you at eight.'],
    ['ML', 'moss', 'Miles Lee', 'Just sent it over'],
    ['SS', 'slate', 'Studio session', 'Avery: On my way'],
  ];
  const sidebar = `<aside class="jt-sidebar">
    <div class="jt-sidebar-title">Jitter ${icon('compose')}</div>
    <div class="jt-switch"><b>Friends</b><span>Servers</span></div>
    <div class="jt-search">${icon('search')} Search conversations…</div>
    ${contacts.map(([initials, color, name, message], index) => `<div class="jt-contact ${index ? '' : 'jt-active'}">
      ${avatar(initials, color)}<div><b>${name}</b><small>${message}</small></div></div>`).join('')}
    <div class="jt-user">${avatar('AL', 'slate')} Alex Lane</div>
  </aside>`;
  const contactHeader = `<div class="jt-header">${avatar('NP', 'plum')}<div><b>Nina Park</b><small><i></i> Online</small></div>${icon('phone')}</div>`;
  const messages = `${contactHeader}<div class="jt-thread">
    <span class="jt-time">Today, 7:42 PM</span>
    <p class="jt-bubble">Still on for the listening session?</p>
    <p class="jt-bubble jt-outgoing">Yep. I’ve got the first track ready.</p>
    <p class="jt-bubble">Perfect. See you at eight.</p>
  </div><div class="jt-compose"><span>Message</span>${icon('send')}</div>`;
  const calls = `<div class="jt-header"><b>Voice call</b></div><div class="jt-call-stage">
    ${avatar('NP', 'plum')}<b>Nina Park</b><span>Connected <span aria-hidden="true">·</span> 02:18</span>
    <div class="jt-level" aria-hidden="true">${[4,8,16,10,20,13,7,12,18,6,11,4].map(h => `<i style="height:${h}px"></i>`).join('')}</div>
  </div>`;
  const themeRow = (name, description, theme) => `<div class="jt-theme-row">
    <span class="jt-swatch ${theme}"><i></i><i></i></span>
    <div><b>${name}</b><small>${description}</small></div>${theme === 'original' ? '<span class="jt-check">✓</span>' : ''}</div>`;
  const appearance = `<div class="jt-header"><b>Settings / Appearance</b></div><div class="jt-themes">
    ${themeRow('Original', 'Blue bubbles on black', 'original')}
    ${themeRow('Gig Listing', 'Paper, ink and vermilion', 'gig')}
    ${themeRow('Double Take', 'Ultramarine and apricot', 'double')}
    ${themeRow('Late Night', 'Plum black and signal red', 'late')}
  </div>`;
  const screens = {
    messages: ['A conversation with Nina Park', messages],
    calls: ['A connected voice call with Nina Park', calls],
    appearance: ['The Jitter appearance settings', appearance],
  };
  const buttons = [...controls.querySelectorAll('button[data-screen]')];
  function show(name) {
    const [description, content] = screens[name];
    viewport.innerHTML = `<div class="jt-client" role="img" aria-label="${description}">
      <div class="jt-titlebar"><span class="jt-lights"><i></i><i></i><i></i></span>Jitter</div>
      <div class="jt-layout">${sidebar}<div class="jt-pane">${content}</div></div></div>`;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.screen === name)));
  }
  buttons.forEach(button => button.addEventListener('click', () => show(button.dataset.screen)));
  show('messages');
  controls.hidden = false;
})();
