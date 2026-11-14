// Decorative badges share their geometry and hue in chat and the builder.
(() => {
  const OD = (globalThis.OshiDeck ||= {});

  // The hair ornament uses an RGB wheel: yellow at noon, green at two,
  // blue at six and red at ten. OKLCH angles are distributed differently,
  // so locate the actual palette swatch on this wheel rather than rotating
  // it by the stored OKLCH number.
  function angleOfColor(hex) {
    const [r, g, b] = hex.slice(1).match(/../g).map((v) => parseInt(v, 16));
    const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
    if (!delta) return 0;
    const sector = max === r ? (g - b) / delta
      : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return Math.round(((sector * 60 + 660) % 360) * 100) / 100;
  }

  function update(mark, hue, color = null) {
    mark.style.setProperty("--od-scope-hue", hue ?? 320);
    mark.toggleAttribute("data-neutral", !!color && !!OD.store.neutralFromHex(color));
    if (color) mark.style.setProperty("--od-neutral", color);
    else mark.style.removeProperty("--od-neutral");
    if (mark.dataset.mark === "picker") {
      const orbit = mark.querySelector(".od-mark-orbit");
      const angle = angleOfColor(color || OD.store.hexOfHue(hue ?? 320, 0.74));
      if (orbit) orbit.style.transform = `rotate(${angle}deg)`;
    }
  }

  function create(channelId, hue, doc = document, color = null) {
    const mark = doc.createElement("span");
    mark.className = "od-channel-mark";
    mark.setAttribute("aria-hidden", "true");
    switch (channelId) {
      case "UCVKWgVm8BSlMkGZIDGaoElw": // Ayamo Nono
      case "UCtKH7ZHAJ7TcTjyiLJRHhvg": // her old channel
        mark.dataset.mark = "rainbow";
        break;
      case "UCj63OWl-HQ-I6ORzUWF1EDg": // Nijipuka Nuhu
        mark.dataset.mark = "picker";
        const orbit = doc.createElement("span");
        orbit.className = "od-mark-orbit";
        // A downward-pointing heart at the top keeps pointing inward as
        // this whole orbit follows the swatch around the RGB wheel.
        const ns = "http://www.w3.org/2000/svg";
        const heart = doc.createElementNS(ns, "svg");
        heart.setAttribute("class", "od-mark-heart");
        heart.setAttribute("viewBox", "0 0 24 24");
        heart.setAttribute("fill", "none");
        heart.setAttribute("stroke", "currentColor");
        heart.setAttribute("stroke-width", "2");
        heart.setAttribute("stroke-linejoin", "round");
        const path = doc.createElementNS(ns, "path");
        path.setAttribute("d", "M12 21S4 15.7 4 9a4.5 4.5 0 0 1 8-3 4.5 4.5 0 0 1 8 3c0 6.7-8 12-8 12Z");
        heart.appendChild(path);
        orbit.appendChild(heart);
        mark.appendChild(orbit);
        break;
    }
    update(mark, hue, color);
    return mark;
  }

  OD.channelMarks = { create, update, angleOfColor };
})();
