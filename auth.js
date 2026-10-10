'use strict';

(async function () {
  let me = null;
  try {
    const r = await fetch('/api/me');
    if (r.ok) me = await r.json();
  } catch {}

  const path      = location.pathname;
  const isLanding = path === '/' || path.endsWith('index.html');

  if (!me) {
    if (!isLanding) location.href = '/';
    return;
  }

  if (isLanding) {
    const hasBlocking = (me.punishments || []).some(p => p.blocking);
    location.href = (hasBlocking || !me.inGuild) ? '/punishment.html' : '/profile.html';
    return;
  }

  const currentPage = path.split('/').pop();

  const blockingPunishments = (me.punishments || []).filter(p => p.blocking);
  if (blockingPunishments.length > 0 && currentPage !== 'punishment.html') {
    location.href = '/punishment.html';
    return;
  }

  if (!me.inGuild && currentPage !== 'punishment.html' && currentPage !== 'profile.html') {
    location.href = '/punishment.html';
    return;
  }

  const guildOnlyPages = ['events.html', 'leaderboard.html', 'staff.html', 'clan.html'];
  if (!me.inGuild && guildOnlyPages.includes(currentPage)) {
    location.href = '/punishment.html';
    return;
  }

  if (currentPage === 'staff.html' && me.access?.level !== 'admin') {
    showAccessDenied();
    return;
  }

  document.querySelectorAll('.nav-avatar').forEach(el => {
    if (me.avatar) {
      el.style.background = `url(https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.webp?size=64) center/cover`;
      el.style.backgroundSize = 'cover';
      el.textContent = '';
    } else {
      el.textContent = ((me.serverNick || me.username) || '??').slice(0, 2).toUpperCase();
    }
  });

  document.querySelectorAll('.nav-username').forEach(el => {
    el.textContent = me.serverNick || me.username || me.id;
  });

  const staffLink = document.getElementById('nav-staff-link');
  if (staffLink) {
    staffLink.style.display = (me.access?.level === 'admin') ? '' : 'none';
  }

  document.querySelectorAll('.nav-logout').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); location.href = '/auth/logout'; });
  });

  if (currentPage === 'profile.html' && location.search.includes('not_member')) {
    showNotMemberBanner();
  }

  if (currentPage === 'profile.html' && !me.inGuild) {
    showNotMemberBanner();
  }

  function showNotMemberBanner() {
    if (document.getElementById('not-member-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'not-member-banner';
    banner.style.cssText = `
      background:rgba(224,85,85,0.08);border-bottom:1px solid rgba(224,85,85,0.2);
      padding:14px 32px;display:flex;align-items:center;gap:12px;position:relative;z-index:10;
    `;
    banner.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e05555" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span style="font-size:13px;color:#e05555;font-weight:600">Ты не являешься участником сервера Talori — показаны только данные твоего Discord аккаунта</span>
    `;
    const nav = document.querySelector('nav');
    if (nav) nav.insertAdjacentElement('afterend', banner);
  }

  function showAccessDenied() {
    const page = document.querySelector('.page');
    if (!page) return;
    page.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:120px 32px;text-align:center;gap:20px">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <div style="font-family:'Unbounded',sans-serif;font-size:22px;font-weight:900;color:var(--text-3)">Нет доступа</div>
        <div style="font-size:14px;color:var(--text-3);max-width:360px">Страница стаффа доступна только членам команды</div>
        <a href="/profile.html" style="margin-top:8px;font-size:13px;font-weight:600;color:var(--accent);text-decoration:none;padding:10px 24px;border:1px solid rgba(200,184,154,0.2);border-radius:8px">Вернуться к профилю</a>
      </div>`;
  }
})();
