// PWA : enregistrement du Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// Onglets de recherche (accueil)
document.querySelectorAll('.search-tabs .tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.search-tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.search-pane').forEach((p) => {
      p.classList.toggle('active', p.dataset.pane === target);
    });
  });
});

// Menu mobile
const navToggle = document.getElementById('navToggle');
const mainNav = document.getElementById('mainNav');
if (navToggle && mainNav) {
  navToggle.addEventListener('click', () => mainNav.classList.toggle('open'));
}

// Auto-submit des filtres : changer un select ou cocher une case applique le filtre immédiatement.
document.querySelectorAll('form.filters').forEach((form) => {
  form.querySelectorAll('select, input[type="checkbox"]').forEach((el) => {
    el.addEventListener('change', () => form.submit());
  });
});

// Header : ajoute la classe .scrolled dès qu'on défile (effet ombre + bordure).
const header = document.querySelector('.site-header');
if (header) {
  const updateHeader = () => header.classList.toggle('scrolled', window.scrollY > 4);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });
}

// Reveal au scroll via IntersectionObserver.
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const revealTargets = document.querySelectorAll('.reveal, .reveal-children');
if (revealTargets.length) {
  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealTargets.forEach((el) => el.classList.add('in-view'));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in-view');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    revealTargets.forEach((el) => io.observe(el));
  }
}

// Autocomplete sur les champs de recherche (médicament / pharmacie / médecin).
// Appelle /api/suggest?kind=...&q=... et affiche les propositions en dessous.
(function () {
  const inputs = document.querySelectorAll('input[data-suggest]');
  if (!inputs.length) return;

  let activeIdx = -1;

  const debounce = (fn, ms) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  inputs.forEach((input) => {
    const wrap = document.createElement('div');
    wrap.className = 'suggest-list';
    wrap.setAttribute('role', 'listbox');
    input.parentNode.insertBefore(wrap, input.nextSibling);

    const close = () => {
      wrap.classList.remove('open');
      wrap.innerHTML = '';
      activeIdx = -1;
    };

    const render = (items) => {
      if (!items.length) {
        wrap.innerHTML = '<div class="suggest-empty">Aucun résultat</div>';
        wrap.classList.add('open');
        return;
      }
      wrap.innerHTML = items
        .map(
          (it, i) =>
            `<a class="suggest-item" data-i="${i}" href="${it.url}">
               <span class="suggest-icon">${it.icon}</span>
               <span class="suggest-text">
                 <strong>${it.title}</strong>
                 <small>${it.subtitle}</small>
               </span>
               <span class="suggest-arrow">→</span>
             </a>`
        )
        .join('');
      wrap.classList.add('open');
      activeIdx = -1;
    };

    const fetchSuggest = debounce(async (q) => {
      if (q.length < 2) return close();
      try {
        const r = await fetch(`/api/suggest?kind=${input.dataset.suggest}&q=${encodeURIComponent(q)}`);
        const data = await r.json();
        render(data.items || []);
      } catch (e) {
        close();
      }
    }, 180);

    input.addEventListener('input', (e) => fetchSuggest(e.target.value.trim()));
    input.addEventListener('focus', (e) => {
      const v = e.target.value.trim();
      if (v.length >= 2) fetchSuggest(v);
    });

    input.addEventListener('keydown', (e) => {
      const items = wrap.querySelectorAll('.suggest-item');
      if (!items.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIdx = (activeIdx + 1) % items.length;
        items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIdx = (activeIdx - 1 + items.length) % items.length;
        items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        window.location.href = items[activeIdx].getAttribute('href');
      } else if (e.key === 'Escape') {
        close();
      }
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target) && e.target !== input) close();
    });
  });
})();

// Compteurs animés (data-count="123").
const counters = document.querySelectorAll('.stat-num[data-count]');
if (counters.length) {
  const animateCount = (el) => {
    const target = Number(el.dataset.count) || 0;
    if (reduceMotion) { el.textContent = target.toLocaleString('fr-FR'); return; }
    const duration = 1400;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(target * eased);
      el.textContent = val.toLocaleString('fr-FR');
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if (!('IntersectionObserver' in window)) {
    counters.forEach(animateCount);
  } else {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          animateCount(e.target);
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.5 });
    counters.forEach((el) => io.observe(el));
  }
}
