// Fan geometry and row splitting. Pure math — no DOM, no storage.
(() => {
  const OD = (globalThis.OshiDeck ||= {});

  const CARD_SIZE = { large: 74, medium: 66, small: 58 };
  const OVERLAP = 8;
  const MAX_ROWS_CAP = 2;
  const PANEL_PADDING = 24;
  const SCROLLBAR_GUTTER = 8;
  const LIST_VISIBLE = 12;

  // How tightly the hand may be squeezed to take one more card. Past this the
  // cards stop reading as separate, so a row that still will not fit goes
  // without the drawn card rather than becoming a smear.
  const MAX_OVERLAP = 26;
  const MAX_TILT = 8;
  const LIFT = 5;

  // Widest fan that fits: one card, then each extra costs (card - overlap).
  function cardsPerRow(availWidth, cardWidth) {
    const step = cardWidth - OVERLAP;
    return Math.max(1, Math.floor((availWidth - cardWidth) / step) + 1);
  }

  // The overlap that makes `count` cards, plus `gap`, exactly fill the width.
  //
  // Drawing a card squeezes the hand instead of growing a row: the panel sits
  // at the bottom of the chat, so another row would be taken out of the chat
  // itself. Never looser than the resting overlap, never tighter than the cap.
  function overlapFor(availWidth, cardWidth, count, gap = 0) {
    if (count < 2) return OVERLAP;
    const step = (availWidth - cardWidth - gap) / (count - 1);
    return Math.min(MAX_OVERLAP, Math.max(OVERLAP, cardWidth - step));
  }

  // Whether that squeeze is enough, or the row would overflow anyway.
  function fitsSqueezed(availWidth, cardWidth, count, gap = 0) {
    if (count <= 0) return gap <= availWidth;
    const overlap = overlapFor(availWidth, cardWidth, count, gap);
    return cardWidth + (count - 1) * (cardWidth - overlap) + gap <= availWidth;
  }

  // What the hand has to fan in once a drawn card has taken its place at the
  // left. The drawn card sits apart rather than in the fan, so it costs a
  // whole card plus the gap — counting it as one more overlapping card left
  // the row an overlap too wide.
  const besideDrawn = (availWidth, cardWidth, gap) => availWidth - cardWidth - gap;

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

  OD.layout = {
    MAX_ROWS_CAP, PANEL_PADDING, SCROLLBAR_GUTTER, LIST_VISIBLE,
    CARD_SIZE, OVERLAP, MAX_OVERLAP,
    cardsPerRow, overlapFor, fitsSqueezed, besideDrawn, splitRows, tilt
  };
})();
