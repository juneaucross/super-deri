import Plyr from "plyr";
import "plyr/dist/plyr.css";

const NAV_SCROLL_GAP = 8;

// In-page links: scroll so the target sits just below the fixed nav (not mid-viewport).
(() => {
  const nav = document.getElementById("siteNav");
  if (!nav) return;

  function prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function navOffsetPx() {
    return nav.getBoundingClientRect().height + NAV_SCROLL_GAP;
  }

  function scrollToHash(id, { instant = false } = {}) {
    const behavior = instant || prefersReducedMotion() ? "auto" : "smooth";

    if (!id || id === "top") {
      window.scrollTo({ top: 0, behavior });
      return;
    }

    const el = document.getElementById(id);
    if (!el) return;

    const y = el.getBoundingClientRect().top + window.scrollY - navOffsetPx();
    window.scrollTo({ top: Math.max(0, y), behavior });
  }

  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    const href = a.getAttribute("href");
    if (!href || href === "#") return;

    a.addEventListener("click", (e) => {
      const id = decodeURIComponent(href.slice(1));
      if (id !== "top" && !document.getElementById(id)) return;

      e.preventDefault();
      scrollToHash(id);
      history.pushState(null, "", href);
    });
  });

  function scrollFromLocation() {
    const id = decodeURIComponent(location.hash.replace(/^#/, ""));
    scrollToHash(id || "top", { instant: true });
  }

  window.addEventListener("hashchange", scrollFromLocation);
  window.addEventListener("popstate", scrollFromLocation);

  if (location.hash) {
    requestAnimationFrame(() => scrollFromLocation());
  }
})();

const plyrOptions = {
  controls: [
    "play-large",
    "play",
    "progress",
    "current-time",
    "mute",
    "volume",
  ],
  autopause: true,
  loop: { active: true },
  clickToPlay: true,
  hideControls: true,
  fullscreen: { enabled: false },
};

const plyrGloballyTracked = [];

function pauseAllPlyrsExcept(except) {
  for (const p of plyrGloballyTracked) {
    if (p !== except) p.pause();
  }
}

// Hamburger toggle
(() => {
  const nav = document.getElementById("siteNav");
  const burger = nav.querySelector(".site-nav__burger");
  const mobile = nav.querySelector(".site-nav__mobile");
  burger.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    document.body.classList.toggle("has-mobile-menu", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
  });
  mobile.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      nav.classList.remove("is-open");
      document.body.classList.remove("has-mobile-menu");
      burger.setAttribute("aria-expanded", "false");
    }),
  );
})();

// Lazy-activate per carousel: once it first enters viewport, attach sources for all slides.
// Important for iOS: avoid re-attaching/removing src while swiping, it can cause play/pause thrashing.
const CAROUSEL_LAZY_MARGIN = "200px";

const POSTER_JPEG_QUALITY = 0.85;
const POSTER_MAX_WIDTH = 1280;

function parsePosterAtSec(root) {
  const raw = root.dataset.posterAt;
  if (raw == null || raw === "") return null;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Seek underlying HTMLMediaElement, rasterize frame, then set Plyr poster.
 * Important: Plyr ignores native `video.poster` for idle preview—it uses `.plyr__poster`
 * populated via `player.poster` (see plyr readme / setPoster → backgroundImage).
 */
function capturePlyrPosterFrame(player, timeSec, { capturingPoster, onDone }) {
  const video = player.media;
  if (!(video instanceof HTMLMediaElement)) return;

  capturingPoster.add(video);

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    capturingPoster.delete(video);
    video.pause();
    video.currentTime = 0;
    onDone?.();
  };

  function applyPosterDataUrl(url) {
    if (!url) {
      finish();
      return;
    }
    const img = new Image();
    img.onload = () => {
      player.poster = url;
      finish();
    };
    img.onerror = () => finish();
    img.src = url;
  }

  const seekAndGrab = () => {
    const dur = video.duration;
    if (!Number.isFinite(dur) || dur <= 0) {
      finish();
      return;
    }
    const t = Math.min(timeSec, Math.max(0, dur - 0.05));
    const onSeeked = () => {
      try {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w > 0 && h > 0) {
          let tw = w;
          let th = h;
          if (w > POSTER_MAX_WIDTH) {
            tw = POSTER_MAX_WIDTH;
            th = Math.round((h * POSTER_MAX_WIDTH) / w);
          }
          const canvas = document.createElement("canvas");
          canvas.width = tw;
          canvas.height = th;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(video, 0, 0, tw, th);
            applyPosterDataUrl(canvas.toDataURL("image/jpeg", POSTER_JPEG_QUALITY));
            return;
          }
        }
      } catch {
        /* CORS or canvas taint */
      }
      finish();
    };
    if (Math.abs(video.currentTime - t) < 1e-3) {
      onSeeked();
    } else {
      video.addEventListener("seeked", onSeeked, { once: true });
      video.currentTime = t;
    }
  };

  video.addEventListener(
    "error",
    () => {
      finish();
    },
    { once: true },
  );

  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    seekAndGrab();
  } else {
    video.addEventListener("loadedmetadata", seekAndGrab, { once: true });
  }
}

