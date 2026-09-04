// Fan geometry and row splitting. Pure math — no DOM, no storage.
(() => {
  const OD = (globalThis.OshiDeck ||= {});

  const CARD_SIZE = { large: 74, medium: 66, small: 58 };
  const OVERLAP = 8;
  const MAX_TILT = 8;
  const LIFT = 5;

  // Widest fan that fits: one card, then each extra costs (card - overlap).
  function cardsPerRow(availWidth, cardWidth) {
    const step = cardWidth - OVERLAP;
    return Math.max(1, Math.floor((availWidth - cardWidth) / step) + 1);
  }

  // Split `count` cards across at most `maxRows` rows as evenly as possible.
  // Filling row 1 to capacity would leave 8 cards at 7/row as an ugly 7 + 1.
  function splitRows(count, perRow, maxRows) {
    const visible = Math.min(count, perRow * maxRows);
    if (visible <= 0) return { rows: [], hidden: count };

    const rows = Math.min(maxRows, Math.ceil(visible / perRow));
    const base = Math.floor(visible / rows);
    const extra = visible % rows;

    const sizes = [];
    for (let r = 0; r < rows; r++) sizes.push(base + (r < extra ? 1 : 0));

    return { rows: sizes, hidden: count - visible };
  }

  // Position within its own row drives the tilt, so the fan stays symmetric
  // however the row happened to be sized.
  function tilt(index, rowLength) {
    if (rowLength < 2) return { rot: 0, lift: 0 };
    const t = (index - (rowLength - 1) / 2) / ((rowLength - 1) / 2); // -1 … 1
    const span = Math.min(MAX_TILT, 44 / rowLength); // more cards, tighter fan
    return { rot: t * span, lift: Math.abs(t) ** 2 * LIFT };
  }

  OD.layout = { CARD_SIZE, OVERLAP, cardsPerRow, splitRows, tilt };
})();
