(async () => {
  // ─────────────── 1. STORAGE & RATE HANDLING ───────────────
  let rate = 1.0;
  let courseId = location.pathname.split("/")[2] || "global";

  // Load the saved rate and apply it
  async function loadAndApply() {
    try {
      const { defaults = {} } = await browser.storage.sync.get("defaults");
      rate = parseFloat(defaults[courseId] || 1.0);
    } catch (err) {
      console.error("[CS] Error reading storage.sync:", err);
      rate = 1.0;
    }
    applyRate(rate);
  }

  // Save the current rate
  async function saveRate() {
    try {
      const { defaults = {} } = await browser.storage.sync.get("defaults");
      defaults[courseId] = rate;
      await browser.storage.sync.set({ defaults });
    } catch (err) {
      console.error("[CS] Error writing storage.sync:", err);
    }
  }

  await loadAndApply();

  // Re-run on SPA URL changes
  let lastPath = location.pathname;
  new MutationObserver(async () => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      courseId = location.pathname.split("/")[2] || "global";
      await loadAndApply();
    }
  }).observe(document.body, { childList: true, subtree: true });

  // ─────────────── 2. APPLY RATE & UI UTILS ───────────────
  function clearNativeSelections() {
    const allNativeSelectionsButtons = document.querySelectorAll(
      'ul[data-purpose="playback-rate-menu"] li[role="none"] button'
    );

    allNativeSelectionsButtons.forEach((button) => {
      if (
        parseFloat(button.querySelector("div span").textContent).toFixed(2) ==
        rate
      ) {
        button.setAttribute("aria-checked", "true");
      } else {
        button.setAttribute("aria-checked", "false");
        button.classList.remove("vjs-selected");
      }
    });
  }

  function markCustomSlider(li) {
    li.setAttribute("role", "menuitemslider");
    li.setAttribute("aria-checked", "true");
    li.classList.add("vjs-selected");
  }

  function applyRate(r) {
    console.debug("[CS] applyRate()", r);

    // 2.1 Video.js API
    if (window.videojs && videojs.getAllPlayers) {
      videojs.getAllPlayers().forEach((player) => {
        player.playbackRate(r);
        player.defaultPlaybackRate(r);
        ["loadedmetadata", "loadeddata", "ratechange"].forEach((evt) => {
          player.off(evt);
          player.on(evt, () => applyRate(r));
        });
      });
    }

    // 2.2 Raw <video> fallback
    document.querySelectorAll("video").forEach((v) => {
      v.playbackRate = r;
      v.defaultPlaybackRate = r;
      v.removeEventListener("loadedmetadata", v._csListener);
      v._csListener = () => applyRate(r);
      v.addEventListener("loadedmetadata", v._csListener);
    });

    // 2.3 Update Udemy UI and clear native options
    const rateBtn = document.querySelector(
      '[data-purpose="playback-rate-button"]'
    );
    if (rateBtn) {
      const label = rateBtn.querySelector("span") || rateBtn;
      label.textContent = r.toFixed(2) + "×";
    }
    clearNativeSelections();
  }

  // 2.4 Debug native rate changes on <video>
  document.querySelectorAll("video").forEach((v) => {
    v.addEventListener("ratechange", () => {
      console.debug("[CS] native ratechange to", v.playbackRate);
    });
  });

  // 2.5 Poll to catch missed resets
  setInterval(() => {
    document.querySelectorAll("video").forEach((v) => {
      if (Math.abs(v.playbackRate - rate) > 0.001) {
        console.debug("[CS] Poll override", v.playbackRate, "→", rate);
        applyRate(rate);
      }
    });
  }, 500);

  // ─────────────── 3. SLIDER INJECTION & BINDING ───────────────
  function makeSliderItem() {
    const li = document.createElement("li");
    li.className = "cs-udemy-slider-item";
    Object.assign(li.style, {
      listStyle: "none",
      padding: "8px 12px",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      borderBottom: "1px solid rgba(255,255,255,0.1)",
    });

    const label = document.createElement("span");
    label.textContent = rate.toFixed(2) + "×";
    label.style.minWidth = "40px";
    label.style.color = "#fff";

    const input = document.createElement("input");
    input.type = "range";
    input.min = "0.5";
    input.max = "4.0";
    input.step = "0.01";
    input.value = rate.toFixed(2);
    input.style.flex = "1";

    ["pointerdown", "mousedown"].forEach((evt) =>
      input.addEventListener(evt, (e) => e.stopPropagation())
    );

    input.addEventListener("input", async (e) => {
      rate = parseFloat(e.target.value);
      label.textContent = rate.toFixed(2) + "×";
      applyRate(rate);
      await saveRate();
    });

    li.append(label, input);
    return li;
  }

  function bindRateButton() {
    const btn = document.querySelector('[data-purpose="playback-rate-button"]');
    if (!btn || btn._csBound) return;
    btn._csBound = true;

    btn.addEventListener("click", () => {
      setTimeout(() => {
        const ul = document.querySelector(
          'ul[data-purpose="playback-rate-menu"]'
        );
        if (!ul) return;

        // inject slider if missing
        let sliderLi = ul.querySelector(".cs-udemy-slider-item");
        if (!sliderLi) {
          sliderLi = makeSliderItem();
          markCustomSlider(sliderLi);
          ul.insertBefore(sliderLi, ul.firstElementChild);
        }

        // add native preset listener
        ul.querySelectorAll('li[role="none"]').forEach((li) => {
          if (li._csNative) return;
          li._csNative = true;
          li.addEventListener("click", async () => {
            // parse Udemy's preset
            const txt = li.textContent.trim().replace("×", "");
            const chosen = parseFloat(txt);
            if (isNaN(chosen)) return;

            // apply and save
            rate = chosen;
            applyRate(rate);
            await saveRate();

            // update slider UI
            const input = sliderLi.querySelector("input");
            const label = sliderLi.querySelector("span");
            input.value = rate.toFixed(2);
            label.textContent = rate.toFixed(2) + "×";
            markCustomSlider(sliderLi);
          });
        });

        // done—slider keeps its last value across videos because we never override it here
      }, 100);
    });
  }

  bindRateButton();
  new MutationObserver(bindRateButton).observe(document.body, {
    childList: true,
    subtree: true,
  });

  // ─────────────── 4. HOTKEY SUPPORT ───────────────
  browser.runtime.onMessage.addListener(async (msg) => {
    if (msg.action === "adjust") {
      rate = Math.max(
        0.5,
        Math.min(4.0, parseFloat((rate + msg.delta).toFixed(2)))
      );
      applyRate(rate);
      await saveRate();

      const input = document.querySelector(".cs-udemy-slider-item input");
      const label = document.querySelector(".cs-udemy-slider-item span");
      if (input && label) {
        input.value = rate.toFixed(2);
        label.textContent = rate.toFixed(2) + "×";
      }
    }
  });
})();
