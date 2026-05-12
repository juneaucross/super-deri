/**
 * Умная загрузка: IntersectionObserver (снятие Plyr при уходе из вьюпорта), Plyr по клику (WebM, без HLS).
 */

const VIDEO_PROBE_MS = 15000;

const IO_OPTIONS = {
  root: null,
  rootMargin: "200px",
  threshold: 0.5,
};

/**
 * Отладка / стили: loading | playing | error
 * @param {HTMLElement | null} facade
 * @param {"loading" | "playing" | "error" | null | ""} value
 */
function setVideoState(facade, value) {
  if (!facade) return;
  if (!value) {
    facade.removeAttribute("data-video-state");
    return;
  }
  facade.setAttribute("data-video-state", value);
}

function resolvedSrc(url) {
  try {
    return new URL(url, document.baseURI).href;
  } catch {
    return url;
  }
}

function findCarouselGo(facade) {
  const root = facade.closest("[data-carousel]");
  return root && typeof root.__carouselGo === "function" ? root.__carouselGo : null;
}

function slideIndex(facade) {
  const slide = facade.closest(".carousel__slide");
  const track = slide?.parentElement;
  if (!slide || !track) return -1;
  return Array.from(track.children).indexOf(slide);
}

function getObservedEl(state) {
  return state.facadeEl;
}

function unobserveEl(observer, state) {
  const el = getObservedEl(state);
  if (el) observer.unobserve(el);
}

function observeEl(observer, state) {
  const el = getObservedEl(state);
  if (el) observer.observe(el);
}

function removePreviewVideo(facade) {
  const v = facade.querySelector(".video-facade__preview");
  if (v) {
    v.removeAttribute("src");
    v.load();
    v.remove();
  }
  facade.classList.remove("video-facade--preview");
}

function destroyPreview(facade, state) {
  if (!facade.querySelector(".video-facade__preview") && !facade.classList.contains("video-facade--preview")) return;
  removePreviewVideo(facade);
  if (!state.plyr) setVideoState(facade, null);
}

function rebindFacadeInteractions(fresh, state) {
  state.facadeEl = fresh;
  stateMap.set(fresh, state);
  state.playClickBound = false;
  bindPlayClick(fresh, state);
  observeEl(sharedObserver, state);
}

/**
 * @param {HTMLVideoElement} video
 * @param {{ userGesturePlay?: boolean }} [opts]
 *   When `userGesturePlay` is true, `play()` runs in the same synchronous turn as `load()`
 *   (still inside the click call stack). iOS Safari drops deferred `play()` after awaits,
 *   which can leave `currentTime` advancing while frames stall until the user seeks.
 */
function probeWebmLoad(video, opts = {}) {
  const { userGesturePlay = false } = opts;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(tid);
      video.removeEventListener("loadeddata", onOk);
      video.removeEventListener("canplay", onOk);
      video.removeEventListener("error", onErr);
      resolve(ok);
    };
    const onOk = () => finish(true);
    const onErr = () => finish(false);
    video.addEventListener("loadeddata", onOk, { once: true });
    video.addEventListener("canplay", onOk, { once: true });
    video.addEventListener("error", onErr, { once: true });
    const tid = window.setTimeout(() => finish(false), VIDEO_PROBE_MS);
    video.load();
    if (userGesturePlay) void video.play().catch(() => {});
  });
}

function appendLoadErrorMessage(facade) {
  const err = document.createElement("p");
  err.className = "video-facade__error";
  err.setAttribute("role", "alert");
  err.textContent = "Не удалось загрузить видео.";
  facade.appendChild(err);
}

function restoreFacadeAfterLoadFailure(facade, state) {
  facade.querySelector("video.js-plyr")?.remove();
  const fresh = state.template.cloneNode(true);
  if (facade.isConnected) {
    facade.replaceWith(fresh);
    appendLoadErrorMessage(fresh);
    rebindFacadeInteractions(fresh, state);
    setVideoState(fresh, "error");
  }
}

