// Scroll effects: reveal-on-scroll, parallax, timeline progress, nav behaviour.
// All of it is progressive enhancement and is skipped for prefers-reduced-motion.
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const $ = (id) => document.getElementById(id);
const visible = new Set();
const heroLayers = new Set();
let ticking = false;
let lastY = 0;

const revealIO = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('in');
      revealIO.unobserve(e.target);
    }
  },
  { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
);

const parallaxIO = new IntersectionObserver(
  (entries) => {
    for (const e of entries) (e.isIntersecting ? visible.add(e.target) : visible.delete(e.target));
    schedule();
  },
  { rootMargin: '25% 0px' }
);

function schedule() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(update);
}

function update() {
  ticking = false;
  const y = scrollY;
  const nav = $('nav');
  nav.toggleAttribute('data-solid', y > 40);
  nav.toggleAttribute('data-hide', y > lastY && y > 320);
  lastY = y;
  if (reduce.matches) return;

  const vh = innerHeight;
  // Hero layers depend only on the scroll position, so they are always kept current. Gating them on the
  // observer left a stale offset (avatar and name pushed out of view) after a mid-page reload and a fast scroll back up.
  for (const n of heroLayers) n.style.setProperty('--py', `${(Math.max(0, y) * Number(n.dataset.parallax)).toFixed(1)}px`);
  for (const n of visible) {
    if ('pscroll' in n.dataset) continue;
    const r = n.getBoundingClientRect();
    const offset = (vh / 2 - (r.top + r.height / 2)) * (Number(n.dataset.parallax) || 0); // relative to viewport centre
    n.style.setProperty('--py', `${offset.toFixed(1)}px`);
  }

  const tl = $('timeline');
  if (tl) {
    const r = tl.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (vh * 0.7 - r.top) / r.height));
    tl.style.setProperty('--p', p.toFixed(3));
    // A milestone's dot appears and lights up only once the progress line reaches it.
    const lineY = r.top + p * r.height;
    for (const li of tl.children) li.classList.toggle('reached', li.getBoundingClientRect().top + parseFloat(getComputedStyle(li.firstElementChild).fontSize) / 2 <= lineY + 1);
  }
}

// Call after (re)rendering dynamic content.
export function refresh(root = document) {
  root.querySelectorAll('[data-reveal]:not([data-bound])').forEach((n, i) => {
    n.dataset.bound = '1';
    n.style.setProperty('--d', `${(i % 5) * 70}ms`);
    if (reduce.matches) n.classList.add('in');
    else revealIO.observe(n);
  });
  root.querySelectorAll('[data-parallax]:not([data-pbound])').forEach((n) => {
    n.dataset.pbound = '1';
    if ('pscroll' in n.dataset) heroLayers.add(n);
    else parallaxIO.observe(n);
  });
  schedule();
}

// Falling sakura petals. Each petal gets its own size, speed and drift. Two flavours:
// a gentle hero, and an even calmer closing page (fewer, slower, fainter, kept to the sides).
const rnd = (lo, hi) => lo + Math.random() * (hi - lo);

function makePetals(box, { count, duration, size = [9, 18], opacity = 0.85, sides = false }) {
  if (!box || reduce.matches || box.childElementCount) return;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const t = rnd(...duration);
    const sway = rnd(20, 60) * (Math.random() < 0.5 ? -1 : 1);
    // On the closing page keep petals off the centre column where the quote sits.
    const x = sides ? (Math.random() < 0.5 ? rnd(2, 24) : rnd(76, 98)) : rnd(0, 100);
    p.style.cssText = [
      `--x:${x.toFixed(1)}%`, `--s:${rnd(...size).toFixed(1)}px`, `--t:${t.toFixed(1)}s`, `--tt:${rnd(3, 6).toFixed(1)}s`,
      `--dl:${(-rnd(0, t)).toFixed(1)}s`, `--dx:${(sides ? rnd(-50, 50) : rnd(-60, 170)).toFixed(0)}px`, `--sw:${sway.toFixed(0)}px`,
      `--r:${rnd(360, 900).toFixed(0)}deg`, `--b:${Math.random() < 0.3 ? '1.2px' : '0px'}`, `--o:${opacity}`,
    ].join(';');
    box.append(p);
  }
  // Only animate while on screen.
  new IntersectionObserver(([e]) => box.classList.toggle('paused', !e.isIntersecting)).observe(box.parentElement);
}

export function initMotion() {
  const narrow = innerWidth < 600;
  makePetals(document.querySelector('.hero .petals'), { count: narrow ? 5 : 8, duration: [16, 28], size: [9, 16], opacity: 0.7 });
  makePetals(document.querySelector('.closing .petals'), {
    count: narrow ? 5 : 8, duration: [22, 34], size: [8, 14], opacity: 0.55, sides: true,
  });
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  reduce.addEventListener('change', () => location.reload());
  refresh();
}
