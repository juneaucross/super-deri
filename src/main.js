import "plyr/dist/plyr.css";
import { initVideoLoader } from "./videoLoader.js";

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
  /** До клика метаданные не подгружаем; превью — отдельный video с preload metadata. */
  preload: "none",
};

const plyrGloballyTracked = [];

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
  /** Индекс слайда при последнем slideChanged; null до первого события. */
  let lastNotifiedSlideIndex = null;

  slides.forEach((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "carousel__dot";
    b.setAttribute("aria-label", `Слайд ${i + 1}`);
    b.addEventListener("click", () => go(i));
    dotsWrap.appendChild(b);
  });

  function step() {
    if (slides.length < 2) return 0;
    const a = slides[0].getBoundingClientRect();
    const b = slides[1].getBoundingClientRect();
    return b.left + b.width / 2 - (a.left + a.width / 2);
  }

  function update() {
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
      if (i === index) {
        player.play().catch(() => {});
      } else {
        player.pause();
      }
    });

    if (lastNotifiedSlideIndex !== index) {
      const leavingSlide =
        lastNotifiedSlideIndex != null &&
        lastNotifiedSlideIndex >= 0 &&
        lastNotifiedSlideIndex < slides.length
          ? slides[lastNotifiedSlideIndex]
          : null;
      lastNotifiedSlideIndex = index;
      root.dispatchEvent(
        new CustomEvent("slideChanged", {
          bubbles: true,
          detail: {
            carousel: root,
            activeSlide: slides[index],
            leavingSlide,
          },
        }),
      );
    }
  }

  function go(i) {
    index = Math.max(0, Math.min(slides.length - 1, i));
    update();
  }

  root.__carouselGo = go;

  root.addEventListener("deri:plyr", (e) => {
    const { type, slide, player } = e.detail || {};
    if (!root.contains(slide)) return;
    if (type === "mount") slidePlayer.set(slide, player);
    else if (type === "unmount") slidePlayer.delete(slide);
  });

  slides.forEach((slide, i) => {
    slide.addEventListener("click", (e) => {
      if (e.target.closest(".video-facade")) return;
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

  window.addEventListener("resize", () => update());
  update();
}

document.querySelectorAll("[data-carousel]").forEach(initCarousel);

initVideoLoader({
  plyrOptions,
  plyrTracked: plyrGloballyTracked,
});