function destroyPlyr(state, observer) {
  const facade = state.facadeEl;
  if (!facade || !state.plyr) return;

  unobserveEl(observer, state);

  try {
    state.plyr.destroy();
  } catch {
    /* noop */
  }
  state.plyr = null;
  delete facade._plyr;

  if (facade.isConnected) {
    const fresh = state.template.cloneNode(true);
    facade.replaceWith(fresh);

    const slide = fresh.closest(".carousel__slide");
    const carousel = fresh.closest("[data-carousel]");
    if (carousel) {
      carousel.dispatchEvent(
        new CustomEvent("deri:plyr", {
          bubbles: true,
          detail: { type: "unmount", slide, player: null },
        }),
      );
    }

    rebindFacadeInteractions(fresh, state);
  }
}

/**
 * Снимает Plyr с фасада.
 * @param {Element} el — .video-facade
 */
export function destroyPreviewOrPlayer(el) {
  const state = stateMap.get(el);
  if (!state) return;

  const facade = state.facadeEl;
  if (facade) destroyPreview(facade, state);

  if (state.plyr) {
    destroyPlyr(state, sharedObserver);
  }
}

/** @param {Element} el */
export function destroyPlayer(el) {
  destroyPreviewOrPlayer(el);
}

/**
 * Полный сброс медиа на слайде: dataset.timer, HLS, Plyr, восстановление фасада.
 * @param {Element | null} slide
 */
export function teardownFacadesInSlide(slide) {
  if (!slide) return;
  slide.querySelectorAll(".video-facade").forEach((f) => {
    if (f.dataset?.timer) {
      const tid = Number(f.dataset.timer);
      if (!Number.isNaN(tid)) clearTimeout(tid);
      delete f.dataset.timer;
    }
    if (f._hls) {
      try {
        f._hls.destroy();
      } catch {
        /* noop */
      }
      delete f._hls;
    }
    const state = stateMap.get(f);
    if (state) {
      destroyPreviewOrPlayer(f);
    } else if (f._plyr) {
      try {
        f._plyr.destroy();
      } catch {
        /* noop */
      }
      delete f._plyr;
    }
  });
}

export function destroySlideMedia(slide) {
  teardownFacadesInSlide(slide);
}

function handleIntersect(entries) {
  for (const entry of entries) {
    const el = entry.target;
    const state = stateMap.get(el);
    if (!state) continue;

    if (!entry.isIntersecting) {
      destroyPreviewOrPlayer(el);
    }
  }
}

let sharedObserver = null;

const stateMap = new WeakMap();

/** @type {{ plyrOptions: object; plyrTracked: unknown[] }} */
let loaderIntegration = {
  plyrOptions: {},
  plyrTracked: [],
};

let slideChangedBound = false;

function ensureState(facade) {
  let state = stateMap.get(facade);
  if (state) return state;

  state = {
    facadeEl: facade,
    template: facade.cloneNode(true),
    plyr: null,
    playClickBound: false,
    mounting: false,
  };
  stateMap.set(facade, state);

  return state;
}

/**
 * Убирает постер и кнопку Play, вставляет video с WebM (source type video/webm), динамически импортирует Plyr.
 * При ошибке загрузки восстанавливает фасад и показывает сообщение (плеер не создаётся).
 * @param {HTMLElement} facade — .video-facade
 */
