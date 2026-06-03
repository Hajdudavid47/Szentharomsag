/* ============================================================
   SZENTHÁROMSÁG – SHARED SCRIPTS
   Scroll reveal + announcement banner loader
   Include this before </body> on every public page
   ============================================================ */

(function () {
  'use strict';

  // ── SCROLL REVEAL ──────────────────────────────────────────
  function initScrollReveal() {
    const targets = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
    if (!targets.length) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    targets.forEach(el => observer.observe(el));
  }

  // ── ANNOUNCEMENT BANNER ────────────────────────────────────
  async function loadAnnouncementBanner() {
    try {
      const res = await fetch('/api/announcements');
      if (!res.ok) return;
      const announcements = await res.json();

      // Only show active ones not dismissed in this session
      const active = announcements.filter(a => {
        if (!a.active) return false;
        const dismissed = sessionStorage.getItem('ann_dismissed_' + a.id);
        return !dismissed;
      });

      if (!active.length) return;

      // Show most recent active announcement
      const ann = active[0];
      const banner = document.createElement('div');
      banner.className = 'announcement-banner';
      banner.id = 'ann-banner-' + ann.id;
      banner.innerHTML = `
        <div class="container">
          <span class="ann-icon"><i class="bi bi-megaphone-fill"></i></span>
          <span class="ann-text">${ann.text}</span>
          <button class="ann-close" aria-label="Bezárás" onclick="dismissAnnouncement('${ann.id}')">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>
      `;

      // Insert after navbar (fixed-top), before main content
      const navbar = document.querySelector('.navbar');
      if (navbar && navbar.nextSibling) {
        navbar.parentNode.insertBefore(banner, navbar.nextSibling);
      } else {
        document.body.prepend(banner);
      }

      // Adjust body top padding so hero/content isn't hidden behind banner
      const bannerH = banner.offsetHeight;
      document.body.style.paddingTop = bannerH + 'px';

      // Recalculate after fonts load
      window.addEventListener('load', () => {
        document.body.style.paddingTop = banner.offsetHeight + 'px';
      });
    } catch (e) {
      // Silently fail — announcements are optional
    }
  }

  window.dismissAnnouncement = function (id) {
    sessionStorage.setItem('ann_dismissed_' + id, '1');
    const banner = document.getElementById('ann-banner-' + id);
    if (banner) {
      banner.style.transition = 'opacity 0.3s, max-height 0.4s';
      banner.style.opacity = '0';
      banner.style.maxHeight = '0';
      banner.style.overflow = 'hidden';
      banner.style.padding = '0';
      banner.style.borderWidth = '0';
      setTimeout(() => {
        banner.remove();
        document.body.style.paddingTop = '';
      }, 420);
    }
  };

  // ── HERO ANIMATE CLASS ─────────────────────────────────────
  function initHeroAnimate() {
    const hero = document.querySelector('.hero');
    if (hero) hero.classList.add('hero-animate');

    // Wrap chip flex row for grouped animation
    const chipRow = document.querySelector('.hero .d-flex.flex-wrap');
    if (chipRow) chipRow.classList.add('chip-row');
  }

  // ── INIT ───────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    initHeroAnimate();
    initScrollReveal();
    loadAnnouncementBanner();
  });
})();