// Generic carousel — applied to every [data-carousel]
function initCarousel(root) {
  const viewport = root.querySelector(".carousel__viewport");
  const track = root.querySelector(".carousel__track");
  const slides = Array.from(track.children);
  const prev = root.querySelector("[data-prev]");
  const next = root.querySelector("[data-next]");
  const dotsWrap = root.querySelector(".carousel__dots");
  const slidePlayer = new Map();
  let index = Math.floor(slides.length / 2);
  let inView = false;
  let activated = false;
  const posterAtSec = parsePosterAtSec(root);
  const capturingPoster = new WeakSet();

  slides.forEach((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "carousel__dot";
    b.setAttribute("aria-label", `Слайд ${i + 1}`);
    b.addEventListener("click", () => go(i));
    dotsWrap.appendChild(b);
  });

  function resolvedSrc(url) {
    try {
      return new URL(url, document.baseURI).href;
    } catch {
      return url;
    }
  }

  function syncVideoLoading() {
    slides.forEach((slide) => {
      const video = slide.querySelector("video.js-plyr");
      if (!video) return;
      const player = slidePlayer.get(slide);
      const url = video.dataset.src;
      if (!url) return;

      const shouldHaveSrc = activated;
      if (shouldHaveSrc) {
        const want = resolvedSrc(url);
        if (video.src !== want) {
          video.src = url;
          video.load();
          if (posterAtSec != null && player) {
            capturePlyrPosterFrame(player, posterAtSec, {
              capturingPoster,
              onDone: () => {
                if (inView) update();
              },
            });
          }
        }
        video.preload = "metadata";
      } else {
        // Before first viewport entry, keep deferred.
        video.preload = "none";
      }
    });
  }

  function applyInView(next) {
    if (next === inView) return;
    inView = next;
    if (!inView) {
      slides.forEach((sl) => {
        const p = slidePlayer.get(sl);
        if (p) p.pause();
      });
    }
    update();
  }

  function step() {
    if (slides.length < 2) return 0;
    const a = slides[0].getBoundingClientRect();
    const b = slides[1].getBoundingClientRect();
    return b.left + b.width / 2 - (a.left + a.width / 2);
  }
  function update() {
    syncVideoLoading();
    const s = step();
    const offset = (slides.length / 2 - 0.5 - index) * s;
    track.style.transform = `translateX(${offset}px)`;
    slides.forEach((sl, i) => sl.classList.toggle("is-active", i === index));
    dotsWrap
      .querySelectorAll(".carousel__dot")
      .forEach((d, i) => d.classList.toggle("is-active", i === index));
    prev.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    slides.forEach((sl, i) => {
      const player = slidePlayer.get(sl);
      if (!player) return;
      const video = sl.querySelector("video.js-plyr");
      if (i === index) {
        if (video && capturingPoster.has(video)) return;
        player.play().catch(() => {});
      } else {
        player.pause();
      }
    });
  }
  function go(i) {
    index = Math.max(0, Math.min(slides.length - 1, i));
    update();
  }

  slides.forEach((slide, slideIndex) => {
    const video = slide.querySelector("video.js-plyr");
    if (!video) return;
    const player = new Plyr(video, plyrOptions);
    slidePlayer.set(slide, player);
    plyrGloballyTracked.push(player);
    player.on("play", () => {
      pauseAllPlyrsExcept(player);
      go(slideIndex);
    });
  });

  slides.forEach((slide, i) => {
    slide.addEventListener("click", (e) => {
      if (e.target.closest(".plyr__controls")) return;
      if (e.target.closest(".plyr")) {
        if (i !== index) go(i);
        return;
      }
      go(i);
    });
  });

  prev.addEventListener("click", () => go(index - 1));
  next.addEventListener("click", () => go(index + 1));

  // Touch swipe
  let startX = null;
  viewport.addEventListener(
    "touchstart",
    (e) => {
      startX = e.touches[0].clientX;
    },
    { passive: true },
  );
  viewport.addEventListener("touchend", (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1));
    startX = null;
  });

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.target !== root) continue;
        if (!activated && e.isIntersecting) {
          activated = true;
          applyInView(true);
          io.unobserve(root);
          io.disconnect();
        }
      }
    },
    {
      root: null,
      rootMargin: CAROUSEL_LAZY_MARGIN,
      threshold: 0,
    },
  );
  io.observe(root);

  window.addEventListener("resize", update);
  update();
}
document.querySelectorAll("[data-carousel]").forEach(initCarousel);