export async function initPlyr(facade) {
  const state = stateMap.get(facade);
  if (!state || state.mounting) return;
  if (state.plyr) return;

  const rawSrc = facade.dataset.videoSrc?.trim();
  if (!rawSrc) return;

  const slide = facade.closest(".carousel__slide");
  const carousel = facade.closest("[data-carousel]");
  const rawOpts = facade.dataset.plyrOptions?.trim();
  const merged = { ...loaderIntegration.plyrOptions, preload: "none" };
  if (rawOpts) {
    try {
      const parsed = JSON.parse(rawOpts);
      if (parsed && typeof parsed === "object") Object.assign(merged, parsed);
    } catch {
      /* ignore */
    }
  }
  merged.preload = "none";

  const go = findCarouselGo(facade);
  const idx = slideIndex(facade);
  if (go && idx >= 0) go(idx);

  destroyPreview(facade, state);

  if (state.plyr) {
    destroyPlyr(state, sharedObserver);
  }

  state.mounting = true;
  setVideoState(facade, "loading");

  try {
    facade.querySelector("picture")?.remove();
    facade.querySelector(".video-facade__play")?.remove();

    const video = document.createElement("video");
    video.className = "js-plyr";
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    /** До активации кликом не тянем метаданные; probe вызывает load() только после клика. */
    video.preload = "none";

    const source = document.createElement("source");
    source.src = resolvedSrc(rawSrc);
    source.type = "video/webm";
    video.appendChild(source);

    facade.appendChild(video);

    const ok = await probeWebmLoad(video, { userGesturePlay: true });
    if (!ok || !facade.isConnected) {
      if (facade.isConnected) restoreFacadeAfterLoadFailure(facade, state);
      return;
    }

    video.preload = "none";

    const { default: Plyr } = await import("plyr");

    if (!facade.isConnected || !video.parentElement) {
      setVideoState(facade, null);
      return;
    }

    const player = new Plyr(video, merged);
    state.plyr = player;
    facade._plyr = player;
    setVideoState(facade, "playing");

    /** WebKit (incl. iOS): occasional VP9 stall until seek; self-seek is a no-op that nudges decoding. */
    const media = player.media;
    const nudgeDecode = () => {
      try {
        if (!media || media.paused) return;
        const t = media.currentTime;
        if (Number.isFinite(t)) media.currentTime = t;
      } catch {
        /* noop */
      }
    };
    media.addEventListener("playing", () => requestAnimationFrame(nudgeDecode), { once: true });

    if (carousel) {
      carousel.dispatchEvent(
        new CustomEvent("deri:plyr", {
          bubbles: true,
          detail: { type: "mount", slide, player },
        }),
      );
    }

    const tracked = loaderIntegration.plyrTracked;
    player.on("play", () => {
      setVideoState(facade, "playing");
      const car = slide?.closest("[data-carousel]");
      const goFn = car && typeof car.__carouselGo === "function" ? car.__carouselGo : null;
      const tr = car?.querySelector(".carousel__track");
      if (goFn && tr && slide) {
        const i = Array.from(tr.children).indexOf(slide);
        if (i >= 0) goFn(i);
      }
      for (const p of tracked) {
        if (p !== player) p.pause();
      }
    });

    tracked.push(player);
    const offDestroy = () => {
      const i = tracked.indexOf(player);
      if (i !== -1) tracked.splice(i, 1);
      player.off("destroy", offDestroy);
    };
    player.on("destroy", offDestroy);

    player.play().catch(() => {});
  } catch {
    if (facade.isConnected) restoreFacadeAfterLoadFailure(facade, state);
    else setVideoState(facade, null);
  } finally {
    state.mounting = false;
  }
}

function bindPlayClick(facade, state) {
  if (state.playClickBound) return;
  state.playClickBound = true;

  const onClick = (e) => {
    if (e.button !== 0) return;
    if (state.plyr || facade._plyr) return;
    e.preventDefault();
    e.stopPropagation();
    initPlyr(facade).catch(() => {});
  };

  facade.addEventListener("click", onClick);
  state.playClickCleanup = () => {
    facade.removeEventListener("click", onClick);
    state.playClickBound = false;
  };
}

/**
 * @param {{ plyrOptions?: object; plyrTracked?: unknown[] }} opts
 */
export function initVideoLoader(opts = {}) {
  if (opts.plyrOptions) loaderIntegration.plyrOptions = opts.plyrOptions;
  if (opts.plyrTracked) loaderIntegration.plyrTracked = opts.plyrTracked;

  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(handleIntersect, IO_OPTIONS);
  }

  if (!slideChangedBound) {
    slideChangedBound = true;
    document.addEventListener("slideChanged", (e) => {
      const carousel = e.detail?.carousel;
      const activeSlide = e.detail?.activeSlide;
      if (!carousel || !activeSlide) return;
      carousel.querySelectorAll(".carousel__slide").forEach((sl) => {
        if (sl !== activeSlide) teardownFacadesInSlide(sl);
      });
    });
  }

  document.querySelectorAll(".video-facade").forEach((facade) => {
    const state = ensureState(facade);
    bindPlayClick(facade, state);
    observeEl(sharedObserver, state);
  });
}
