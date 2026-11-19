// Storage, migration, settings and deck membership.
(() => {
  const OD = (globalThis.OshiDeck ||= {});

  const KEYS = {
    SETTINGS: "settings",
    CARDS: "cards",      // the pool: every card, once
    DECKS: "decks",      // channelId -> ordered card ids
    CHANNELS: "channelMeta",
    LEGACY: "presets"    // v0.1/v0.2 shape, kept as a backup after migrating
  };

  const DEFAULT_SETTINGS = {
    autoSend: false,
    mode: "hand",      // hand | list
    // Whether the panel keeps itself to its bar. A choice, not a mood: it is
    // written down so that the one made on one stream is the one found on the
    // next, which is the whole of the preference — there is no second setting
    // for what it should normally be, because this is what it normally is.
    folded: false,
    cardSize: "small", // large | medium | small
    rows: 2,           // 1 | 2
    sortBy: "trend",   // manual | uses | heat | trend
    suggest: true,     // draw one card from what the chat is doing
    draw: "normal",    // shy | normal | eager — how much of a wave it takes
    hold: "normal",    // long | normal | short, or milliseconds
    pace: "normal",    // slow | normal | quick, or milliseconds
    language: ""       // "" follows the browser; otherwise a code from i18n.LANGUAGES
  };

  // The numbers behind those three. Offered as steps rather than as fields
  // because they are not independent: how many messages and what share of the
  // room together decide what counts as a wave, and picking them apart invites
  // combinations that mean nothing (two messages, half the room).
  //
  // Every value is here, so changing what a step means is one edit, and the
  // settings page can say plainly what it is about to do.
  const TUNING = {
    draw: {
      shy:    { min: 8, share: 0.40 },
      normal: { min: 6, share: 0.30 },
      eager:  { min: 4, share: 0.20 }
    },
    hold: {
      long: 60_000,
      normal: 30_000,
      short: 15_000
    },
    pace: {
      slow: 30_000,
      normal: 20_000,
      quick: 10_000
    }
  };

  // These two can also be given a number of milliseconds outright. Steps are
  // the honest default — they are a judgement about feel, not a measurement —
  // but somebody who has watched their own chat has a better number than any
  // of mine. `draw` stays steps only: it is two numbers that have to agree,
  // and picking them apart invites combinations that mean nothing.
  const BY_TIME = new Set(["hold", "pace"]);
  const SHORTEST = 1_000;
  const LONGEST = 600_000;
  const clampTime = (ms) => Math.min(LONGEST, Math.max(SHORTEST, Math.round(ms)));

  // Falls back to the middle step rather than to nothing: a settings file from
  // an older version has no opinion about these, and neither does a broken one.
  const tuning = (settings, group) => {
    const chosen = settings?.[group];
    if (BY_TIME.has(group) && typeof chosen === "number" && Number.isFinite(chosen)) {
      return clampTime(chosen);
    }
    return TUNING[group]?.[chosen] ?? TUNING[group]?.normal;
  };

  // What each setting may be, so that nothing downstream has to wonder.
  //
  // Not only the two time steps, and not only the settings page: a backup is
  // a file and a file can say anything. One with `mode: "not-a-mode"` passed
  // validation and then threw on the options page, which reads the matching
  // radio by value and set `.checked` on nothing.
  const ALLOWED = {
    autoSend: [true, false],
    mode: ["hand", "list"],
    folded: [true, false],
    cardSize: ["large", "medium", "small"],
    rows: [1, 2],
    sortBy: ["manual", "uses", "heat", "trend"],
    suggest: [true, false],
    draw: ["shy", "normal", "eager"],
    hold: ["long", "normal", "short"],
    pace: ["slow", "normal", "quick"]
  };

  function cleanSettings(patch) {
    const clean = {};
    for (const [key, value] of Object.entries(patch || {})) {
      // Anything that is not a setting is not one by being written down.
      if (!Object.hasOwn(DEFAULT_SETTINGS, key)) continue;

      // Any string: i18n falls back from one it does not know, and a code it
      // has never heard of is how "follow the browser" is written.
      if (key === "language") {
        if (typeof value === "string") clean[key] = value;
        continue;
      }

      // These two take a number of milliseconds as well as a step. An empty
      // field arrives as NaN, which is a number and not an answer.
      if (BY_TIME.has(key) && typeof value === "number") {
        if (Number.isFinite(value)) clean[key] = clampTime(value);
        continue;
      }

      // `includes`, not a lookup: `TUNING[group][value]` answered for
      // "toString", and tuning() then handed its callers a function.
      if (ALLOWED[key].includes(value)) clean[key] = value;
    }
    return clean;
  }

  const HALF_LIFE = 7 * 24 * 60 * 60 * 1000;
  const decay = (ms) => Math.pow(0.5, Math.max(0, ms) / HALF_LIFE);

  const HUES = [320, 145, 250, 85, 25, 195, 290, 60];

  // BEGIN V52 HEX COLOURS
  // The selected HEX is authoritative, including lightness and chroma.
  // Generated by tools/sync-colours.mjs from tools/data/channel-colours-v52.json.
  const OSHI_COLORS = Object.assign(Object.create(null), {
    "UC-6rZgmxZSIbq786j3RD5ow": "#234A87",
    "UC-FPAg1abIzzaXuxGKLUVXQ": "#FBB900",
    "UC-M0Poxo4VXMxdIzinqWOig": "#8EBBD8",
    "UC-O0yAOb7iu1I_XcF_2Pfhg": "#7C62A3",
    "UC-WX1CXssCtCtc2TNIRnJzg": "#5195E1",
    "UC-hM6YJuNYVAmUWxeIr9FeA": "#FF8FDF",
    "UC-hMwvRuMsQrfgu0DPKLV2A": "#B53D54",
    "UC-tBLCGTheczDn5mYNoNWTQ": "#DF923B",
    "UC02dJeNmcQLqENdHFG1svJw": "#A7F1EA",
    "UC060r4zABV18vcahAWR1n7w": "#CE4556",
    "UC0HX1e5jJnhN5Xn0epV2wzA": "#D74B77",
    "UC0Owc36U9lOyi9Gx9Ic-4qg": "#F3C640",
    "UC0TXe_LYZ4scaW2XMyi5_kw": "#FC3488",
    "UC0WwEfE-jOM2rzjpdfhTzZA": "#F98FB7",
    "UC0YQnenKBCu5sGb7H61n6HA": "#59467C",
    "UC0g1AE0DOjBYnLhkgoRWN1w": "#FBE340",
    "UC0mEc9OzI-B9HRi1v-GCVBw": "#953E60",
    "UC0pA7uDmbbEKIr0SVocP-Tg": "#E3A4B3",
    "UC0w13AZfaxfatdHdF-bhN3Q": "#5379BF",
    "UC0w_dvkIwnXzMak6gfeioRQ": "#DCA366",
    "UC0xry7czPasj1wPxR8L0MZg": "#DF6D7C",
    "UC10wVt6hoQiwySRhz7RdOUA": "#EE1B4B",
    "UC16P6nSFhimmcjQKrdOx2IQ": "#63498B",
    "UC1CfXB_kRs3C-zaeTG3oGyg": "#FE4872",
    "UC1DCedRgGHBdm81E1llLhOQ": "#7EC2FE",
    "UC1GH6W6CzBUCR_3oHegiBGw": "#9B71BD",
    "UC1ZRXoTQUwZtKnpOfJwGNPw": "#9932CC",
    "UC1afpiIuBDcjYlmruAa0HiA": "#EEDDC2",
    "UC1cExET9xoWSO9iSnRsW_1Q": "#8E66B0",
    "UC1iA6_NT4mtAcIII6ygrvCw": "#B6B9FF",
    "UC1nqXaKzG4hd1SRFVra16gw": "#C95C93",
    "UC1sBUU-y9FlHNukwsrR4bmA": "#82BFAB",
    "UC1suqwovbL1kzsoaZgFZLKg": "#FE739E",
    "UC1tBdWwNOsdMcO904N7eiWA": "#D8346E",
    "UC1uv2Oq6kNxgATlCiez59hw": "#BA92CA",
    "UC1vawzfbCnRpHT9SJ5pHlHw": "#FF8C9B",
    "UC1yZAPWNLVtfCX43IQS0gTA": "#24365C",
    "UC1zFJrfEKvCixhsjNSb1toQ": "#DFC6A8",
    "UC2BJwSA_iewqrMHX9rrO59g": "#C14C69",
    "UC2NtHPaDUA5htYsjVrO8Gng": "#764699",
    "UC2OacIzd2UxGHRGhdHl1Rhw": "#AA7BE8",
    "UC2WcZDV2dHgtJp4H-LscyKA": "#168F43",
    "UC2b4WRE5BZ6SIUWBeJU8rwg": "#8578C4",
    "UC2daHxnuJJBM5NWci1RRkeA": "#416A91",
    "UC2f11iZvrPBtA_S1LE2soeA": "#99FFD8",
    "UC2hc-00y-MSR6eYA4eQ4tjQ": "#C8161D",
    "UC2hx0xVkMoHGWijwr_lA01w": "#FF9603",
    "UC2kyQhzGOB-JPgcQX9OMgEw": "#59C3E1",
    "UC2xXx1m1jeL0W84_0jTg-Yw": "#58535E",
    "UC3-Rfh_Ek-s6EUWS4fT5VPw": "#EBA5C8",
    "UC30qYt5EBXB5_cJ0cDf_A9A": "#C4BEE2",
    "UC3BJY6I0IBn14NTBNnwKncw": "#B82632",
    "UC3EhsuKdEkI99TWZwZgWutg": "#B7CDDA",
    "UC3K7pmiHsNSx1y0tdx2bbCw": "#EF9FC6",
    "UC3OH5FKQ3qtl4uRme_vZTgA": "#8871E2",
    "UC3VN9h8fokwB2XURWHNcdWw": "#F6F6F6",
    "UC3aEtHpGzCFvoSn_wRWzgZQ": "#9978BB",
    "UC3lNFeJiTq6L3UWoz4g1e-A": "#F9E97A",
    "UC3vzVK_N_SUVKqbX69L_X4g": "#FEE579",
    "UC47rNmkDcNgbOcM-2BwzJTQ": "#FEBC87",
    "UC48jH1ul-6HOrcSSfoR02fQ": "#BFFFFF",
    "UC4OAmxLab5tVF094Sgry6hw": "#1D62C1",
    "UC4PrHgUcAtOoj_LKmUL-uLQ": "#FFE893",
    "UC4Xuz67FNRr69ILv2b7ZRBA": "#000080",
    "UC4l9gz3q65lTBFfFtW5LLeA": "#192332",
    "UC4oIghT3W9Y99nyiNCTXwlg": "#DCB067",
    "UC4x-GEt8n6CJBSTI1K9vZ7w": "#DA789A",
    "UC53UDnhAAYwvNO7j_2Ju1cQ": "#A83E4A",
    "UC5BzXtjnKt1fjEDjEJwx5JA": "#D94858",
    "UC5CwaMl1eIgY8h02uZw7u8A": "#49E0F4",
    "UC5KnT0tNsYVVh44lQj-S1JQ": "#6FCBD8",
    "UC5LyYg6cCA4yHEYvtUsir3g": "#4182FA",
    "UC5Qv2tPOI38OcnqOdUKkn7Q": "#543298",
    "UC5SSy3julTJHzmExQJjLUkw": "#70152D",
    "UC5UPG3fV3zzuq-JLPw-XdWQ": "#89C5DE",
    "UC5V04t-yK32p0ljhSIUwgOg": "#EED09D",
    "UC5XQhzMH08PgWa4Zp02Gcsw": "#9966CC",
    "UC5bTzks2uWlrJUqZLrew0uQ": "#B69BE3",
    "UC5dJFf4m-mEcoyJRfhBljoA": "#DC3C41",
    "UC5ek2GWKvUKFgnKSHuuCFrw": "#7C86DE",
    "UC5qlAhrec6-0J-K3zmhNPPQ": "#AC626B",
    "UC5qsIJIixQI5k2FfkW1j1NQ": "#8C2830",
    "UC61OwuYOVuKkpKnid-43Twg": "#8ECED9",
    "UC61iJVuFVS4YsnPkZe5EmXg": "#E4A452",
    "UC68J5pWEshmwhDH45qnpIsg": "#CF3E52",
    "UC6FprWVXuULaY9mZOcqTe4A": "#E62F8B",
    "UC6JkRqQXgdvmkBrc-fIl5RQ": "#46427E",
    "UC6TyfKcsrPwBsBnx2QobVLQ": "#DB9B58",
    "UC6W1rDne4LOYK4XLpvhW6ow": "#222222",
    "UC6WFKwYptsxVue56Lx218vg": "#5A5FAA",
    "UC6b4Ta_J0wbylnPu1auaQiA": "#EE7908",
    "UC6eWCld0KwmyHFbAqK3V-Rw": "#F09CC0",
    "UC6oDys1BGgBsIC3WhG1BovQ": "#745399",
    "UC6wvdADTJ88OfIbJYIpAaDA": "#BF69F4",
    "UC7-m6jQLinZQWIbwm9W-1iw": "#8C2830",
    "UC727SQYUvx5pDDGQpTICNWg": "#F2C95C",
    "UC7Gb7Uawe20QyFibhLl1lzA": "#D4AF37",
    "UC7Gow-kNHq21oejSIDg9PAg": "#9262C8",
    "UC7XCjKxBEct0uAukpQXNFPw": "#5B7FBC",
    "UC7Xglp1fske9zmRe7Oj8YyA": "#9373D7",
    "UC7_MFM9b8hp5kuTSpa8WyOQ": "#2887FF",
    "UC7fk0CB07ly8oSl0aqKkqFg": "#DE3E28",
    "UC7gxU6NXjKF1LrgOddPzgTw": "#7C4DAE",
    "UC7hffDQLKIEG-_zoAQkMIvg": "#A9CEEC",
    "UC7nyueGsb-5VDNPRh6pHtCA": "#7568CD",
    "UC7wZb5INldbGweowOhBIs8Q": "#DD3247",
    "UC80TduEq6Sp4n2DkiUH2eLQ": "#8BA7D9",
    "UC85oUgXc5EUMdwkBh3FyWOg": "#B68BCB",
    "UC8C1LLhBhf_E2IBPLSDJXlQ": "#FF2FA2",
    "UC8NZiqKx6fsDT3AVcMiVFyA": "#3CBCEB",
    "UC8QBbRXJ9-_y2ho3z3qnALg": "#54A8BF",
    "UC8SJPcLpIM3x8RdBJFfiluw": "#0C6F72",
    "UC8Snw5i4eOJXEQqURAK17hQ": "#7DF9FF",
    "UC8TVZmQuOl0GNbpvThwwSdQ": "#B49ACD",
    "UC8W8jZ1P9bhJFYLelr3EvIQ": "#D83A32",
    "UC8eitCE9Z6EwUCs-VUi1blg": "#53B0FF",
    "UC8hwewh9svh92E1gXvgVazg": "#F0F8FF",
    "UC8jskpQfW9fn2NLK3PdaGdg": "#A7DFF0",
    "UC8rcEBzJSleTkf_-agPM20g": "#8C1236",
    "UC8vKBjGY2HVfbW9GAmgikWw": "#ECA0AA",
    "UC8vZcu6W-EJ6UYEy_C31c-A": "#FFFAFA",
    "UC90vyzmRgWCE17-uWNsKW2Q": "#FF7B29",
    "UC98iRMvRqUxRD6GP4NtRskw": "#383E78",
    "UC9EjSJ8pvxtvPdxLOElv73w": "#EF6F94",
    "UC9HYkiQZ1_b3J_F8gc12eaA": "#4A4A5C",
    "UC9LSiN9hXI55svYEBrrK-tw": "#EA4980",
    "UC9Mfuai-qdXnTTFN0Z3hkAA": "#76BDD5",
    "UC9V3Y3_uzU5e-usObb6IE1w": "#FAB80D",
    "UC9Vq5c7FKEHLstvmSAsogXQ": "#E979AA",
    "UC9XsF9M7lZ1BSABHjKatOSA": "#8ADCEB",
    "UC9mydBOLdL6-Fp61paK68Tw": "#50C878",
    "UC9p_lqQ0FEDz327Vgf5JwqA": "#6E5BF4",
    "UC9tOWVNzMaXDD5SxKP1zAug": "#D6B448",
    "UCAHQGIKolfBfoeXXMY79SBA": "#F5F5F5",
    "UCAHVQ44O81aehLWfy9O6Elw": "#97C3E7",
    "UCAHXqn4nAd2j3LRu1Qyi_JA": "#545F86",
    "UCAHwWUotyS3l2qBetFDsjgQ": "#EE58A4",
    "UCANDOlYTJT7N5jlRC3zfzVA": "#EB6E00",
    "UCAOhUv73jM5iCpOhuJOQzxA": "#242327",
    "UCAQDFeCTVdx90GtwohwjHzQ": "#FA5578",
    "UCAUicVZlApAIhcdL9df3gWw": "#F8C6BD",
    "UCAWSyEs_Io8MtpY3m-zqILA": "#EEAC5E",
    "UCAePtlqx1XIvYh35J8TpBBw": "#7F97AC",
    "UCAoy6rzhSf4ydcYjJw3WoVg": "#FF45D5",
    "UCAplyWK80Y6_YTkb3CCDk1Q": "#85C4D4",
    "UCAytwphRHoPcvLr_qRvn3Zw": "#80C6E8",
    "UCB1s_IdO-r0nUkY2mXeti-A": "#F5A623",
    "UCB4G5YgdI4rfTU0IU3dkjDw": "#78347F",
    "UCB7sSUNwh_dXE7ZL3DsGDpw": "#9474BE",
    "UCBAeKqEIugv69Q2GIgcH7oA": "#AC424A",
    "UCBLGjbYv6-xxju1i44RjnnA": "#F58C35",
    "UCBXLH5mn0nxgFH3udMtw4ig": "#608F43",
    "UCBhfuPYgo5ALbn6WmTXwHwg": "#F3DD6D",
    "UCBi8YaVyZpiKWN3_Z0dCTfQ": "#CA636C",
    "UCBiqkFJljoxAj10SoP2w2Cg": "#EBDDB4",
    "UCBjcx01rZwPDuUPzWLTsZVA": "#BD81D4",
    "UCC0i9nECi4Gz7TU63xZwodg": "#DBE2E5",
    "UCC7rRD6P7RQcx0hKv9RQP4w": "#F0F0F5",
    "UCCB4kCxfVMdudYmF6nTnMUQ": "#A9DBF5",
    "UCCHH0nWYXFZmtDS_4tvMxHQ": "#FAD1D6",
    "UCCVwhI5trmaSxfcze_Ovzfw": "#D8368D",
    "UCCXME7oZmXB2VFHJbz5496A": "#F0D642",
    "UCCZyXXv6cHQBqbPIBfTe1gQ": "#BBF2FF",
    "UCClwIqTUn5LDpFucHyaAhHg": "#EC399B",
    "UCCra1t-eIlO3ULyXQQMD9Xw": "#398FB2",
    "UCCuEq93a1ZVy4Hex16WnVuA": "#ECA35A",
    "UCCugV2RWXqJMjVVQl_Yh4TQ": "#0A44AA",
    "UCCzUftO8KOVkV4wQG1vkUvg": "#BA2C2B",
    "UCD-miitqNY3nyukJ4Fnf4_A": "#E43F3B",
    "UCD5W21JqNMv_tV9nfjvF9sw": "#D6ADFF",
    "UCDC7peoZ2tlm406-0l8iLYw": "#E8D9C3",
    "UCDHABijvPBnJm7F-KlNME3w": "#FDB440",
    "UCDOiw6Z_yVE65XtgtcjJj5w": "#FFD8DD",
    "UCDQkIK-Md2XDbDWN4nKyzIQ": "#A7DFF0",
    "UCDXO6Nh1iiVSieGCTFWUOFw": "#436EC0",
    "UCDd-NcDZGw5gwxPsTXj9IFQ": "#00A5BF",
    "UCDh2bWI5EDu7PavqwICkVpA": "#47885E",
    "UCDqI2jOz0weumE8s7paEk6g": "#D192FE",
    "UCDrG8pzkq_cCCLcN5wgrzNw": "#C72B46",
    "UCDwPMymmju4GZV7kZcL2vIQ": "#FFD246",
    "UCE5VgVGRPfNCjXPeTe1QJHA": "#84E5DE",
    "UCE7gtjLeZKNXLp5YURzYYeg": "#D94858",
    "UCEFOogmvTTcCaO8Qe0I8-tg": "#CDCD00",
    "UCEFx7PserYcSAD3p66sOMWA": "#A262C5",
    "UCEJIq8svnyRsurZBhslqAkA": "#B8E994",
    "UCENwRMx5Yh42zWpzURebzTw": "#351E3B",
    "UCEfWuGRucPLoRbXRvOJUS_Q": "#8062A7",
    "UCEiB6vkUtWsBwYsAF7ukKXw": "#F6A3C8",
    "UCEk1_ZVGRiVV-gxHT9wdNMg": "#7B68EE",
    "UCElYE3bfzjjmJ9xwjvro9Yw": "#777777",
    "UCErj8GX-TnIO8QVWYsDzIwQ": "#2E88E8",
    "UCEtUOMEAuAMz8dor89rt2RA": "#ED4864",
    "UCEy9cYULQrC2cRlVqJPCcSw": "#FFC0CB",
    "UCFBc8kuCtTwmtdsBcJoZ3qA": "#8D7CC3",
    "UCFIPVDm8SejRZHkuVOzBmpA": "#48D1CC",
    "UCFKOVgVbGmX65RxO3EtH3iw": "#6ABADF",
    "UCFTLzh12_nrtzqBPsTCqenA": "#4E7FFC",
    "UCFWD2vvDJqjimIzhjEvogNQ": "#493E88",
    "UCF_U2GCKHvDz52jWdizppIA": "#FFFFFF",
    "UCFaGKEDWe9_jOmWMsyatxSw": "#614E66",
    "UCFgXWZOUZA2oYHNr6qDmsTQ": "#E60012",
    "UCFimqykDM5g9a5KxlW_e7ZQ": "#442657",
    "UCFkHpBGMeNSQW-j9-F0nxnQ": "#FFC0CB",
    "UCFsWaTQ7kT76jNNGeGIKNSA": "#EA998F",
    "UCFtyinR2ZdvKK_Xgy07qXUg": "#2C35BD",
    "UCFvEuP2EDkvrgJpHI6-pyNw": "#BE4A97",
    "UCFwcEIsjvi9XEvpGx6iwHpw": "#BB0F28",
    "UCG0rzBZV_QMP4MtWg6IjhEA": "#A660A7",
    "UCG5vZgELi3on_pksaLrIoxw": "#E58D43",
    "UCGGIGlgxXoVu1ZzbQ2XBxqQ": "#4270B2",
    "UCGLS7BOgNa6c03r7VYacblw": "#FF8184",
    "UCGPSbXH61y4l85L9XTUl2mA": "#98165C",
    "UCGSt1yNG5l-jpYRLpJ5oNtA": "#B5A4BE",
    "UCGWa1dMU_sDCaRQjdabsVgg": "#BE2152",
    "UCGYAYLDE7TZiiC8U6teciDQ": "#EEFFFF",
    "UCGndc74kfWb_A-8hZBG534Q": "#FF99FF",
    "UCGw7lrT-rVZCWHfdG9Frcgg": "#B43246",
    "UCGyywYAJd2O5Y7yUyr7qBRQ": "#EAEFF9",
    "UCGzTVXqMQHa4AgJVJIVvtDQ": "#F096C9",
    "UCH-SLA_jpPhM2lzdZjZDxjQ": "#F7CB0E",
    "UCHAr9pWGS30akL4MQCQT4uQ": "#ECAFC2",
    "UCHBhnG2G-qN0JrrWmMO2FTA": "#6C2735",
    "UCHIgbtz8t8snEwWlE1eyS2g": "#302A47",
    "UCHP4f7G2dWD4qib7BMatGAw": "#A93B69",
    "UCHRCp0CSacVnTVS2Z4x9xYg": "#0C145C",
    "UCHVSA2OScyef9W7OwPGgJ9w": "#E5E2F6",
    "UCHVXbQzkl3rDfsXWo8xi2qw": "#C83C35",
    "UCHX7YpFG8rVwhsHCx34xt7w": "#B4E9FF",
    "UCHZiV_ewlnKeFcP0raBiD7Q": "#D77C9D",
    "UCHj_mh57PVMXhAUDphUQDFA": "#FE4872",
    "UCHnbtVLZYGuKkGh6iFxxTpw": "#F1F2F4",
    "UCHsx4Hqa-1ORjQTh9TYDhww": "#FF511C",
    "UCI-aDQ7k0Ghd9JlFv_qzB7w": "#E8EAF4",
    "UCIEBSYfCdoSwkeWu9Odhkgg": "#FEAC44",
    "UCIG9rDtgR45VCZmYnd-4DUw": "#F8B759",
    "UCIMFIkXOGA7dWA903WdRKKg": "#C94D6B",
    "UCIPYZHEvSEEpEIQQBt--yNA": "#ED9EB1",
    "UCIQsiulMw70eRex4cXRAx2A": "#64B6A7",
    "UCIVFv8AiQLqM9oLHTixrNYw": "#3B52BF",
    "UCIaZylf5L9MsCMOJX3BdTEg": "#426EFC",
    "UCIcAj6WkJ8vZ7DeJVgmeqKw": "#B297D7",
    "UCIeSUTOTkF9Hs7q3SGcO-Ow": "#95C8D8",
    "UCIjdfjcSaEgdjwbgjxC3ZWg": "#FF3652",
    "UCIq2HwA2iBOso7ar4VuU-TA": "#FFE673",
    "UCIu-aUArYq_H84dBpCAokMA": "#E6E6FA",
    "UCIvJ2ws0x3ulxR5EZ8ZzA2A": "#E4B54E",
    "UCIwHOJn_3QjBTwQ_gNj7WRA": "#DD8C97",
    "UCIxiVz8JLYTMXexmLh92S6A": "#FFCEF1",
    "UCIytNcoz4pWzXfLda0DoULQ": "#5C9BBC",
    "UCIzZDiilcPv0wim_MbuizFA": "#952D22",
    "UCJ0PCT2OVrvWGfSdrpG5Stw": "#F3F3F2",
    "UCJ0fibMPM-kGU_Q1UVC1tHQ": "#222222",
    "UCJ46YTYBQVXsfsp8-HryoUA": "#FFB4C0",
    "UCJ4O6PWA47f6XbCgrLQNqEQ": "#EBA5C8",
    "UCJ89J2nLMeH6aJPe2pg6-og": "#DA789A",
    "UCJCzy0Fyrm0UhIrGQ7tHpjg": "#FF76A0",
    "UCJEpkwwDiTKS5lxwFttEbIQ": "#1E0064",
    "UCJFZiqLMntJufDCHc6bQixg": "#17B6E1",
    "UCJtDr_tuvwv-lfN4Gejd5hQ": "#6971B1",
    "UCJubINhCcFXlsBwnHp0wl_g": "#094078",
    "UCJv02SHZgav7Mv3V0kBOR8Q": "#338D83",
    "UCJxZpzx4wHzEYD-eCiZPikg": "#7153AD",
    "UCJxwvbBoawRJtVgPgvMg-Qg": "#1766AE",
    "UCJz5aRHEMTL10zLfMj5hVmg": "#59467C",
    "UCK6vZrTlPNCrWzXHIgwDy4Q": "#B7002E",
    "UCK9V2B22uJYu3N7eR_BT9QA": "#B92731",
    "UCK9l6rTwU3hiSZijIMq51Gw": "#C34196",
    "UCKCb7zirdauYVUPokYvoNTQ": "#AED056",
    "UCKDJzAxTJrO14C8eJo-0TSw": "#6D9E60",
    "UCKMWFR6lAstLa7Vbf5dH7ig": "#61B7B9",
    "UCKMYISTJAQ8xTplUPHiABlA": "#B6C6F2",
    "UCKSpM183c85d5V2cW5qaUjA": "#F3A6EF",
    "UCK_lMxHpJFGCGz3gXJgaoQw": "#B2D1F0",
    "UCKpKC3M5fkcEvtOr06dmYlA": "#F5EB28",
    "UCKqRDf_aLT9kQkuLWkC0HWw": "#E7E9F4",
    "UCKu59gTZ_rdEmerdx5rV4Yg": "#429B76",
    "UCKuwxopq9c3cldzSOo4ceSA": "#20B2AA",
    "UCL0_lYZwyhbcNX-feoyCcJw": "#80B6D9",
    "UCL2wpb5XxrR2ObBxMp6nkvw": "#F27127",
    "UCL34fAoFim9oHLbVzMKFavQ": "#F7265A",
    "UCL9hJsdk9eQa0IlWbFB2oRg": "#EA5506",
    "UCLGFMR7JOmPUuLXRh0hliTQ": "#799AAF",
    "UCLK0cRXu3PY7cPbdWiVYemA": "#996699",
    "UCLLTq5nDGMGQwEmqeD3Yezw": "#7E7291",
    "UCLS28fzx6TqoccWmjzrG2YA": "#FFF48C",
    "UCL_O_HXgLJx3Auteer0n0pA": "#EF8468",
    "UCL_qhgtOy0dy1Agp8vkySQg": "#C90D40",
    "UCLbtM3JZfRTg8v2KGag-RMw": "#4E7FFC",
    "UCLeT7sAyMHTR-9tls7lzCMw": "#7F95E7",
    "UCLfAsY3iMUAF2vvDxvIjymQ": "#FFD34F",
    "UCLhUvJ_wO9hOvv_yYENu4fQ": "#B2D9FF",
    "UCLk1hcmxg8rJ3Nm1_GvxTRA": "#6378CA",
    "UCLlJpxXt6L5d-XQ0cDdIyDQ": "#000000",
    "UCMK2y_YNb3KheoeMemLyShg": "#A00000",
    "UCMLRP6a9la_Xi_0LGQKwlFg": "#1A1717",
    "UCMPKmFrLWgZyCGOw0QAEiIQ": "#95C6C6",
    "UCMp55EbT_ZlqiMS3lCj01BQ": "#FFD23C",
    "UCMqGG8BRAiI1lJfKOpETM_w": "#CC874C",
    "UCMu8Uwowp1c1-N3mLnZnflA": "#A6C8DF",
    "UCMwGHR0BTZuLsmjY_NT5Pwg": "#62567E",
    "UCMxIxoMdtcLkZ1wTq7qjztg": "#44536E",
    "UCMyuwtApj--U6jm-NFzZMOw": "#41CFC9",
    "UCMzVa7B8UEdrvUGsPmSgyjA": "#F6D4DF",
    "UCMzxQ58QL4NNbWghGymtHvw": "#BCAEE0",
    "UCN5bD1YYapThOeadG7YkBOA": "#E5F2FC",
    "UCN68LoM3khS4gdBMiWJO8WA": "#FFFEF7",
    "UCNGMMdEgYIUR6rC44v9aZ8w": "#FFEC47",
    "UCNRh9kkByBTYLo0IJupnAug": "#2C2C34",
    "UCNVEsYbiZjH5QLmGeSgTSzg": "#0047AB",
    "UCNW1Ex0r6HsWRD4LCtPwvoQ": "#F03C32",
    "UCO6mA1hC3Gv9jEoCTITjAQw": "#CC83A7",
    "UCO8WcDsF5znr-qsXlzZNpqg": "#D5345E",
    "UCOAD3RLV7uC3uc39ok7NLyg": "#97C3E7",
    "UCOg01LJmZF9UnwFbly73CVw": "#FFAA4F",
    "UCOyYb1c43VlX9rc_lT6NKQw": "#FF4133",
    "UCP0BspO_AMEe3aQqqpo89Dg": "#892EFF",
    "UCP19rQ5V-46B-6ZeLDJqp5w": "#444C7D",
    "UCP4g36UtLmGuqEUUIPLa1fg": "#FF9066",
    "UCP9ZgeIJ3Ri9En69R0kJc9Q": "#E171AC",
    "UCPH0ZS-AGZbt2JC51qFGrkw": "#CC83A7",
    "UCPLeqi7rIqS9uY4_TrSUOMg": "#358AC8",
    "UCPMOk4hbIh5A-_6uNhzAvDg": "#A07BC4",
    "UCPXWk2EYjlwaCj6p-XnLbUg": "#7057AB",
    "UCPb47fygHcFbRp_y05mS0IA": "#272529",
    "UCPd0Z22gF43dUidPYEQO5-w": "#665C87",
    "UCPkKpOHxEDcwmUAnRpIu-Ng": "#B4F1F9",
    "UCPqswBEjZm3FdvOzPyDw9wg": "#6537A3",
    "UCPvGypSgfDkVe7JG2KygK7A": "#745BFF",
    "UCPxSh63XjfSYJbkBLxM3fSw": "#FF1414",
    "UCPzB4ROWho13wC9ngTCz1hA": "#DC5866",
    "UCQ0UDLQCjY0rmuxCDE38FGg": "#FDAB45",
    "UCQ1U65-CQdIoZ2_NA4Z4F7A": "#F4A6C7",
    "UCQ1zGxHrfEmmW4CPpBx9-qw": "#FF5F00",
    "UCQ6LlsI7Bbj2yhSqLMI1gGA": "#D4A14D",
    "UCQLyq7TDKHlmp2Ufd5Z2qMw": "#B62E51",
    "UCQXuGcIoseWY5HmW6-U7teg": "#CB6248",
    "UCQYwIUCLqFoin7lHKmePjJw": "#DFCDBF",
    "UCQccGv1G0YL313NA28xTQ8A": "#85D6EC",
    "UCQfp96ujs7PXiUG6ov29RKg": "#EBE3F8",
    "UCQmcltnre6aG9SkDRYZqFIg": "#3B64BA",
    "UCQoK32rBoWhHTBIWOYsYC4Q": "#FF6F2A",
    "UCR0aSbKJnVenHPsmbBkIcDg": "#FFE49E",
    "UCR2Sp9fMxurwtmXQneAMTVg": "#A8A0CC",
    "UCR6qhsLpn62WVxCBK1dkLow": "#858ED1",
    "UCRJV_1aV4aZjFAEUn6o5arw": "#923173",
    "UCROQtXcp2loQEmvpe5rhJzQ": "#7B85FF",
    "UCRV9d6YCYIMUszK-83TwxVA": "#F8A69A",
    "UCRW3qJuYP8aODl7_5TXn_nw": "#FFB4C0",
    "UCRWOdwLRsenx2jLaiCAIU4A": "#756F7D",
    "UCRYh9eOSnwcT6aftSf8hYUw": "#3E79B9",
    "UCR_NmKXLzwhhW3E0tXHJglQ": "#E74790",
    "UCRcLAVTbmx2-iNcXSsupdNA": "#8AD1EF",
    "UCRjiAP_0KdYHGdMUBkpLVTw": "#FB8450",
    "UCRm6lqtdxs_Qo6HeL-SRQ-w": "#F74848",
    "UCRqBKoKuX30ruKAq05pCeRQ": "#38B48B",
    "UCRvkXFtB70ZADg4L6A8L3wQ": "#6CAEE8",
    "UCRvpMpzAXBRKJQuk-8-Sdvg": "#8FC31F",
    "UCS-XXTgVkotkbkDnGEprXpg": "#1E2232",
    "UCS5l_Y0oMVTjEos2LuyeSZQ": "#FF8684",
    "UCSCmu_VjL4RR7rBjrvSAwSg": "#BD3221",
    "UCSFCh5NL4qXrAy9u-u2lX3g": "#ACA7BB",
    "UCShXNLMXCfstmWKH_q86B8w": "#EF454A",
    "UCSiTkTBwIMwsAetwwzgFyBg": "#C7ACF5",
    "UCSjQDxud2HkAO2DVD3lwxmw": "#FF862E",
    "UCSlcMof1GIPvH6H_VcknCbQ": "#E45A28",
    "UCSw8TAyNIuPZc6gZqRKnO6A": "#D7B45F",
    "UCT4QDOBJMttHBZXhDnR25zQ": "#FFF3B2",
    "UCTEZGNJDqv-isWSPRsEhnRA": "#F9DE86",
    "UCTIE7LM5X15NVugV7Krp9Hw": "#AC324B",
    "UCTVSOgYuSWmNAt-lnJPkEEw": "#B8334D",
    "UCTZyqEU7dSXbc4b-NBolgMg": "#78B38E",
    "UCTbEua7o1f8I7EMBQlLjTpQ": "#98D6F2",
    "UCTqk8vac-qpZC8bn029lk6A": "#B88B64",
    "UCTvHWSfBZgtxE4sILOaurIQ": "#BAB9C3",
    "UCTxoJgb4DzMd7tiM8cvf4PA": "#5D4FE3",
    "UCUERxnZSjCq-G7OfYL7Nukg": "#C8D4DB",
    "UCUHTdqEOFW_X4wGPOIayzkg": "#4D9767",
    "UCUKD-uaobj9jiqB-VXt71mA": "#A2D5C4",
    "UCUP8TmlO7NNra88AMqGU_vQ": "#CDA5FF",
    "UCUZ5AlC3rTlM-rA2cj5RP6w": "#51B7A9",
    "UCUc8GZfFxtmk7ZwSO7ccQ0g": "#D24E5F",
    "UCUfkaeS_RMaZfIapykxldVg": "#ABC4FF",
    "UCUj4JItmvebxPBfmGcJHsNQ": "#6D78E2",
    "UCUtKkGKef8BYMs3h-3zQm9A": "#5AC8FF",
    "UCUtoueXsWIIwpb0joVtl6JA": "#779378",
    "UCUzJ90o1EjqUbk2pBAy0_aw": "#002FA7",
    "UCV0YFbQEkDoWewu-LOlLwdA": "#FEEAD3",
    "UCV5ZZlLjk5MKGg3L0n0vbzw": "#CC3D7B",
    "UCVEvMzXlpobF6hhfwfAYKJg": "#A582C6",
    "UCVKWgVm8BSlMkGZIDGaoElw": "#F1F2F4",
    "UCVZcw2SMyL6h5CfKSCs42_A": "#AECEA9",
    "UCVbRXkQP-LumaBzfw-wsrrg": "#34B8E6",
    "UCVo_KgPNsDKxHwzib7uarCw": "#A5D3C7",
    "UCW3wobzj-JJE_TNs7ysJPiQ": "#525054",
    "UCW5uhrG1eCBYditmhL0Ykjw": "#C7383B",
    "UCW8WKciBixmaqaGqrlTITRQ": "#A16945",
    "UCW98GVLrx8lG_ddOts3cl4g": "#BBDCF4",
    "UCWIPfdcux1WxuX5yZLPJDww": "#7EB1E8",
    "UCWQtYtq9EOB4-I5P-3fh8lA": "#FFE7B5",
    "UCWRPqA0ehhWV4Hnp27PJCkQ": "#FFD728",
    "UCWhFUlcawiD78qAD7zzS6Bw": "#2B3CC5",
    "UCWm9Si8uzmWg8lq18wCi6nA": "#EFA6BB",
    "UCWnQDjlXTLDyYowc3LaHyJQ": "#D3381C",
    "UCWsfcksUUpoEvhia0_ut0bA": "#266AFF",
    "UCWtr2UnCkvyFZnzKBQqG3lg": "#1A67B7",
    "UCWuahHb18QtcMAi_BMsStYA": "#EABAE1",
    "UCWz0CSYCxf4MhRKPDm220AQ": "#F4D35B",
    "UCX4WL24YEOUYd7qDsFSLDOw": "#909EC8",
    "UCX7YkU9nEeaoZbkVLVajcMg": "#2A4B71",
    "UCX88Pe54pxbJDSGIyGrzNdg": "#FEECF3",
    "UCXOV1n3Pd-5qAYurmw5nv5Q": "#F27127",
    "UCXRlIK3Cw_TJIQC5kSJJQMg": "#92F3A4",
    "UCXU7YYxy_iQd3ulXyO-zC2w": "#FFCB5B",
    "UCXUtikLthPFa5DDmgT3naGA": "#C0C0C0",
    "UCXW4MqCQn-jCaxlX-nn-BYg": "#625DA1",
    "UCXXlhNCp1EPbDQ2pzmmy9aw": "#6E51A1",
    "UCXXnWssOLdB2jg-4CznteAA": "#68222D",
    "UCXp7sNC0F_qkjickvlYkg-Q": "#F08437",
    "UCXtBTX9FKmRWN0OpHfbB2Ew": "#E6B18D",
    "UCXuXvC53isoiOUJKpUMSfLQ": "#A19BE0",
    "UCYKP16oMX9KKPbrNgo_Kgag": "#E2364F",
    "UCYTz3uIgwVY3ZU-IQJS8r3A": "#004098",
    "UCYcnLc0n1ryBDZeGWQTVJ_g": "#B182BA",
    "UCYjdP5F0ds2D6deMo5rpoyw": "#B73F90",
    "UCYxLMfeX1CbMBll9MsGlzmw": "#BDA4E4",
    "UCYz_5n-uDuChHtLo7My1HnQ": "#D60E54",
    "UCZ1WJDkMNiZ_QwHnNrVf7Pw": "#FEEDBF",
    "UCZ1xuCK1kNmn5RzPYIZop3w": "#42FFFF",
    "UCZLZ8Jjx_RN2CXloOmgTHVg": "#FF3D3D",
    "UCZVbzYgAUSRVWKG3x1Jo0bg": "#8C76C5",
    "UCZYl1o6ftRLKZP6U4KjQl3g": "#4C89D9",
    "UCZgOv3YDEs-ZnZWDYVwJdmA": "#233BA4",
    "UCZjjxaAK8FIB50pjYQ1BwRg": "#EB557C",
    "UCZmUoMwjyuQ59sk5_7Tx07A": "#CC99FF",
    "UCZphYueZZE2NVcriExbnkBw": "#C78476",
    "UCZrYHIPsKhYAXqOls2kQQNQ": "#BCE2E8",
    "UCZzBZtqCowlyG4ZXr6R_pIw": "#FDDAA0",
    "UC_1Gq60351AILDqzA7R9wFw": "#FFC054",
    "UC_4QF0dL-9XI9VajsNkMtmQ": "#4BB3CE",
    "UC_4tXjqecqox5Uc05ncxpxg": "#F1C8DE",
    "UC_82HBGtvwN1hcGeOGHzUBQ": "#44DDF4",
    "UC_GCs6GARLxEHxy1w40d6VQ": "#FF899D",
    "UC_WOBIopwUih0rytRnr_1Ag": "#9D3636",
    "UC_a00ml_EVDXSrtY8ZuyqGQ": "#2BF8D2",
    "UC_a1ZYZ8ZTXpjg9xUY9sj8w": "#D7AFA8",
    "UC_bxkbJzxRKssMf52wVbssw": "#243F85",
    "UC_cCW1xmXwRFp1tX-RD2X1Q": "#686278",
    "UC_eeSpMBz8PG4ssdBPnP07g": "#525054",
    "UC_hjHmi-ODGhHlSzD16p5Pw": "#FFF100",
    "UC_mc5xvNyQ-2W0UHgTA1mMg": "#AD2A3E",
    "UC_sFNM0z0MWm9A6WlKPuMMg": "#2233FB",
    "UC_upTZ0otpptV5KARBsnIPg": "#FFAB57",
    "UC_vMYWcDjmfdpH6r4TTn1MQ": "#73B5B1",
    "UCa1HO5wU6csVDePt9EPYqmA": "#FFEEA0",
    "UCa9Y57gfeY0Zro_noHRVrnw": "#F7ABD5",
    "UCaAu0DXNSPXCZPg6iHVwRVw": "#FF8C73",
    "UCaDO3fGfvXCP8m85ttSlYww": "#9385E7",
    "UCaGGU-1koAVWS1x_-xIiyOQ": "#A93558",
    "UCaHgUmTyQhth2s07ChoKJuw": "#EEFDFF",
    "UCaP317DiL6Lf9PmXaJK8N7g": "#B82E4B",
    "UCaRgPx8b0t6EjYwwzomXCpA": "#112A1C",
    "UCa_EIfw5I5uDlwsK6sc-83Q": "#A5D3C7",
    "UCah4_WVjmr8XA7i5aigwV-Q": "#F6F6F6",
    "UCaiEgZoOU7y4oAxnQbsR6DA": "#E9A8CC",
    "UCajbFh6e_R8QZdHAMbbi4rQ": "#B58C50",
    "UCam_xf14FPFsRshFTj4wkHw": "#54A2E5",
    "UCambvP8yxNDot4FzQc9cgiw": "#FAC31E",
    "UCawGfU44CZxd2ZVf_VGijbA": "#25C5EA",
    "UCay6Y3oEoiC6ZEE2G0UZu_A": "#4FC0EC",
    "UCaz2spGEjBzErnHLYOjZrHA": "#D4A24A",
    "UCb6ObE-XGCctO3WrjRZC-cw": "#E86A74",
    "UCbBLqA4HRowpj2JuLrkig5w": "#FFF462",
    "UCbJYvStAmq5Jm3nSDNSLT4A": "#D45B68",
    "UCbNEgJIF_ADD9e8-q7SoxCg": "#06BC3F",
    "UCbc8fwhdUNlqi-J99ISYu4A": "#683D46",
    "UCbiK7qUXAv3DtfLTXiPcvzw": "#E6B644",
    "UCbntVBSebvO5zT3cQYIxbWQ": "#75B1C0",
    "UCc88OV45ICgHbn3ZqLLb52w": "#FABF13",
    "UCcA21_PzN1EhNe7xS4MJGsQ": "#D17C85",
    "UCcDDxnoQcezyTUzHg5uHaKg": "#235AAA",
    "UCcD_EdnJcOjJMohDn435D3w": "#7770C9",
    "UCcRaKGCG3RFenb8D2php_Jw": "#3397CC",
    "UCcYrL_GQe8X8K2ARhw_Syww": "#EEB1CC",
    "UCcZ1qvY53A_fKoOmrfWGKlA": "#B83F3C",
    "UCcd4MSYH7bPIBEUqmBgSZQw": "#8B5095",
    "UCckdfYDGrjojJM28n5SHYrA": "#960018",
    "UCcrBog_CXR9gIsZH2u_Mj2A": "#90D329",
    "UCcswLVd6KGBf5mIdzeO83bA": "#818FBF",
    "UCcx3crxPFi006DUhb_YU-tw": "#FF6E1E",
    "UCcyiT8QT7fo7LrxXe1oxOoA": "#BA6EA5",
    "UCdIa_1lEL5c5RrGgIKptQrw": "#EA369E",
    "UCdMpGhtL9oK8EYolTt8v4uQ": "#191919",
    "UCdQ9LnNR6DTj52nrpRggexg": "#5D1111",
    "UCdVYY2166hyjUAMHwp2almg": "#FFFFBC",
    "UCdWQytF_syOGwaQQuxwklxg": "#F57590",
    "UCdXAk5MpyLD8594lm_OvtGQ": "#3C7C71",
    "UCdh-YF2gTzqDNu0VU9lwPPw": "#7D3CAF",
    "UCdi5pj0MDQ-3LFNUFIFmD8w": "#F1AB3D",
    "UCdn5BQ06XqgXoAxIhbqw5Rg": "#43BFEF",
    "UCdnKpUAm-dcxUFi81w8x8Cg": "#AD7CBD",
    "UCdpUojq0KWZCN9bxXnZwz5w": "#7FD6E2",
    "UCdrUdY5LsTHT1oS3szu1glw": "#B0FDE9",
    "UCdrbNcRAy424_FFWsY1A6og": "#9DABAB",
    "UCdyqAaZDKHXg4Ahi7VENThQ": "#ACBDC5",
    "UCe22Bcwd_GCpTjLxn83zl7A": "#5A7DFF",
    "UCe3tlAzxc9eEGKH5PGC4arg": "#537493",
    "UCeCWj-SiJG9SWN6wGORiLmw": "#606D3D",
    "UCeGendL8CO5RkffB6IFwHow": "#C92235",
    "UCeGrc0horTCU2DlnNo_FNAg": "#9BDCED",
    "UCeK9HFcRZoTrvqcUCtccMoQ": "#D7FAD7",
    "UCeLzT-7b2PBcunJplmWtoDg": "#D8346E",
    "UCebT4Aq-3XWb5je1S1FvR_A": "#EA930A",
    "UCej9K_bcaQdvDh49RkHYsUw": "#EBCB4F",
    "UCejbicoRnQjCOdAPAv5JPwg": "#A48ACB",
    "UCekc8SI533NI675r9aCBRcQ": "#CDCADC",
    "UCeqIMtLuGc3YgwkhEaG8oDg": "#27272A",
    "UCerkculBD7YLc_vOGrF7tKg": "#C93965",
    "UCewpvF9-zQyndzbB7t55XnA": "#D95B94",
    "UCez6PoUm-tuIzHLXiXDGKWg": "#9676CA",
    "UCf-QRi_9sjik_BZBn7lFY_Q": "#D8C4A4",
    "UCf0XdGC_TkebEQfoo63lg3A": "#B74E5B",
    "UCf57-IJn5mUJDyqd9uNEmrg": "#A50000",
    "UCfBkUgaJ6eqYA9_TX2cmq9A": "#4C89D9",
    "UCfKWQaZo28SJR-7ikfzAbEg": "#5DBBC1",
    "UCfMNN0I96oGbmJzCRCWgoog": "#EED423",
    "UCfQVs_KuXeNAlGa3fb8rlnQ": "#C57FC7",
    "UCfVSveW0-5LoLjM_SmkR2PQ": "#188F93",
    "UCfc4mTWCuWOQP9lHB19Tt4Q": "#79BBE9",
    "UCfiSo8tO3WPU-8YOgr4Ba6g": "#5D528D",
    "UCfipDDn7wY-C-SoUChgxCQQ": "#72D5CE",
    "UCfm05QV1b5BP0TSS842mF7Q": "#292830",
    "UCfoPMrULJvdKN8GlBZJwqHg": "#BDA4E4",
    "UCfpKZtsYneZVf6cvdcVyE_w": "#35367D",
    "UCfpWrWvbA34LmrZ9h4Lbwag": "#233E98",
    "UCfrWoRGlawPQDQxxeIDRP0Q": "#E99A4F",
    "UCfzP3R8QQ77ryTnHeEiBVMw": "#F58C35",
    "UCg7sW-h1PUowdiR5K4HlBew": "#365DA6",
    "UCgA2jKRkqpY_8eysPUs8sjw": "#FFAE42",
    "UCgIfLpQvelloDi8I0Ycbwpg": "#CD3796",
    "UCgPGVORhti-KKcV4CqUyumQ": "#8B68B6",
    "UCgRqGV1gBf2Esxh0Tz1vxzw": "#F9EEE2",
    "UCgTzsBI0DIRopMylJEDqnog": "#FFF33F",
    "UCgZ0pH7j6c9z-pkOG3PYw1Q": "#A58CDC",
    "UCgmFrRcyH7d1zR9sIVQhFow": "#C10E49",
    "UCgmPnx-EEeOrZSg5Tiw7ZRQ": "#D72517",
    "UCgnfPPb9JI3e9A4cXHnWbyg": "#B8A0CD",
    "UCh1BGjlKPa0BJqmeZerVrpA": "#C84870",
    "UCh2G4R2nto3ckemjB_2Tt4g": "#2FDAF9",
    "UChAnqc_AY5_I3Px5dig3X1Q": "#FEE039",
    "UChJ5FTsHOu72_5OVx0rvsvQ": "#B600FF",
    "UChKXd7oqD18qiIYBoRIHTlw": "#A09BD8",
    "UChLfthKoUV502J7gU9STArg": "#EE954D",
    "UChUJbHiTVeGrSkTdBzVfNCQ": "#D598DD",
    "UChV9GjZYgve_VtdcxTB1NcA": "#D9394E",
    "UChXm-xAYPfygrbyLo2yCASQ": "#F3A8B4",
    "UChdY64fJb14Nfnbs8EGdQig": "#6EB487",
    "UChgTyjG-pdNvxxhdsXfHQ5Q": "#0F52BA",
    "UChpRPsAeSZn5DistGacR3iA": "#CEA6ED",
    "UChpkyQ3O21OnkcMcgCoNHCg": "#FF181A",
    "UChwB-iMNTouaemKeS6NgOOQ": "#376A8D",
    "UCi6nuuHhOj_usxkjlcHdRXw": "#45418E",
    "UCiA-trSZfB0i92V_-dyDqBw": "#EB4682",
    "UCiBBDZ-ndtBgE4xKbswlgXQ": "#F3A4A9",
    "UCiJ_Um3KbfF19NzkDYLzZVQ": "#846FC7",
    "UCiLFvfLfq5MpS-x2vCy2Amg": "#FF1493",
    "UCiLhMk-gmE2zgF7KGVyqvFw": "#211B3B",
    "UCiMG6VdScBabPhJ1ZtaVmbw": "#FABEDC",
    "UCiSRx1a2k-0tOg-fs6gAolQ": "#FAD8DC",
    "UCiWkgRl4asSN5kRUSWgRLWQ": "#CEEBE0",
    "UCijNnZ-6m8g85UGaRAWuw7g": "#CC338B",
    "UCikyhPyuEu3rn1izGOGxZcg": "#6FA88B",
    "UCiphSlsDcJJQ7mDqR9Q3SdA": "#FFFFFF",
    "UCivDgaCAh7WPBoKA24WNwJQ": "#DC3F47",
    "UCivwPlOp0ojnMPZj5pNOPPA": "#C8C3DC",
    "UCj0c1jUr91dTetIQP2pFeLA": "#AECEA9",
    "UCj63OWl-HQ-I6ORzUWF1EDg": "#F1B9BC",
    "UCjFu-9GHnabzSFRAYm1B9Dw": "#DC143C",
    "UCjKPgy9YPt16z8AFMi-TLeA": "#9BB7E9",
    "UCjLEmnpCNeisMxy134KPwWw": "#393464",
    "UCjXBuHmWkieBApgBhDuJMMQ": "#85CAB3",
    "UCjXJYPsKxoJyc-1RPB6dSyw": "#B29CD8",
    "UCj_ptTHh9OboZpWfsDCoyjg": "#E60012",
    "UCjk2nKmHzgH5Xy-C5qYRd5A": "#89D8F0",
    "UCjlmCrq4TP1I4xguOtJ-31w": "#444C7D",
    "UCjoGLVLapRciX38bwgDtttw": "#5AB7AC",
    "UCjqlgGE9PA7xEbE6XW5Tl9g": "#CF4D73",
    "UCkDfBt3R64R2rRIrAQwldeQ": "#54518F",
    "UCkDri1T0PnXbjINqUsoDFrA": "#7295B6",
    "UCkEcY4RbLYs2AF45nhkyjtw": "#55AEE5",
    "UCkIimWZ9gBJRamKF0rmPU8w": "#C5EDFF",
    "UCkJYa9mVS25eHOO9bM7YK3Q": "#F4A6C7",
    "UCkN17JBEg63-17srUnyfWaA": "#5846CE",
    "UCkQ8i_cz0prqdo9jj__L93Q": "#BA6EA5",
    "UCkb-r702uhx4-6Lrmetp-Ow": "#80C8E7",
    "UCkeECSuB4aRbUyQrgR2SJOQ": "#6887C9",
    "UCkhViRjLUKgIcVpar9JiNrw": "#63AED9",
    "UCkngxfPbmGyGl_RIq4FA3MQ": "#3A8FB7",
    "UCkpqb53xiOvOgNYEbNpFSyw": "#D92731",
    "UCl1oLKcAq93p-pwKfDGhiYQ": "#B32F51",
    "UCl69AEx4MdqMZH7Jtsm7Tig": "#F087A9",
    "UClFSJcAQo0tm5ZnVZX-Kiag": "#E4C5A7",
    "UClMYGvekJOb51eBOCK-d4Dw": "#007328",
    "UClS6k3w1sPwlVFqK3-yID5A": "#96CEEB",
    "UClbYIn9LDbbFZ9w2shX3K0g": "#6D78E2",
    "UClcSEuDF_g_6g4snw_nAavw": "#E89CCB",
    "UCle1cz6rcyH0a-xoMYwLlAg": "#DF9CF4",
    "UClhLb5qSZy0Gvn3c-HuaInQ": "#9EDC00",
    "UCllB3f3DajAH6h2tWptsoUQ": "#9BDCED",
    "UCllKI7VjyANuS1RXatizfLQ": "#384B5A",
    "UClpOEZoIYhxIY6n5NNGaPbA": "#222222",
    "UClrQ7xhRBxS_v_-WuudGKmA": "#198CAA",
    "UCls95hH--nOEgKDjR2nKNUA": "#168F43",
    "UCm4QiJHdsgz9PshJkGMSk5w": "#DCA884",
    "UCm5rjZAFQuRrnDCkxnwvWkg": "#808080",
    "UCmUjjW5zF1MMOhYUwwwQv9Q": "#FFCACE",
    "UCmZ1Rbthn-6Jm_qOGjYsh5A": "#7CA1F0",
    "UCmbokzv5VTe9LeuzAFcDu9A": "#C45C6A",
    "UCmbs8T6MWqUHP1tIQvSgKrg": "#20318B",
    "UCmeyo5pRj_6PXG-CsGUuWWg": "#585C82",
    "UCmiYJycZXBGc4s_zjIRUHhQ": "#5165A5",
    "UCmms2EE02mK4zdECwrHBpaA": "#222222",
    "UCmmzr9DL0_t5ui1TAZjv-nA": "#D17C85",
    "UCmovZ2th3Sqpd00F5RdeigQ": "#B9ADB9",
    "UCmpEFsiD67ZOjn2CCJoo1mw": "#DC786F",
    "UCmqrvfLMws-GLGHQcB5dasg": "#95D0C0",
    "UCmtuXBKrUdFlVgFUrA4Kvuw": "#3E315D",
    "UCmw0eKk5uOv029SScRRRfqw": "#3B64BA",
    "UCn1Zf28m6WbhMDjMjdIjOIA": "#B18CD5",
    "UCn4XvlTXjGSvDynpxpOYZPQ": "#FA7D0B",
    "UCnBOUGfsfcD6nUbpdDAwMfw": "#FDEC84",
    "UCnJNNk45O1QYS2oMRYFKSyw": "#54518F",
    "UCnKt20HH_BiuID0FDHGMcvw": "#AD4E70",
    "UCnNLZWjl4GvVF4s8zBT9_kA": "#192F60",
    "UCnVbtCwr-5LXxUlGxsgD7sQ": "#27325D",
    "UCnbJ8LTbHrsRgqkxwJXCU8w": "#C31E5A",
    "UCngFYCS8p8PX9wf4V8kLVgw": "#DAE0F2",
    "UCnnR7k28ItzN1GAYx2rQ1rw": "#EEDDC2",
    "UCnrJK-sb3gSn3kRLkmpmzaw": "#8833FF",
    "UCnuAMfQpNCNT6ZHAL60kHwA": "#333231",
    "UCnvVG9RbOW3J6Ifqo-zKLiw": "#C7B2D6",
    "UCnzZmBOSrQf2wDBbnsDajVw": "#F1F4F4",
    "UCo2N7C-Z91waaR6lF3LL_jw": "#4DD7E3",
    "UCo6mwsozDGMW0UNGowBJGhg": "#8B0000",
    "UCo7TRj3cS-f_1D9ZDmuTsjw": "#80C8EF",
    "UCo96eJdTpPOrxHFztYajbtg": "#AAD9F4",
    "UCoAQsc-DQ0MjfTp059otQAw": "#D65E91",
    "UCoFEbNyIRUS26-hf2AucwFw": "#F7FAFF",
    "UCoVOQRAu354dQIG047gNkFw": "#B73A35",
    "UCoW8qQy80mKH0RJTKAK-nNA": "#BEFF77",
    "UCoXWDfyKkziR0C01Zp559-Q": "#B6566A",
    "UCoY9O-RYuBYHNf41pgQHCnw": "#F5B1CB",
    "UCoqSuOp1CpewXVdlA5SLvKg": "#D4F9F9",
    "UCotXwY6s8pWmuWd_snKYjhg": "#3FAFE0",
    "UCoztvTULBYd3WmStqYeoHcA": "#EF9AAF",
    "UCozx5csNhCx1wsVq3SZVkBQ": "#6A9AC3",
    "UCp-5t9SrOQwXMU7iIjQfARg": "#C71E3E",
    "UCp3tgHXw_HI0QMk1K8qh3gQ": "#FE739E",
    "UCp6993wxpyDPHUpavwDFqgg": "#266AFF",
    "UCpFAeyYSv4-7R1rC91c6DuA": "#646484",
    "UCpFy8D37SUStmeWh38NuppA": "#D6D3DD",
    "UCpJtk0myFr5WnyfsmnInP-w": "#FFEFD5",
    "UCpNH2Zk2gw3JBjWAKSyZcQQ": "#DAFFF9",
    "UCpPuEfqwYbpn7e2jWdQeWew": "#F4A0C5",
    "UCpRXCTyNNa-MnjhK6gisnRw": "#F9E072",
    "UCpYf6C9QsP_BRf97vLuXlIA": "#8728E1",
    "UCp_3ej2br9l9L1DSoHVDZGw": "#90B2F8",
    "UCpfjQCCavrO-rnKaAaIF9dg": "#F8B759",
    "UCpgM2Ycx8WC8eRNxGAL2i3Q": "#DEFE51",
    "UCpjypWF_wNRs9_TrjjWngpQ": "#77B6C2",
    "UCpxGLLkVwa2Q86w5Brok33g": "#38538B",
    "UCq4ky2drohLT7W0DmDEw1dQ": "#FF511C",
    "UCqXxS-9x9Ha_UiH6hG4kh5Q": "#64C8F0",
    "UCqYXJ5M55HWE6zyvl6rjIaA": "#5377B8",
    "UCqe0-vqZwAvZUb22wCMu1fA": "#8575BF",
    "UCqfXdQpIDb6nuTU_ZXd1NnA": "#BBDAFA",
    "UCqjTqdVlvIipZXIKeCkHKUA": "#BCC37E",
    "UCqm3BQLlJfvkTsX_hvm0UmA": "#F9AFB2",
    "UCqoEiw6_SK2qhZ6yHMWBUTA": "#CE8396",
    "UCqskJ0nmw-_eweWfsKvbrzQ": "#75C5B5",
    "UCr40BzcLiGruKe7M5gXR9zQ": "#AA0037",
    "UCrGTSXWMiAWoPlowSuMVZ4Q": "#8D725B",
    "UCrRdBPzK4sj-MMvYOhHRvHg": "#7DC7B0",
    "UCrS80YZ_-a_BaH_d8XL-3og": "#F7B87A",
    "UCrdeP-uXM5EPvAuxOA2Vxng": "#EE6885",
    "UCrhhJPNsOqzNIkUfTABoSpg": "#B14D4D",
    "UCrk73NgQe0XPjKTAa-nXzKg": "#397E83",
    "UCrt4cTM_sWH0iySLMkwwYLQ": "#6879BA",
    "UCryOPk2GZ1meIDt53tL30Tw": "#7B788A",
    "UCs-lYkwb-NYKE9_ssTRDK3Q": "#414141",
    "UCs9_O1tRPMQTHQ-N_L6FU2g": "#B84A67",
    "UCsEYnooncm-dmSHOrQfDM3Q": "#E3A4B3",
    "UCsFn_ueskBkMCEyzCEqAOvg": "#40CF84",
    "UCsNIVzD4AJ2FPLi9rY7I05Q": "#C85C29",
    "UCsQqk4cn8pljUeadYbUVgyg": "#FA1C9A",
    "UCsg-YqdqQ-KFF0LNk23BY4A": "#FBAF71",
    "UCspv01oxUFf_MTSipURRhkA": "#ABD3D8",
    "UCsqg6Jx6YhBhuq2jgw_uY7A": "#F27970",
    "UCsrH_eLD23MzxZAmbGMr0SQ": "#D2D2D2",
    "UCsxs_R8xnsQN4t-F_3qQ8PQ": "#558E8D",
    "UCt0-gubsgxcYTGc8MsJSaHw": "#7BB6DB",
    "UCt0clH12Xk1-Ej5PXKGfdPA": "#81D4E2",
    "UCt4-iv7EP0UU_w733D_r_jA": "#0C4055",
    "UCt5-0i4AVHXaWJrL8Wql3mw": "#5DCCAB",
    "UCt7GA5G4wbw4iSvEzwuqkqw": "#4E885A",
    "UCt7_srJeiw55kTcK7M9ID6g": "#691E8A",
    "UCt9H_RpQzhxzlyBxFqrdHqA": "#F9F1E4",
    "UCtAvQ5U0aXyKwm2i4GqFgJg": "#4B5F9E",
    "UCtC3B1n4XMiJmrDtu1Ni5qw": "#B9E089",
    "UCtHY-tP0dyykhTRMmnfPs_g": "#FFE632",
    "UCtLfA_qUqCJtjXJM2ZR_keg": "#E6325F",
    "UCtM5G3bS7zM8bv6p-OwoNTw": "#2556A7",
    "UCtQwleVyBMjBGNuUQ7a-KYg": "#769595",
    "UCtUq59HAr1UGi6TB6nCYtxw": "#1A1717",
    "UCtWH0tVAcUcSm4v96H5cAqQ": "#F2C5D4",
    "UCtnO2N4kPTXmyvedjGWdx3Q": "#FF5A00",
    "UCtpB6Bvhs1Um93ziEDACQ8g": "#C8F39A",
    "UCtyWhCj3AqKh2dXctLkDtng": "#F47DA9",
    "UCu-J8uIXuLZh16gG-cT1naw": "#35D9AD",
    "UCu-rV2gPtJ-CsGxe71z_BrQ": "#FF8C3C",
    "UCu2DMOGLeR_DSStCyeQpi5Q": "#239ACA",
    "UCu2n3qHuOuQIygREMnWeQWg": "#7D7999",
    "UCuDY3ibSP2MFRgf7eo3cojg": "#ED784A",
    "UCuDfldiO-ujdFC-36eYMl2g": "#ECBED5",
    "UCuGD1paDrwhDP-PJteOh-UA": "#EA8D55",
    "UCuI5XaO-6VkOEhHao6ij7JA": "#F266A1",
    "UCuI_opAVX6qbxZY-a-AxFuQ": "#E68638",
    "UCuX1NOTF2wZVXo8WP1q7uLw": "#D9EDBD",
    "UCucJYLJSEFRRfV2CA_JGHIQ": "#913F49",
    "UCuep1JCrMvSxOGgGhBfJuYw": "#EC1D2F",
    "UCufQu4q65z63IgE4cfKs1BQ": "#07A4E3",
    "UCuk7vapXKckSw6yCGGDspDg": "#CC213E",
    "UCulpRaJyJGOZc6ieSO5qt0A": "#609ED2",
    "UCupmjRr7kPgzXKh-cPxxGbg": "#B24D5C",
    "UCurEA8YoqFwimJcAuSHU0MQ": "#D1DE79",
    "UCuuAb_72QzK0M1USPMEl1yw": "#FFF321",
    "UCuvYHCPdMxfvjW_F9w5LmRA": "#CB424F",
    "UCuvk5PilcvDECU7dDZhQiEw": "#6E3FE7",
    "UCuycJ_IsA5ESbTYhe05ozqQ": "#F8CE86",
    "UCv0Igle5HiAqDFWz2GM5BAA": "#7E7291",
    "UCv1fFr156jc65EMiLbaLImw": "#A590AF",
    "UCv3EicDtxObcZZmnFcHvNnw": "#FF6A00",
    "UCvFgWnhRKSuTMHoh6fKAwhQ": "#FFF3B2",
    "UCvInZx9h3jC2JzsIzoOebWg": "#FE3D1C",
    "UCvN5h1ShZtc7nly3pezRayg": "#119A5C",
    "UCvUc0m317LWTTPZoBQV479A": "#FA96C8",
    "UCvaTdHTWBGv3MKj3KVqJVCw": "#B190FC",
    "UCvdnHDN9VpPFeLoB8BpPHFg": "#F4B5C0",
    "UCvj_cfALhRaO8dxa0Q6bgfg": "#E4A0A8",
    "UCvmSVAwFc5MJwQowsDvCTuw": "#EF9FC6",
    "UCvmppcdYf4HOv-tFQhHHJMA": "#91ABD0",
    "UCvob8U-yjPS-fSf5bq7jvGw": "#8CCBE6",
    "UCvq_7I63tALUzJJvFOrjHPg": "#B48ADA",
    "UCvuAdWg_I8U9kwVGZ4XLvog": "#FF99FF",
    "UCvvl-93S0KFGDEXDjYuUquw": "#AC626B",
    "UCvzGlP9oQwU--Y0r9id_jnA": "#E5FB67",
    "UCvzVB-EYuHFXHZrObB8a_Og": "#FEECD8",
    "UCw-kTlPnZYSHhlGMFJ17Znw": "#FFD264",
    "UCw0ty0mpHBx6xZt-K_hfNcA": "#9984C1",
    "UCw8bMzcXgX4SAQPraOJIVgA": "#77277C",
    "UCwBmSNUOWnowsju5YG7dT6g": "#4B526D",
    "UCwL7dgTxKo8Y4RFIKWaf8gA": "#93EC2D",
    "UCwaS8_S7kMiKA3izlTWHbQg": "#E55A9B",
    "UCwePpiw1ocZRSNSkpKvVISw": "#7E318E",
    "UCwjlRIySBvZ-kLV5bfjya4A": "#D0669A",
    "UCwrjITPwG4q71HzihV2C7Nw": "#F4E49D",
    "UCwuS0uY-Z2Gr_5OV2oFybFA": "#CF3E52",
    "UCx7aPMHI_kK1CP6zSvilHSA": "#AC626B",
    "UCxK9Lu1TjYqUH0FAOqW9EXQ": "#C4BEE2",
    "UCxOTQ01cBN86_QX3jbNnW7g": "#C1EAFF",
    "UCxTIuegV_Vqx11ctdeezPRQ": "#E4D571",
    "UCx_zwZuGIS4jxO07kFk8G6Q": "#80B6D9",
    "UCxerQlE0t1yY4bqeK5ldM9A": "#FFC124",
    "UCxrmkJf_X1Yhte_a4devFzA": "#FDCCD3",
    "UCxu7SxO5GaB9tDgDIaNGMNA": "#9AA5BE",
    "UCxy3KNlLQiN64tikKipnQNg": "#8C2341",
    "UCy8P3o5XlMpJGQY4WugzdNA": "#8C4664",
    "UCy91xBlY_Brh3bnHxKtjrrg": "#A50082",
    "UCy951eHJiaOED-G2hsR4CjA": "#7495CD",
    "UCy9mgxB8pn2C4aNK_MPthDQ": "#BB1F25",
    "UCyCbd63S29BuFOkJC2-aR4g": "#9262C8",
    "UCyD-4021fig0lxKSYK9DL-g": "#7F95E7",
    "UCyJOgJhgfoVRpFjsBCUmuvg": "#FFC6E2",
    "UCyJPVXNqCOm5jHaneVwde_A": "#BDA35B",
    "UCyLGcqYs7RsBb3L0SJfzGYA": "#BECCFF",
    "UCyRkQSuhJILuGOuXk10voPg": "#F78181",
    "UCyVypf7vg9KqoDiXkDIvetg": "#E9B1E6",
    "UCyXBNgCulibV9pRm3ZKpmoQ": "#C2AAE6",
    "UCyY6YeINiwQoA-FnmdQCkug": "#E76FA0",
    "UCyb-cllCkMREr9de-hoiDrg": "#3A90D1",
    "UCycU4fDdw0-SXsyjj2tvMVg": "#A0CDFA",
    "UCyn3sHnu7Q2D4vF7jhd6fzQ": "#8CBF7A",
    "UCyxtGMdWlURZ30WSnEjDOQw": "#54ACDC",
    "UCz6Gi81kE6p5cdW1rT0ixqw": "#D60020",
    "UCz6vnIbgiqFT9xUcD6Bp65Q": "#3E62AF",
    "UCz89MGFBrAqwJ5xMr5weSuA": "#DCFF50",
    "UCzA7j_ixOvBz39saDYlbRiA": "#99BEDB",
    "UCzArdRlyB498Ksl8BIiD6ZA": "#30363D",
    "UCzHiiP2r1zyTr8A1-6HtQtw": "#82ACC8",
    "UCzNXpqpdvlibmNc1JpM1o4g": "#D8E9FC",
    "UCzPv09-SJeVd1hBdpvlhy0g": "#7F97AC",
    "UCzUNASdzI4PV5SlqtYwAkKQ": "#FBA03F",
    "UCzbDTH6ennkRENJDBCk-NPw": "#FFEE8F",
    "UCzc8GwjUvecxpjhGtuewYOQ": "#D44B49",
    "UCzcuYIyP-1YcXC96t9J5yWQ": "#CC8F7A",
    "UCzhJ4os46kPnx3FCBdQ2oog": "#A8A0D6",
    "UCzsCWYuvPUky3-DKzphYbEw": "#FFE36C",
    "UCzuELV9IeEGNI3_3MUSNnow": "#763DC5",
  });
  // END V52 HEX COLOURS


  // Legacy starting hues remain for channels without an authoritative HEX.
  // The v52 HEX catalogue above takes precedence at display time.
  // The base catalogue uses selected_hex
  // in oshideck-channel-colours-v53.csv; additions name their source below.
  // Sources include visual estimates; these
  // are suggestions, not official colours. Recompute in OKLCH, not HSV.
  // Source SHA-256: 0d95a052d1b91f9bd95a52352242fb09b6f66e0bbe6dfd13f80a092df6b37f4e
  // Neutral colours live separately below: an angle cannot represent grey.
  // A saved channelMeta colour always takes priority at the point of display.
  const OSHI_HUES = Object.assign(Object.create(null), {
    // Additional researched choices are recorded in oshideck-channel-colours-extra.csv.
    // BEGIN additional chromatic colours
    "UCBY1b_TPZx3rA0F1KJnXkNQ": 243,
    "UC-C18fxv_QHfeqehxvFg4Cw": 169,
    "UC1T5x_U68wEEDFSfRyFdCIw": 303,
    "UCIBY1ollUsauvVi4hW4cumw": 26,
    "UC5Xse6X7vB_nUL5HvEFVo_g": 240,
    "UCGcD5iUDG8xiywZeeDxye-A": 341,
    "UC4oDk-npNekn3-uDH9OCt9g": 355,
    "UC2C3HWDnQXb1U-oM7UbtssA": 3,
    "UC2mv3m-HgSh-airJQfikStw": 252,
    "UC3i4x9_cRUfIBhtDDAlBS3w": 293,
    "UC1opHUrw8rvnsadT-iGp7Cg": 330,
    "UC4nXxql27UWzf1QBGwnI75g": 130,
    "UC6a14JXNCBk7cNa1vDIzgmg": 223,
    "UC8UZk3EE_LPxWNyQ7RUDCYA": 151,
    "UC9XmtaWbavinTxsZPEvgzlg": 226,
    "UCA1agVwWcSpYI0cBlONBaPw": 279,
    "UCAKCQHPyT8vmJ3mswx-2Fkg": 89,
    "UCAV0LixnS-1Hk_bh5Vl6Isw": 64,
    "UCS9uQI-jC3DE0L4IpXyvr6w": 57,
    "UCBhEGtQhpOQv2SYCnRW4JdA": 200,
    "UCBJ6nejlzes6mm9UruaxQsA": 251,
    "UCBxw5bdrbKO7E60E4s3KgQg": 56,
    "UCDUXQ86X-knLIM5fUgr3-Fg": 299,
    "UCEeaScyD5PrSIkzqOZc1ZZQ": 267,
    "UCEIMvzf3R9d3_2A3IAajvHg": 28,
    "UCF-SWAO8VnzhfA7STT1Fzyw": 294,
    "UCH5DBAOT0QyebrMzC7iLobA": 257,
    "UCKeAhJvy8zgXWbh9duVjIaQ": 159,
    "UCJd7dGbOFMI3tnr5KL4zEEQ": 8,
    "UCLks5TpWMCUy2wXvubBoM0Q": 297,
    "UCMGfV7TVTmHhEErVJg1oHBQ": 264,
    "UCNe668-4r9j7h2mXtGt0maw": 283,
    "UCNicQVuAQJYlCQKEw1TKn1A": 142,
    "UCO04CRN2riy-azjOWHQzLYg": 267,
    "UCRcwjvVdcCCKyfwktiVd40Q": 296,
    "UCO_aKKYxn4tvrqPjcTzZ6EQ": 134,
    "UCSy8MN4Y2FRRwhKYEyMTsJQ": 305,
    "UCV6V6YJLO0Zykeq1VD16txg": 243,
    "UCTiu8O_zSMwudxol_rg2dpQ": 0,
    "UCW0p7VdWVO0bn0_FELopJpQ": 357,
    "UCX35JkgOjZAZwZ2sgccZS4w": 342,
    "UCYSM0hcTDEyoOFoQifRoFSw": 232,
    "UCZ1OPUz_RXmOcQ96pa_6oJg": 231,
    "UCXTpFs_3PqI41qX2d9tL2Rw": 287,
    "UCZoPxlGeDKOmsOt-DnQe5tg": 86,
    "UCZlDXzGoo7d44bwdNObFacg": 252,
    "UC_6g75BMXyc-h2uOydZT5Yg": 356,
    "UC_88i5H7Bjei-rjCJSKRTGw": 117,
    "UCdWCSweBvoRJXFkPBuq0Eaw": 348,
    "UC_lRlTJ2E_e8DrdikQil6pQ": 1,
    "UCfwabonojH3KEHd8jNInjqw": 305,
    "UCh7gjyYRqRUmhpw5_EHXieA": 13,
    "UCiLt4FLjMXszLOh5ISi1oqw": 84,
    "UCjV8_1sCleLLBeWfV2hZlkw": 202,
    "UCjXuWDzZptBFNJLumkFeWvQ": 358,
    "UCjktj3JvUkCdhmm9UG_KINw": 296,
    "UCksKvMyNH6L-lfNSUch3hYA": 10,
    "UClsdKKXIhONjuN8FJH6w6sg": 65,
    "UCmrOHKPhWV1epCbTObd3eaQ": 2,
    "UCngjNluk0InGM3RShD_J_cw": 92,
    "UCln9P4Qm3-EAY4aiEPmRwEA": 263,
    "UCoinyAuvhTzmJKv12IIkMFA": 262,
    "UCovLYDGpaKHqdSDIl_1xjWg": 298,
    "UCpBoGqQmuEpa_uMmvtMP41g": 251,
    "UCveZ9Ic1VtcXbsyaBgxPMvg": 24,
    "UCoSrY_IQQVpmIRZ9Xf-y93g": 263,
    "UCrUdiKv9LERZmG_MKh63Xgg": 343,
    "UCrtxBD7M6ECazDbNqVhQM3Q": 252,
    "UCrwJvtphcyux30pAgoX68jA": 209,
    "UCuGMkxJA_icuiF01u8f3Y2Q": 268,
    "UCuUJ4A_PeZOFTD5koXQcg5w": 6,
    "UCvCzeR_L0PbngKQqYE8VncQ": 196,
    "UCw7iM67NS0RXhYHoxv-lpPg": 12,
    "UCsUj0dszADCGbF3gNrQEuSQ": 89,
    "UCzbCMNvFKxggVno_I2GfyPg": 288,
    "UCztyBDtIAJ5kDrWxcbNQW_Q": 357,
    "UCyl1z3jo3XHR1riLFKG5UAg": 89,
    // END additional chromatic colours
    "UC_1Gq60351AILDqzA7R9wFw": 78,
    "UC_2-KTGQKgChk4qL66ZRDaQ": 17,
    "UC_3dbXpajj5SAHLjSdvXJjw": 31,
    "UC_4QF0dL-9XI9VajsNkMtmQ": 218,
    "UC_4tXjqecqox5Uc05ncxpxg": 345,
    "UC_4x4gCnCkJ2o-VINN0AJ6A": 5,
    "UC_82HBGtvwN1hcGeOGHzUBQ": 210,
    "UC_9jY6w3QoWHHZZZ6CEP94A": 97,
    "UC_a00ml_EVDXSrtY8ZuyqGQ": 176,
    "UC_a1ZYZ8ZTXpjg9xUY9sj8w": 30,
    "UC_AGUYW4usybdi-WTZQcYxg": 319,
    "UC_aqfJwiavLQNMjURn-8mDg": 244,
    "UC_bxkbJzxRKssMf52wVbssw": 265,
    "UC_cCW1xmXwRFp1tX-RD2X1Q": 298,
    "UC_eiXiNIBK-GzmM1jiY7OHA": 109,
    "UC_Epr0if7tQfbCAIaWZjxbw": 28,
    "UC_eTRw69ofSNFq9UMI8-o2Q": 7,
    "UC_fBWkiqlYKSJYpov0fJNsg": 246,
    "UC_fYA9QRK-aJnFTgvR_4zug": 8,
    "UC_GCs6GARLxEHxy1w40d6VQ": 10,
    "UC_gDK44a-sfqo4Sa5La9DAQ": 101,
    "UC_hjHmi-ODGhHlSzD16p5Pw": 105,
    "UC_HrzgYmapddmGSfn2UMHTA": 3,
    "UC_kJ27jGTWYniW-Xy3Ms5Cw": 218,
    "UC_kXwuVBllPLND_2sUtlxjg": 204,
    "UC_lfOFwTCIvZsuaSvJQpNXg": 187,
    "UC_LTVw7bj_wFH4n8POeSNbw": 350,
    "UC_mc5xvNyQ-2W0UHgTA1mMg": 18,
    "UC_mXkuKyIkO1hYjSeMvbt5g": 285,
    "UC_n3V9K0VoEhGSO9ikOE6pw": 53,
    "UC_PPLxB-Ky6He9vtb1YxoSA": 2,
    "UC_Qm55Wp_qmHmOX1SGz8EwQ": 212,
    "UC_rlc0K8Yj0KQ5ApK0Z7uew": 3,
    "UC_sFNM0z0MWm9A6WlKPuMMg": 267,
    "UC_sz_JOzUB67ndUKK5Ax47A": 248,
    "UC_T1YqknD5yrpVlupc-ZXzg": 354,
    "UC_U07ZQRSTbmQcoPh976gdQ": 36,
    "UC_ulAd_3TQIlLRAo5zNhnoQ": 281,
    "UC_upTZ0otpptV5KARBsnIPg": 63,
    "UC_vDF8pbCIR8gaAxXAAH7Og": 23,
    "UC_vFNa_irvWQapwwaasYMOQ": 310,
    "UC_vMYWcDjmfdpH6r4TTn1MQ": 191,
    "UC_WC6plpIdL_buebR9vSVkg": 168,
    "UC_wo1VD3xVl4Y_J15Wxm2ig": 203,
    "UC_WOBIopwUih0rytRnr_1Ag": 24,
    "UC_ZISnImkFSj6R78G_HgUSQ": 319,
    "UC_zpkqFt7YByWaPi9Bxt7EQ": 55,
    "UC--0_8ZXQ7WIGdi68HEAb0Q": 20,
    "UC-1_-jUu-lALdGn9-MdBJ4Q": 231,
    "UC-6rZgmxZSIbq786j3RD5ow": 259,
    "UC-AbFB7r0rBunjIosvjGGhw": 275,
    "UC-bPnI0w5B5Enh74zvs3uyg": 228,
    "UC-FPAg1abIzzaXuxGKLUVXQ": 83,
    "UC-fyBdgoxN1VumuKcIB2bGg": 322,
    "UC-HM1zRR5d5nVK2rurtld5A": 2,
    "UC-hM6YJuNYVAmUWxeIr9FeA": 339,
    "UC-hMwvRuMsQrfgu0DPKLV2A": 13,
    "UC-jcaCw_DWLuWpcxVUjP2Sw": 16,
    "UC-JSeFfovhNsEhftt1WHMvg": 254,
    "UC-KMgJ1wl9DUV63HiUSGOXw": 25,
    "UC-KulM_rxrakqAcSE3YZORQ": 36,
    "UC-LAnFLXU9BusFv7n8lFj8g": 26,
    "UC-M0Poxo4VXMxdIzinqWOig": 237,
    "UC-mcWnkaoVLQi5ejXjkmPVQ": 29,
    "UC-nGHH-oxtPcmcbzrtSCrUQ": 56,
    "UC-nGRkqwcbCu2QOFDikyb_Q": 12,
    "UC-o-1qjKkMLq-ZFxXIzOUBQ": 256,
    "UC-O0yAOb7iu1I_XcF_2Pfhg": 302,
    "UC-paul1Nd8pnK2eAAtxAaYw": 351,
    "UC-ruxaqjQ5fP7q3UTWi4lWw": 0,
    "UC-s5vxXTaXyFLw8CZtzl_Fw": 237,
    "UC-SZ5Y0AHjdsF0DJPNH-hRQ": 158,
    "UC-tBLCGTheczDn5mYNoNWTQ": 65,
    "UC-Te05kGd9oiOQgETrg8omA": 305,
    "UC-tS2U8BB8qTo2tVhoZ30Aw": 233,
    "UC-VCv4n4N_ogpQoc7fEoqEg": 20,
    "UC-VWUn_oDeokHEkuTmVrLHg": 6,
    "UC-W-yaVIjqkXoh6dZ6_TcMA": 73,
    "UC-WHzySBtEqRNxWWYv5bSZQ": 300,
    "UC-WX1CXssCtCtc2TNIRnJzg": 253,
    "UC-Xcn8CwSsCea37J8ACmAkQ": 4,
    "UC-Xf6VJ6Q6SKYScPU6I7ZJA": 308,
    "UC-Y3evMx7MXbVeSbRKQ3gNw": 20,
    "UC-Z8ZmHmvv_5tinNQSDw0xg": 23,
    "UC01gb86Qdlkh23Nqk3A1OLQ": 245,
    "UC02dJeNmcQLqENdHFG1svJw": 189,
    "UC03w0ExR6gtBFK1AX72sgKg": 180,
    "UC04QM30wwa0qMs101Mwz29w": 24,
    "UC060r4zABV18vcahAWR1n7w": 17,
    "UC0asdlSa4Z-G0_axuU3_F3Q": 75,
    "UC0CYM871ANrJjGS_J5gG-hg": 356,
    "UC0dxRCCm9obKSTaamLSKbIA": 230,
    "UC0g1AE0DOjBYnLhkgoRWN1w": 101,
    "UC0GDyWNEjsxgKX_5zRs-h5w": 349,
    "UC0GjuNwvlcnNM4ZB71P8crA": 246,
    "UC0HX1e5jJnhN5Xn0epV2wzA": 5,
    "UC0InrNgDrH-4irmIVHT_dwQ": 229,
    "UC0JFt5Jjl5a__zOaZLqk7Pg": 307,
    "UC0Jt3GnPJyOjvXCNN2mIQug": 287,
    "UC0jZfhehuTG2C6CzQPnrYPA": 341,
    "UC0lIq8G4LgDPlXsDmYSUExw": 278,
    "UC0mEc9OzI-B9HRi1v-GCVBw": 358,
    "UC0nC50_Q8qvLbtFe6FtXpuw": 291,
    "UC0OiQzb1_Xmq-0I9AYUjCew": 222,
    "UC0Owc36U9lOyi9Gx9Ic-4qg": 89,
    "UC0PGk7z_FV1FFj3avz7_38A": 353,
    "UC0pz1TaDyqeO5p8_gbdeunw": 241,
    "UC0Qt-ycVvKBcP5J_Xz44zTg": 321,
    "UC0QzO6nK1cEDZvJSt2769Zw": 67,
    "UC0RKnoIQVBbNjaSd74u8X6g": 21,
    "UC0RSwNM5hbZ17nr8HoR6pqw": 346,
    "UC0TXe_LYZ4scaW2XMyi5_kw": 2,
    "UC0u_-3zgLkSYpQOxlBi-5Ng": 3,
    "UC0vAS7_q_wvHzxjFJegsOfA": 4,
    "UC0w_dvkIwnXzMak6gfeioRQ": 67,
    "UC0w13AZfaxfatdHdF-bhN3Q": 262,
    "UC0WwEfE-jOM2rzjpdfhTzZA": 357,
    "UC0xry7czPasj1wPxR8L0MZg": 13,
    "UC0ZTVxCHkZanT5dnP2FZD4Q": 340,
    "UC1_HUmjQShLtT_MuZjry3hQ": 294,
    "UC10BM9XdLdrvB8japwmRUvA": 29,
    "UC10wVt6hoQiwySRhz7RdOUA": 18,
    "UC16P6nSFhimmcjQKrdOx2IQ": 300,
    "UC18VFVHU39UjKn3dr9sVEKA": 334,
    "UC19jIOPqzpV05aqiGpceXYg": 2,
    "UC1afpiIuBDcjYlmruAa0HiA": 79,
    "UC1AqiQjSbkS_b--haYNkLrw": 320,
    "UC1AwHzhQtt6sOJND9MVe0zg": 357,
    "UC1bB4d5Bgv6XnZoN3Lk1qOg": 17,
    "UC1bgLL5EEaE9OmjzpeHdJ6g": 7,
    "UC1cExET9xoWSO9iSnRsW_1Q": 308,
    "UC1CfXB_kRs3C-zaeTG3oGyg": 12,
    "UC1cnByKe24JjTv38tH_7BYw": 76,
    "UC1CXNJGwnUUVawDeCwwOmFg": 303,
    "UC1DCedRgGHBdm81E1llLhOQ": 246,
    "UC1EB8moGYdkoZQfWHjh7Ivw": 135,
    "UC1FnOvfv5G6EkFIdUmbGGPg": 309,
    "UC1fvUNao61EenXh0KPFGSTg": 17,
    "UC1G-W2KsI74ytP_UEN6JBXA": 162,
    "UC1GH6W6CzBUCR_3oHegiBGw": 309,
    "UC1GQB6OqVMoFlHhQ9AagtqA": 31,
    "UC1iA6_NT4mtAcIII6ygrvCw": 282,
    "UC1JfFM6lXR4gUi7KtFS3GvQ": 74,
    "UC1JuhRTsFgZvi2ie2dTUxbg": 60,
    "UC1nhjH-Jrh7GH9y0Fma-dGw": 22,
    "UC1nqXaKzG4hd1SRFVra16gw": 351,
    "UC1NYgNBwE1i6dJNqljqhibg": 251,
    "UC1oApu0S5i57d-jSKUFB_1w": 7,
    "UC1ogmLVdMrU4HuLBUYtzjVQ": 274,
    "UC1QpNAV9xNS5P-yAwJLi07A": 335,
    "UC1sBUU-y9FlHNukwsrR4bmA": 172,
    "UC1suqwovbL1kzsoaZgFZLKg": 3,
    "UC1tRqQTI3Bchs8XvUnj8yvQ": 70,
    "UC1ucgoC_sGww_Euu5iMqpQw": 322,
    "UC1uv2Oq6kNxgATlCiez59hw": 316,
    "UC1uzMZ7x_Hgun5t8J9uFanw": 15,
    "UC1vawzfbCnRpHT9SJ5pHlHw": 13,
    "UC1VN5GzTwrOrn70zgEm6T3w": 119,
    "UC1yoRdFoFJaCY-AGfD9W0wQ": 288,
    "UC1yZAPWNLVtfCX43IQS0gTA": 264,
    "UC1zFJrfEKvCixhsjNSb1toQ": 72,
    "UC1ZRXoTQUwZtKnpOfJwGNPw": 312,
    "UC22BVlBsZc6ta3Dqz75NU6Q": 3,
    "UC23pFx4llMrwDvGJ7DqT87Q": 28,
    "UC25e5qEqvVaG_VKrkTmJBmw": 207,
    "UC29M0uAc9KHk0zvKvEF5J9g": 50,
    "UC2bdT8e-zTkJJMe-IngnyYA": 272,
    "UC2BJwSA_iewqrMHX9rrO59g": 8,
    "UC2c8dQYdDadn7tmK_d7o-HQ": 359,
    "UC2D3bE_eERCvHzpBY3O9JZg": 272,
    "UC2daHxnuJJBM5NWci1RRkeA": 248,
    "UC2dJpxRY3LdQMasgyxPpQ3g": 47,
    "UC2eai5waelgobAHgp20DEYg": 2,
    "UC2f11iZvrPBtA_S1LE2soeA": 167,
    "UC2Fq5PKMRbTSo3hqhu8u1yw": 18,
    "UC2gPbOjo_NM2QeroArW8Yeg": 225,
    "UC2H5XpafT4is1p3e5WkwLpQ": 206,
    "UC2hc-00y-MSR6eYA4eQ4tjQ": 27,
    "UC2hWFlqMew61Jy6A8zu5HzQ": 0,
    "UC2hx0xVkMoHGWijwr_lA01w": 63,
    "UC2ixjT9UHeAvaXh1VWpZqDQ": 295,
    "UC2JWNoJJ8MRZkgINm2IhH7Q": 81,
    "UC2KsKo_1ZYQ-dAyTDOnnbgw": 355,
    "UC2kyQhzGOB-JPgcQX9OMgEw": 219,
    "UC2L0MeiLsfJf4rH_xTVteDw": 86,
    "UC2LODZvn-QQupykmwxey4zA": 340,
    "UC2Ne6dDcFxnM2hCBLii3IUg": 293,
    "UC2OacIzd2UxGHRGhdHl1Rhw": 302,
    "UC2QDfOhHX5IGG2qYPqCJrAQ": 2,
    "UC2rIXE0D3Vb8kS48DQrW-Jg": 7,
    "UC2rmkvDYT2qUHtOFbV1BHJw": 230,
    "UC2Rr7mILebYLTjd38DNNUTw": 6,
    "UC2S-27qpqjfenPrKPnOe3QQ": 35,
    "UC2toBGGpb84zYhDngC1JrHg": 53,
    "UC2VxkfMItkdPH4LGRtraHsA": 265,
    "UC2x1yPEJF2qe_m8B6tgpUNg": 5,
    "UC2yM1hTd8WNSdeS-zrnvxhg": 0,
    "UC2z7pz25bgnqLHdTd7EvVoQ": 218,
    "UC2ZMWtbW9X81hnlV7gT5bGA": 358,
    "UC2ZWggon1NOT2TGaVUMzY7A": 349,
    "UC36FjFoN0H6Y0D8sRCUdEaA": 21,
    "UC37P2To-pPbd11ocMZ9SyWg": 1,
    "UC37QJeT8wHMoZlMasJ7CEbw": 18,
    "UC39D2lMvqRys9KBFueRWGtA": 83,
    "UC3A2bvlNUaupHIwKw5_cgTA": 191,
    "UC3aEtHpGzCFvoSn_wRWzgZQ": 306,
    "UC3AYtmMNdJczCvQNoPy-gjw": 135,
    "UC3BJY6I0IBn14NTBNnwKncw": 23,
    "UC3czs41x7HD5-nk_cZ-Eo3g": 259,
    "UC3EhsuKdEkI99TWZwZgWutg": 234,
    "UC3eXEL0ZurrfG774l4qIqtg": 9,
    "UC3G9ynwAEyiZU-87j6PkQLQ": 260,
    "UC3GangzfplnY9jiahVA1jZA": 24,
    "UC3iwL9Yz8LcKkJsnLPevOTQ": 24,
    "UC3K7pmiHsNSx1y0tdx2bbCw": 349,
    "UC3KldSym-HTLMkvitStsNTw": 20,
    "UC3lNFeJiTq6L3UWoz4g1e-A": 101,
    "UC3nvv0yK889EA7m3IOjkycQ": 87,
    "UC3oBWCwi2UtckYvMbtIOWVA": 277,
    "UC3OH5FKQ3qtl4uRme_vZTgA": 290,
    "UC3oQOQiSqiep5vmkuJe3rkQ": 293,
    "UC3ql_EU4JnaE3Rh3cqbHu6g": 119,
    "UC3qnb4Sgo4QtiOi8iS7jOsQ": 250,
    "UC3rmrlimhWzTsJ1BxY6-p1w": 242,
    "UC3Ruo_5doyu514PesWGvCAg": 243,
    "UC3uoOH4N2F4T9FyAGDwM6Ow": 271,
    "UC3uUvmAEpMb6Pqilssmyksg": 23,
    "UC3VN9h8fokwB2XURWHNcdWw": 0,
    "UC3vzVK_N_SUVKqbX69L_X4g": 97,
    "UC3Wxd3RwdF-3gwt-Bud0oEQ": 350,
    "UC3xQCiEPSkco54WhuiDcngw": 7,
    "UC3Y0iRx4dZzvj5-jTlNTKJw": 12,
    "UC3zSmwgOOIjWUbus4cZIUPg": 331,
    "UC3ZTQ8VZVCpwLHjFKSFe5Uw": 24,
    "UC44UTXb_8AL3bUoC-BR189g": 189,
    "UC46Vheyn2Wlc65fVGlzfO7A": 39,
    "UC47rNmkDcNgbOcM-2BwzJTQ": 60,
    "UC48jH1ul-6HOrcSSfoR02fQ": 196,
    "UC48qNNNCDGtjuPBvA8jxHew": 335,
    "UC4BuiOb_qxQkylq4k6wMQBw": 172,
    "UC4g6i7aL2fn2EME3r9fEHxA": 246,
    "UC4gwEpsyFnrjkMNOoevY8Rg": 355,
    "UC4J0GZLM55qrFh2L-ZAb2LA": 3,
    "UC4l9gz3q65lTBFfFtW5LLeA": 258,
    "UC4lCGN8XFyThIK_E2dlwIow": 82,
    "UC4N6zk5qzKRZeVwBgz4T3qA": 4,
    "UC4NdM7WwMvyGzkUr0dsSGJQ": 26,
    "UC4O6SxnRVSJTsoCOzpkIpeQ": 270,
    "UC4OAmxLab5tVF094Sgry6hw": 258,
    "UC4oIghT3W9Y99nyiNCTXwlg": 79,
    "UC4pEixMozb6UnOtwg5Uew-Q": 265,
    "UC4PrHgUcAtOoj_LKmUL-uLQ": 95,
    "UC4R6ddhBJp2bjQHVNxgNQSA": 226,
    "UC4ROXPtqFQ9SwH0umadkm3w": 43,
    "UC4sjhgnEf2AQJRuxfWj30-Q": 332,
    "UC4TbMZUg3PnxtR1AuCQK8hQ": 281,
    "UC4x2o7dyxOqFLoA9NKxf0Iw": 305,
    "UC4Xuz67FNRr69ILv2b7ZRBA": 264,
    "UC4Y7rOgtVgi2-POi0av8QsQ": 230,
    "UC4YaOt1yT-ZeyB0OmxHgolA": 4,
    "UC4zu-mCE7jUO2izoO8Hr3iQ": 9,
    "UC5_5l_AfpgJeYCxQnMnL-7A": 5,
    "UC5_ygk4jcNx-QSkpaBbrhAA": 24,
    "UC5-DtmP44TYaMLzdUaBDYdg": 14,
    "UC5-rTA2awTo0NC4dd2zxDuQ": 27,
    "UC53UDnhAAYwvNO7j_2Ju1cQ": 17,
    "UC54JqsuIbMw_d1Ieb4hjKoQ": 345,
    "UC55-Y4cBl6alNaaOVVEYgSA": 18,
    "UC56Afo5ztcjEHJ3OkLsXNCA": 359,
    "UC5aALuwwcRa7WzWHK93AYeg": 27,
    "UC5bCRde8xRrNS7s6GjCNCyQ": 2,
    "UC5bHZZ2df6_oFgOM_34_-aw": 11,
    "UC5bTzks2uWlrJUqZLrew0uQ": 301,
    "UC5BzXtjnKt1fjEDjEJwx5JA": 18,
    "UC5canh7-1Ff_UfAi5CjOntw": 270,
    "UC5cbSyFTohO2_PJAqr-6NFA": 1,
    "UC5cfZwtKV3JGLF-S84mV21A": 22,
    "UC5CwaMl1eIgY8h02uZw7u8A": 208,
    "UC5dJFf4m-mEcoyJRfhBljoA": 24,
    "UC5Ejf_RIWMVDAjA4B-GV5Zg": 45,
    "UC5ek2GWKvUKFgnKSHuuCFrw": 277,
    "UC5EKOQyVgU4VAu7IaAjj_GQ": 244,
    "UC5h78w2RPLcbNgumHHVi3lg": 264,
    "UC5J9kElSRDDlaQc2-BSKLoQ": 3,
    "UC5k10NU6ES_BuV3KxD4MMXg": 11,
    "UC5k7bnDqybM_etGKfVMXWvQ": 22,
    "UC5KnT0tNsYVVh44lQj-S1JQ": 207,
    "UC5LyYg6cCA4yHEYvtUsir3g": 261,
    "UC5oghoJUIvFHnLZaz5k34rA": 250,
    "UC5pN7zP6awYB8igfmrOCo0g": 77,
    "UC5qlAhrec6-0J-K3zmhNPPQ": 13,
    "UC5Qv2tPOI38OcnqOdUKkn7Q": 294,
    "UC5QZFeVsxNcNlKKqPqUaw6g": 5,
    "UC5RSxmHP5c4pU9Og1Pxx4wg": 13,
    "UC5SSy3julTJHzmExQJjLUkw": 11,
    "UC5T2QBQ0XO5Iosds77YDKdQ": 343,
    "UC5TT9EvGte5Ewkm1KehOM0g": 234,
    "UC5UItsTdKsAW2dq249v_tVw": 21,
    "UC5Uk0gpE_kyIPQOXCNsC8Zg": 245,
    "UC5UPG3fV3zzuq-JLPw-XdWQ": 226,
    "UC5V04t-yK32p0ljhSIUwgOg": 81,
    "UC5VWF53rrEiuYvO5e5Ecn9Q": 24,
    "UC5wRGdgN_GufQwuZiQwu87g": 200,
    "UC5XIu3FhgIHwqcCGj-tmONQ": 357,
    "UC5XQhzMH08PgWa4Zp02Gcsw": 305,
    "UC5zO6IFsWSUHMYgJMv81XKg": 274,
    "UC6-PjHkMsgFCwoFwR4VJnKA": 10,
    "UC61AvqhGo0_YFKBLMwlTjrQ": 8,
    "UC61iJVuFVS4YsnPkZe5EmXg": 71,
    "UC61OwuYOVuKkpKnid-43Twg": 209,
    "UC62ZEUM6JGZfb8poeIx0ypA": 233,
    "UC63nyTp3ImzCaqIYS_tg3nQ": 24,
    "UC6441KFh3-Bp09EVE3F21rg": 228,
    "UC65MNFVWnrkOpg04LBHVvzw": 249,
    "UC65wXpTcj-4P1TAmOvwUjMg": 281,
    "UC66DRsVkzrPAp6hZV7-HBGw": 138,
    "UC678sJnqTwlsWwNk2RWRK2g": 48,
    "UC68J5pWEshmwhDH45qnpIsg": 17,
    "UC6afmhtxKI41JV60jmY9i8A": 116,
    "UC6b4Ta_J0wbylnPu1auaQiA": 53,
    "UC6B5ARoyTKS5S3-mz2WzYig": 54,
    "UC6BCNzMKS01UZT90lrwA1bw": 349,
    "UC6bD0BolIyRtVCXL0SKn8Yw": 58,
    "UC6CpUl2thiDslRorMhd00HA": 20,
    "UC6eO0HeHQquRW9lUxB5-H7Q": 253,
    "UC6eVhk2wg_MqHdLcB1kPvGw": 44,
    "UC6eWCld0KwmyHFbAqK3V-Rw": 353,
    "UC6FprWVXuULaY9mZOcqTe4A": 356,
    "UC6GKE9PDS2XvxRQO9nDikAQ": 287,
    "UC6gpXa7q5HMznbXZxdnS8og": 263,
    "UC6ixLgVB4D6ucEXb4VhZ-PA": 4,
    "UC6JfDgBYHkm2msYAPEq8kjw": 80,
    "UC6jIRnaSirTNF6D0vZMUbHA": 205,
    "UC6JkRqQXgdvmkBrc-fIl5RQ": 284,
    "UC6K3oijuMQZYOH2D4hpoAzw": 283,
    "UC6lZLAOgSYgJ6ZkW2ZTI75Q": 2,
    "UC6NXFJInhUYGdKeFHhPrtpA": 15,
    "UC6oDys1BGgBsIC3WhG1BovQ": 304,
    "UC6Q4UI5mEjeZOIRoTtRoFJA": 27,
    "UC6QdZ2aWHZ4M1eJD3GGoVjQ": 30,
    "UC6SbFlqvhVWRbfKpHgTNLpQ": 11,
    "UC6sdN8CPm7v3UeV2mlqXmVw": 257,
    "UC6T7TJZbW6nO-qsc5coo8Pg": 90,
    "UC6TyfKcsrPwBsBnx2QobVLQ": 66,
    "UC6uDDNT7Hq6elq6FZ21mtKw": 9,
    "UC6W1rDne4LOYK4XLpvhW6ow": 0,
    "UC6WFKwYptsxVue56Lx218vg": 279,
    "UC6wK3Ss43qm5U2i0TtOIPVA": 12,
    "UC6wvdADTJ88OfIbJYIpAaDA": 311,
    "UC6Y1T_UZoNiosOZYjT_G5_A": 270,
    "UC7_MFM9b8hp5kuTSpa8WyOQ": 257,
    "UC7-N7MvN5muVIHqyQx9LFbA": 88,
    "UC7-YM5BhR-FCZloquRE7XGw": 36,
    "UC72_UWR1CAQhC-Kg48e5mjA": 28,
    "UC727SQYUvx5pDDGQpTICNWg": 89,
    "UC77FLsC_6ZmjhZ7BA5uV_KQ": 234,
    "UC7A7bGRVdIwo93nqnA3x-OQ": 351,
    "UC7b4GklPQO9ZnV7mqnJzN8g": 287,
    "UC7Bb4I4tUzj1ftJI918QJsA": 86,
    "UC7cbT3b-qUwhyBWqNstcTVw": 8,
    "UC7CtvN04ublW4LGTPksG6mg": 229,
    "UC7cZJOAJZD1W4aOfqnRgWiA": 1,
    "UC7DaZyAduAWrvUr4P-JSuag": 354,
    "UC7DeT_Ine2b3ZCTL8-ULjlw": 62,
    "UC7Dnvsvhbk9bE5njFbLIqTA": 62,
    "UC7EJ9bOU9uPfbsfywy26siw": 302,
    "UC7fk0CB07ly8oSl0aqKkqFg": 31,
    "UC7Ft50QAmUGWE6-ZfrHOG5Q": 36,
    "UC7Gb7Uawe20QyFibhLl1lzA": 91,
    "UC7Gow-kNHq21oejSIDg9PAg": 304,
    "UC7gxU6NXjKF1LrgOddPzgTw": 304,
    "UC7hffDQLKIEG-_zoAQkMIvg": 243,
    "UC7HixHznciTQf1DhlbBIZmA": 291,
    "UC7hvBaGXZJVLdIYlzo2deRg": 5,
    "UC7IdRPIpYBiNUa-r3feKU_g": 262,
    "UC7JgL7h5ez5Gj9QpKCzfAAw": 353,
    "UC7LRnlZbik6ucW9rSHFRsyQ": 226,
    "UC7n6HE5VYlWt7DPfjsS084w": 83,
    "UC7pyDZz-462KRaXl-khhDEw": 142,
    "UC7qN-AkrKqVu7uRvugXKirw": 358,
    "UC7quFGFol7Jjeu1-Qq3Fe7g": 314,
    "UC7r_ajmyUak6yNDhQe2mCMw": 245,
    "UC7rCW7EL6i3XKKaD1M6gdPw": 17,
    "UC7rJCvM01Mhfo_SGH22TraQ": 307,
    "UC7WtdrXXd9_wl5nEGbt12Yw": 58,
    "UC7WY5VP-P-rSb2ES5npk8yA": 13,
    "UC7wZb5INldbGweowOhBIs8Q": 20,
    "UC7XCjKxBEct0uAukpQXNFPw": 261,
    "UC7Xglp1fske9zmRe7Oj8YyA": 297,
    "UC7yqc24BjJwi3PoqhXrx6og": 196,
    "UC7yrCBpBQCDCLT69s-vrqZw": 28,
    "UC7YXqPO3eUnxbJ6rN0z2z1Q": 131,
    "UC8_Zs00o8Zi9OHh8tJKfUGg": 350,
    "UC80TduEq6Sp4n2DkiUH2eLQ": 262,
    "UC84RYorF7UcJzt_iAYXBisA": 4,
    "UC88ZNo9FPHOOhlQhOkC0qIA": 28,
    "UC8aUF9ipzQb2jTHlFoFZ1Vg": 6,
    "UC8B_DxK43PEVEiJSWVXTkJg": 235,
    "UC8b1sw-Q6bO2PWB8up-WTDw": 5,
    "UC8b4lauZhOthwRArWCQWQig": 308,
    "UC8C1LLhBhf_E2IBPLSDJXlQ": 353,
    "UC8CKGSvp9bRfmtWyfV5L9Jw": 16,
    "UC8D3XmwYEr97q-tuNZjUuww": 29,
    "UC8eitCE9Z6EwUCs-VUi1blg": 247,
    "UC8f0CKYBVo4enRKF00XIw1Q": 41,
    "UC8g5_Cua_Q8dkrbRl4uDEkQ": 21,
    "UC8g9B0-uh7cu8qcVkD_NTKg": 12,
    "UC8gJr3tLptRXptffkHyfhTA": 266,
    "UC8jskpQfW9fn2NLK3PdaGdg": 218,
    "UC8L07dTOhR4-uOXTbIDWEnQ": 81,
    "UC8Ltb0-WwIoEhmCrMzM01ww": 7,
    "UC8mnrvXyUWJZ4bB5XBLZpjw": 300,
    "UC8nI5_ywGQRJp0ExVt04ypQ": 299,
    "UC8NZiqKx6fsDT3AVcMiVFyA": 227,
    "UC8OFxPZN69Y0YnYlQ7LNl0g": 299,
    "UC8oLBzcFC-aXPd0q-WuGWSw": 353,
    "UC8OvqHdB43m1ot3Z1I3rRWg": 229,
    "UC8PMqEDpXcsooyDGiLvxs4w": 26,
    "UC8QBbRXJ9-_y2ho3z3qnALg": 218,
    "UC8rcEBzJSleTkf_-agPM20g": 12,
    "UC8SJPcLpIM3x8RdBJFfiluw": 198,
    "UC8Snw5i4eOJXEQqURAK17hQ": 200,
    "UC8TVZmQuOl0GNbpvThwwSdQ": 308,
    "UC8vKBjGY2HVfbW9GAmgikWw": 11,
    "UC8VlcljjGFb4-Ny2Heb0-ew": 235,
    "UC8W8jZ1P9bhJFYLelr3EvIQ": 28,
    "UC8wbgnQSyIZ_F16m5GuT8Gw": 189,
    "UC8xAtvAk_HX1j3egTO7ylIQ": 17,
    "UC8XL4U2dRKDi4DcjsPnc4Zg": 71,
    "UC8xsCroRQKmQt0rXKuYQQyw": 267,
    "UC8yXRB_jKDeapwQak2i30EA": 259,
    "UC8zgKaS8LiyL28mdhRC2nBg": 22,
    "UC8zMlzy_5Eq5-6kB_5HjYjA": 293,
    "UC8zQumEzXBpWSmbHmr8wMKw": 158,
    "UC90vyzmRgWCE17-uWNsKW2Q": 47,
    "UC9127w5CLmWugWcpdGGuKOA": 52,
    "UC93aWyXK1NuUnRumFxU7X3w": 324,
    "UC97JZwjhKFJ3HwrGkcJekSw": 309,
    "UC98iRMvRqUxRD6GP4NtRskw": 276,
    "UC99kOG6_9RD0mR3OG4EOfxw": 354,
    "UC9AyD8AoWSKovWQWYsNzL4g": 19,
    "UC9DljBnS6LkeM08llrd_mJQ": 22,
    "UC9EjSJ8pvxtvPdxLOElv73w": 4,
    "UC9HYkiQZ1_b3J_F8gc12eaA": 285,
    "UC9iiZCKQ9jnIM7zZ_mRX_cg": 249,
    "UC9jM73Rqa_4Ec4PknBHG9pQ": 109,
    "UC9LF4J85zAG-6T-OjpcezOA": 315,
    "UC9LSiN9hXI55svYEBrrK-tw": 4,
    "UC9m0sk4JMYCn4pEYOz91Cxw": 65,
    "UC9Mfuai-qdXnTTFN0Z3hkAA": 222,
    "UC9mydBOLdL6-Fp61paK68Tw": 152,
    "UC9NVe55fqFSC9iOZQJrlwrQ": 302,
    "UC9OgjjQe70k5NwLoyHaJ2Xg": 247,
    "UC9p_lqQ0FEDz327Vgf5JwqA": 283,
    "UC9pXpmr_eYeVMGS0lVt5vuw": 62,
    "UC9qEMAQQes2PNcBXYSF-X7g": 91,
    "UC9qIcw04sIf1cYXcIxndcoQ": 264,
    "UC9r8dNEoXdIpYTnoMVFwzhg": 316,
    "UC9ruVYPv7yJmV0Rh0NKA-Lw": 236,
    "UC9T8MuP8ogpFGMQT9gAryIQ": 265,
    "UC9tOWVNzMaXDD5SxKP1zAug": 91,
    "UC9U4j8CEI8XUYwhPuGwnXAQ": 31,
    "UC9V3Y3_uzU5e-usObb6IE1w": 82,
    "UC9vINYqx4LrpK545qkKFPPg": 288,
    "UC9Vq5c7FKEHLstvmSAsogXQ": 354,
    "UC9VqnG2Yx--wWitfHvJRe9A": 90,
    "UC9waZzsHhV-IsUuN7PReyfQ": 353,
    "UC9wbdkwvYVSgKtOZ3Oov98g": 245,
    "UC9WrMaSxIDRKR4wcz86IJxQ": 22,
    "UC9xR7uN0x5a6CH3Uopq7czA": 305,
    "UC9XsF9M7lZ1BSABHjKatOSA": 210,
    "UC9zLKU6WiRdcKtAh-6o_zmA": 64,
    "UCa_QYqKVEOE_EIZWgiOEZ5A": 120,
    "UCA-dBOiqriMhZdRYP7t8Jjg": 56,
    "UCA1EQIRhhEATgqx3-MvHASQ": 251,
    "UCa1HO5wU6csVDePt9EPYqmA": 97,
    "UCA4bOB1Jnw5-lbuoSCfxc-w": 269,
    "UCA4JfZXqiGBfG3JEzwHnbuA": 20,
    "UCa8ILv94qHT6oar_jVzg9sQ": 249,
    "UCa8LEwtYMIqB_FFZq75ST4Q": 186,
    "UCA8nozgxzH7O_w5I_1l0JXg": 274,
    "UCa9FvwOh7_72Px94HRnR8xw": 62,
    "UCA9PYfkSQWdlsQUAqdayAjA": 19,
    "UCa9wTL0z_iNN13n4G5VmbJg": 100,
    "UCa9Y57gfeY0Zro_noHRVrnw": 345,
    "UCaaaRyNQEACU09Ocw3EIh-w": 9,
    "UCaAu0DXNSPXCZPg6iHVwRVw": 33,
    "UCabr_YRuRIixVeQy8BMsMPg": 336,
    "UCAc8CAEbszgTZW_gioBUnwQ": 262,
    "UCaCtb_IV8QQDeDkVmvb4cAw": 17,
    "UCADIxr9ho7V60xs9gT9xWhA": 254,
    "UCaDMGSRik6oXYe4ZuI73Odw": 47,
    "UCaDO3fGfvXCP8m85ttSlYww": 289,
    "UCAE1yQeCWiv1eSxAmzpzD4Q": 70,
    "UCAehjwHcBHkTaybz53emqpg": 66,
    "UCAF2eDrqFRadsGVZJWptWuw": 0,
    "UCAFbyEj9pesCxo69ozEhi9Q": 273,
    "UCafG1bj6Qtcbn4bozcicWfA": 262,
    "UCAflRAT6B_7nvxAK72ztN3A": 15,
    "UCaGGU-1koAVWS1x_-xIiyOQ": 6,
    "UCaGQRHO_siHMRkCsfvTcSMg": 227,
    "UCAgYPad1QNRcTIzZEZPrKpQ": 12,
    "UCah4_WVjmr8XA7i5aigwV-Q": 0,
    "UCahlYbdb3AHrNQdojztSMvQ": 126,
    "UCaHOwP5OBwQ1KmpV6u6vWjQ": 325,
    "UCAHXqn4nAd2j3LRu1Qyi_JA": 272,
    "UCaIcWouDRr_y5MJxiaNMGAA": 5,
    "UCaiEgZoOU7y4oAxnQbsR6DA": 345,
    "UCAIFyekjtlga7IfOTb-25Eg": 131,
    "UCaIrY40rwEf51POKMybW-Eg": 20,
    "UCajbFh6e_R8QZdHAMbbi4rQ": 76,
    "UCAlOl7AC1AZbetak93bZFuw": 96,
    "UCALvlEyjxjF5jnheSl0oSxw": 267,
    "UCam_xf14FPFsRshFTj4wkHw": 247,
    "UCambvP8yxNDot4FzQc9cgiw": 87,
    "UCANDOlYTJT7N5jlRC3zfzVA": 50,
    "UCAnKiHbZhEayttn6p-sxfbg": 307,
    "UCAOhUv73jM5iCpOhuJOQzxA": 297,
    "UCAoKkBp0Qj0xW0NEOp7G4hw": 145,
    "UCAoy6rzhSf4ydcYjJw3WoVg": 339,
    "UCaP317DiL6Lf9PmXaJK8N7g": 14,
    "UCaPiH3TM542cSCxH5K995DQ": 267,
    "UCAplyWK80Y6_YTkb3CCDk1Q": 215,
    "UCaq_BEsIHLVvdU6lCKLtipQ": 292,
    "UCaqcNDDXmRVD5zfjgdmG5Gw": 285,
    "UCAQDFeCTVdx90GtwohwjHzQ": 12,
    "UCaqZ6JrBEITeUBjYL9kIffg": 16,
    "UCAr7rLi_Wn09G-XfTA07d4g": 30,
    "UCaRgPx8b0t6EjYwwzomXCpA": 157,
    "UCARI2g7r-PHaxrIcAYsMfmA": 308,
    "UCAS1tKQTTPVw4-TFnKTzvnw": 266,
    "UCaSJgx9BZRktT0s19henMGg": 56,
    "UCasKmptouCrwWLl8SlQU2tQ": 301,
    "UCasZvskFC_SHs6LXx2_26cQ": 28,
    "UCatSdbBdnsXgFpCyhJ7jYGg": 70,
    "UCau_fNwGpa63HqagqqWMIZw": 285,
    "UCAuCBqze_GL7-nPAzI62LNw": 61,
    "UCAUicVZlApAIhcdL9df3gWw": 30,
    "UCaum0e1MVZF69boluxgA0Bg": 17,
    "UCAVdcteEwgNrEBW7Aj9pZSw": 268,
    "UCawGfU44CZxd2ZVf_VGijbA": 219,
    "UCAWsbzucg3KVJ6_HNjtqg7g": 87,
    "UCAWSyEs_Io8MtpY3m-zqILA": 69,
    "UCaX1ogokiZ5Db8wmzVCY0bA": 291,
    "UCaxiDe_TuMLXkwRMVLm5VwQ": 0,
    "UCAxVoBLG2Bv1xgbYU_efsCg": 31,
    "UCay6Y3oEoiC6ZEE2G0UZu_A": 227,
    "UCAytwphRHoPcvLr_qRvn3Zw": 230,
    "UCAZ6zbMz0DzJG4uTs9SOTog": 4,
    "UCB-aip0wsqKQPcrLW1BBJaw": 337,
    "UCb-J0Shehsk2G-Ddliv9huw": 269,
    "UCb0FJKE6EFtPlwYHl1CNfWA": 325,
    "UCb0gOL3Ow7srd71q2AK8Q3g": 6,
    "UCB1s_IdO-r0nUkY2mXeti-A": 73,
    "UCB3at_yiqFJh31c0ztE4MVA": 118,
    "UCB4G5YgdI4rfTU0IU3dkjDw": 324,
    "UCB4yaCzOCKVW9-oWRs67XUQ": 280,
    "UCb5BJg1PJvzQ6kYk7eguzCQ": 310,
    "UCB5KUWdc5ttyglIgCYLLOJg": 238,
    "UCB62WcN2LgIVVFi7jNOLVAQ": 244,
    "UCb6ObE-XGCctO3WrjRZC-cw": 17,
    "UCb6Y6RAFaBU1ilgF6zPDojQ": 318,
    "UCB7sSUNwh_dXE7ZL3DsGDpw": 303,
    "UCb8dLvDvmZ-d92KEy_9oWog": 124,
    "UCb8nGgTFAL6B5zOm060Ff3Q": 241,
    "UCbA0mV8uL5-aTb2SeZ-X_cg": 12,
    "UCBA2EDiX5euSTM2Ic3gKqIw": 284,
    "UCBAeKqEIugv69Q2GIgcH7oA": 19,
    "UCbbiAbKAOszYbezcIYD4R3Q": 15,
    "UCbBLqA4HRowpj2JuLrkig5w": 105,
    "UCbbpq_-t_DsVFEc2yjnurwA": 358,
    "UCBC7vYFNQoGPupe5NxPG4Bw": 337,
    "UCbc8fwhdUNlqi-J99ISYu4A": 7,
    "UCBdgyOPjziZXmBCdcjP-U8w": 27,
    "UCbDHIS0NpXROhYjsaXQX4pA": 294,
    "UCbdOhaCW0Ti1qVCb9PKvmxg": 213,
    "UCBEdGV537X2NTkiwz54DTnA": 58,
    "UCbekFvyr5cAWHKr3XFvPqTA": 261,
    "UCbEqb8JTlcYh0yOX6veIyPg": 3,
    "UCBev9yAPNYhFM4ORPQb_LYQ": 114,
    "UCBFK95CIJNQmAlsCx22tZDQ": 253,
    "UCbfv8uuUXt3RSJGEwxny5Rw": 221,
    "UCbFwe3COkDrbNsbMyGNCsDg": 4,
    "UCBghUKA_L0na0SeQ6snzMMQ": 39,
    "UCbgr8vvzFLElzIxHDr2xV5w": 337,
    "UCbh7KHPMgYGgpISdbF6l0Kw": 19,
    "UCBhfuPYgo5ALbn6WmTXwHwg": 98,
    "UCBHlcxEjbYXPhShy40KBkdA": 54,
    "UCBi8YaVyZpiKWN3_Z0dCTfQ": 16,
    "UCbiK7qUXAv3DtfLTXiPcvzw": 85,
    "UCBiqkFJljoxAj10SoP2w2Cg": 91,
    "UCBIR44irWpj1eTx0ZQFofHg": 8,
    "UCbiTvSkQi9lBcZ-rC0J4qUw": 6,
    "UCBJc6HtiflRPPz6nDqf_30Q": 48,
    "UCBjcx01rZwPDuUPzWLTsZVA": 316,
    "UCBJFsaCvgBa1a9BnEaxu97Q": 274,
    "UCBJFtEEDnCpz8koPH-nLWUA": 22,
    "UCBJUELeXIYqKHiucDYM03xg": 301,
    "UCbJzR2e_KQAATjnkddLTL9A": 15,
    "UCBLGjbYv6-xxju1i44RjnnA": 56,
    "UCBLqkkSpOi6a95Lf4BsTh7Q": 9,
    "UCbNEgJIF_ADD9e8-q7SoxCg": 146,
    "UCBnmfjpmhGxao6v54fIIMUA": 35,
    "UCbntVBSebvO5zT3cQYIxbWQ": 215,
    "UCBNYNA9oZVUUPZvESYg8QTA": 212,
    "UCBOGwPeBtaPRU59j8jshdjQ": 351,
    "UCBoz1eYWsRPvpLKNelJHZ6g": 20,
    "UCBpLt5oWnDnG1ni5f33gcEQ": 76,
    "UCBQd84IW8OvM8H5jftHdvmw": 317,
    "UCbr-a2yffSZRjEbwtB1s2ow": 301,
    "UCbrbFKFhyHD4bMJbEcXZz1g": 11,
    "UCbrHhGgnGDeox-BRUfIbO3g": 252,
    "UCbRJ83DuTqan2g0e7R4Ve-w": 9,
    "UCBsIaqYpBHUPpf9n69lM8PA": 272,
    "UCbsP4BIsPYaRLv9f_yXDoDA": 16,
    "UCbT_hixd5zKuuuOk6vt3zCA": 12,
    "UCBT_IGEhvrNIODBm3655PeQ": 296,
    "UCbTv4OeHE9p1akLhKfgW8WQ": 251,
    "UCBuLdF0tQn5oZjpvYWSQkaA": 28,
    "UCBwH091x3pYLbGYwRtPbLlA": 303,
    "UCbwIX7MLfRsMdbP7yzyRoEg": 34,
    "UCBWWA6gRiTDT9EVsf5gmMKg": 236,
    "UCBxgYX7hJy6TZVvLXOEQrWw": 16,
    "UCBXLH5mn0nxgFH3udMtw4ig": 135,
    "UCByO_vijBgRH1aWhQNYfw8Q": 293,
    "UCbZDGjLa_Rc3TfPVXMR1Tog": 59,
    "UCbZZlqASU668-wyW1K2kYBw": 260,
    "UCC_6-o2BmUBQY-qXGPXEFnw": 342,
    "UCc_r_D9M7BGFpwXZnFaxEww": 81,
    "UCC2jToWuZRpMhyYyTt0xJYw": 160,
    "UCC5q6CpuDflPvO7pNn52RGQ": 352,
    "UCc7uWNuJOXzzDT-ZV7Gf1dg": 7,
    "UCc88OV45ICgHbn3ZqLLb52w": 86,
    "UCcA4yjiWpmt-GYMN8GgN4zQ": 352,
    "UCcAn8WXsoqw9x8DAkzYQNQQ": 266,
    "UCcApj9rC3dFW5RCDFIuLalQ": 88,
    "UCCAqJSuxj9X42VEnOdmSIcA": 3,
    "UCCB4kCxfVMdudYmF6nTnMUQ": 231,
    "UCccGnj6mw4RHQHI_2mKfjCQ": 15,
    "UCcD_EdnJcOjJMohDn435D3w": 285,
    "UCcd4MSYH7bPIBEUqmBgSZQw": 322,
    "UCcDDxnoQcezyTUzHg5uHaKg": 258,
    "UCCdSoJSdmkcD5TwRh_qdXFQ": 63,
    "UCCebCRguPlkvWemz2dKxWIA": 82,
    "UCCEejtWAO80M7eFYZtdfJeA": 7,
    "UCCerPBczdUtl1S-qqdoB1ug": 273,
    "UCcFIthTrwa6N-1ri9sQZstw": 19,
    "UCcgDP2RmeCqW1GTms1mkUlQ": 344,
    "UCCh8poxQxFU5q5WeXq3uv-g": 322,
    "UCChAHq4kdRZ0FJ1Jfjvr9cw": 264,
    "UCchGYP5t5Vz48UVxNOifk-Q": 302,
    "UCCHH0nWYXFZmtDS_4tvMxHQ": 10,
    "UCcHHkJ98eSfa5aj0mdTwwLQ": 204,
    "UCCHsCWNTcGJ8Jml_oZ6nG2Q": 267,
    "UCci8INziKu5yQ-28oG1HU1A": 253,
    "UCCK072ns5Bt1nYqX1CoaZ-g": 287,
    "UCckdfYDGrjojJM28n5SHYrA": 24,
    "UCckQQRZVF9x2GjroBjNIX_Q": 40,
    "UCckvfYHqNxF1y9FdXHlE7Dw": 252,
    "UCClwIqTUn5LDpFucHyaAhHg": 352,
    "UCCLy83Z1in2OiPHO9ETBcvQ": 340,
    "UCCM6yLTh1Ep5rlwrapyyNOQ": 31,
    "UCCnqJdQXdBYHf-gVV1yLf5w": 272,
    "UCCOgOae02L-GF6_EFqfAgpA": 295,
    "UCCOO1eldASxbdac2ObbERTQ": 5,
    "UCcpgDsHDYHO1UyfpwjyNx1g": 15,
    "UCcPRh2IAWN4KVlcYN_-Vk1Q": 246,
    "UCcq3DnobBkRca4p8pntDntg": 254,
    "UCcqCHOzqi5c0j1tBd0h5j2Q": 79,
    "UCcQsDietWkYakBKbGpCaeLA": 356,
    "UCCra1t-eIlO3ULyXQQMD9Xw": 228,
    "UCcRaKGCG3RFenb8D2php_Jw": 237,
    "UCcrBog_CXR9gIsZH2u_Mj2A": 130,
    "UCCrgfIGHE015putgxWrYWkw": 50,
    "UCCrjg1JckfPBhDcU0qP1AqQ": 358,
    "UCCRZH38F6BkexM6edXkwG8g": 20,
    "UCCspRrgJ-74U4me9DJsTXWw": 96,
    "UCcswLVd6KGBf5mIdzeO83bA": 272,
    "UCCuEq93a1ZVy4Hex16WnVuA": 64,
    "UCCugV2RWXqJMjVVQl_Yh4TQ": 261,
    "UCCuT1j_RQcg1AzE4WH0X0WQ": 104,
    "UCCVwhI5trmaSxfcze_Ovzfw": 353,
    "UCcx3crxPFi006DUhb_YU-tw": 44,
    "UCCXME7oZmXB2VFHJbz5496A": 99,
    "UCcxTE9X0pWrTbsFa5NipTYg": 252,
    "UCcyiT8QT7fo7LrxXe1oxOoA": 338,
    "UCCyJHRQW6VG6KpbTPTdSVeA": 280,
    "UCcYrL_GQe8X8K2ARhw_Syww": 351,
    "UCcZ1qvY53A_fKoOmrfWGKlA": 25,
    "UCcZPZ680duJJXnm9J0AAuBg": 278,
    "UCCzUftO8KOVkV4wQG1vkUvg": 26,
    "UCCZyXXv6cHQBqbPIBfTe1gQ": 214,
    "UCD-miitqNY3nyukJ4Fnf4_A": 27,
    "UCD1QOCJIAPsMKMvRSXjLahw": 244,
    "UCd1XUQlQis3QUmh3koUiuwA": 153,
    "UCD2QR0VZN-jfSavZ7kN-8dQ": 2,
    "UCD3kIX7L7yHlGGoeln4RuFg": 293,
    "UCD5W21JqNMv_tV9nfjvF9sw": 307,
    "UCD8i-h5iqOaysEkDnF1CQ_A": 60,
    "UCDB44Q3zV3Eb4umw02fY0JA": 280,
    "UCDb47NT3QzoCiorDtK9C_qg": 258,
    "UCDbDNd7hniszuAFH9pM-3Wg": 95,
    "UCdbMJDaiIT4viraMae5v4_g": 301,
    "UCDbrtRQLw0P73Bhwe_nnC5Q": 33,
    "UCDC7peoZ2tlm406-0l8iLYw": 78,
    "UCdCczCYPOeP5hTfbx6tzz_A": 58,
    "UCDd-NcDZGw5gwxPsTXj9IFQ": 214,
    "UCDdmoA79bfI8DHDnE_Yy2dg": 243,
    "UCDdPJMAdazxGOlWzU72xQxw": 5,
    "UCDdwCaIYyAsSbQRtVcOg2Gw": 250,
    "UCDeGFlzenOpI2aFDH0mry9A": 352,
    "UCDekUkwwfSoGf-V5NzGB7zQ": 17,
    "UCdesGlD7t5JV-z28p5GqVIw": 277,
    "UCDG8K9g6qo8gX4jCjsqUVzA": 233,
    "UCdggLAiNWb1p0IUv1qe5CTA": 245,
    "UCDgH-CfHO85D0rxtXnXeN2w": 21,
    "UCdh-YF2gTzqDNu0VU9lwPPw": 307,
    "UCDh2bWI5EDu7PavqwICkVpA": 154,
    "UCDHABijvPBnJm7F-KlNME3w": 75,
    "UCDhFPOhFxEdegzifhkPrACg": 352,
    "UCdi5pj0MDQ-3LFNUFIFmD8w": 74,
    "UCdIa_1lEL5c5RrGgIKptQrw": 351,
    "UCdiFgq7GO5TUqp-6PElwP2Q": 57,
    "UCDj3SEJ5226cjj5dkt1PiIQ": 205,
    "UCDJA7L_fC9ix9YrknyeU0BQ": 318,
    "UCDjutWNYx0gRgrnTLHYWgtA": 4,
    "UCDl5qfjqZR5MLN1pogAgBog": 318,
    "UCdlxcNp-rmCrIfZwORXr0Og": 277,
    "UCdLzCmhVIB9gOBrQ_dcQrOQ": 2,
    "UCdMpGhtL9oK8EYolTt8v4uQ": 0,
    "UCdn5BQ06XqgXoAxIhbqw5Rg": 228,
    "UCdNBhcAohYjXlUVYsz8X2KQ": 273,
    "UCdnKpUAm-dcxUFi81w8x8Cg": 318,
    "UCDNQpM5ZUP04IAlnglWlAJA": 209,
    "UCDoH-Xv1K-9U3frP6uzuXAA": 48,
    "UCDOI0xKWV-Hb9PPY76mrJpg": 148,
    "UCDOiw6Z_yVE65XtgtcjJj5w": 9,
    "UCdpUojq0KWZCN9bxXnZwz5w": 207,
    "UCdq7XPTojqqnL0GOoxvpAIA": 318,
    "UCdQ9LnNR6DTj52nrpRggexg": 26,
    "UCDqI2jOz0weumE8s7paEk6g": 310,
    "UCDQkIK-Md2XDbDWN4nKyzIQ": 218,
    "UCDqno_7LWobowaVc_vzUuCA": 277,
    "UCdQYcUyffHZoz0KOwuiG0lQ": 12,
    "UCdrbNcRAy424_FFWsY1A6og": 197,
    "UCDrG8pzkq_cCCLcN5wgrzNw": 17,
    "UCdrQWcX7XLDSUEh9SAxnyBg": 12,
    "UCdRRIOzmYL7LHLVqHcfCN1Q": 159,
    "UCdrUdY5LsTHT1oS3szu1glw": 176,
    "UCdsHTs3OOKj_ANMKnmbUASw": 15,
    "UCdSSq9vdTFch5e9DgvEry8Q": 259,
    "UCDsY-h6IPSXUtEE0XnwW9Iw": 100,
    "UCdubotSy4pPOsiaW4MrYn3Q": 305,
    "UCdUpvKm_lTc9w9fy7HdrR9g": 356,
    "UCDV5jA1Cgg53EdmsB8zYQpA": 349,
    "UCdvq5i3RyRsoTqITD1xSxNw": 354,
    "UCdVYY2166hyjUAMHwp2almg": 108,
    "UCdWFrG9v5GPaiqS7jamjC7Q": 141,
    "UCDwPMymmju4GZV7kZcL2vIQ": 90,
    "UCdWQytF_syOGwaQQuxwklxg": 9,
    "UCdXAk5MpyLD8594lm_OvtGQ": 181,
    "UCDXFo9upBYHPfreF9IGK25g": 10,
    "UCDxHeaaTTRVgb2Pa2rQXSPw": 184,
    "UCDXO6Nh1iiVSieGCTFWUOFw": 262,
    "UCDYmL_iZzXhR6mSYFaGjq4A": 17,
    "UCdyPindb5CUHQNJfrJ__ebA": 25,
    "UCdyqAaZDKHXg4Ahi7VENThQ": 228,
    "UCdYR5Oyz8Q4g0ZmB4PkTD7g": 256,
    "UCe_8qM8Wk4cU5oD3WO07gZg": 268,
    "UCE_qHfm3Z3n7RrXKo1oUlXQ": 122,
    "UCe_vSZivfbWX2v7LjIvWgJg": 20,
    "UCE010cVAgWFD24wIJ95sDKw": 26,
    "UCE0ETB-j-qiXQiKPIG-0tCA": 55,
    "UCe0JiGnjPfEwEIbWASbOimw": 356,
    "UCE0yFdA-ZiCKVCqhHdVCV0Q": 144,
    "UCe22Bcwd_GCpTjLxn83zl7A": 269,
    "UCe3tlAzxc9eEGKH5PGC4arg": 247,
    "UCE4W22kKQQVdrA2KTiyZ_cA": 86,
    "UCE5exBwiJakSs35GRkaCVig": 211,
    "UCe5mbpYA9Yym4lZTdj06G6Q": 262,
    "UCE5VgVGRPfNCjXPeTe1QJHA": 190,
    "UCE6fkoGPGOoWE6pYDalwLZQ": 247,
    "UCe73kRqB0j3MfSRFM7Eq13A": 356,
    "UCE7gtjLeZKNXLp5YURzYYeg": 18,
    "UCe87ls7JDWbSdNb1P6LkLUg": 11,
    "UCeAfiVvEuyICYJW-f3GnQjQ": 142,
    "UCEAx_DLKFWErTmPvZVvG-mA": 319,
    "UCebahRIRq3PZJGHimijvqQQ": 10,
    "UCebT4Aq-3XWb5je1S1FvR_A": 68,
    "UCeCWj-SiJG9SWN6wGORiLmw": 121,
    "UCeebFz-H6dxJII_roqAGSTg": 17,
    "UCeFms_6ZvioZvV_OCniQ-TQ": 233,
    "UCEFOogmvTTcCaO8Qe0I8-tg": 110,
    "UCeFvaOWKmS0T-rSQEcfZNog": 225,
    "UCEfWuGRucPLoRbXRvOJUS_Q": 303,
    "UCEFx7PserYcSAD3p66sOMWA": 312,
    "UCeGendL8CO5RkffB6IFwHow": 22,
    "UCeHtsCKQaFyb6SQGfRp1_6Q": 253,
    "UCEiB6vkUtWsBwYsAF7ukKXw": 351,
    "UCej9K_bcaQdvDh49RkHYsUw": 95,
    "UCejbicoRnQjCOdAPAv5JPwg": 302,
    "UCEJIq8svnyRsurZBhslqAkA": 133,
    "UCEjysNG2a2UgCBIpJxBqn3w": 352,
    "UCEk1_ZVGRiVV-gxHT9wdNMg": 285,
    "UCeK9HFcRZoTrvqcUCtccMoQ": 145,
    "UCekc8SI533NI675r9aCBRcQ": 294,
    "UCEkOIpdTU2rNcY1a0iVhQig": 80,
    "UCElr8slMrY-Cr764_QIJHPA": 65,
    "UCeLzT-7b2PBcunJplmWtoDg": 5,
    "UCENwRMx5Yh42zWpzURebzTw": 319,
    "UCeOFXEGmkv82sn00V0cr8eA": 274,
    "UCePxTcqnADy8kpE5HWhxGpQ": 30,
    "UCeqIMtLuGc3YgwkhEaG8oDg": 286,
    "UCerH0KOGyPaC5WueExiicZQ": 310,
    "UCerkculBD7YLc_vOGrF7tKg": 7,
    "UCeRQcxnk_XDkUZIsEpZUfQA": 70,
    "UCES4K104k-D2HthE46z9VHQ": 29,
    "UCEScfuEl7JE7dVA49NiO3GQ": 9,
    "UCesmFxfJQ4xvIaTxYw7yEcQ": 59,
    "UCeTb2MQrm8UBChlecw7pQOA": 13,
    "UCEtUOMEAuAMz8dor89rt2RA": 15,
    "UCeTxs8lq2gadk89Y1yGKPGA": 22,
    "UCeUxaSLRzywNh8v78SDKP8A": 22,
    "UCEV4U7LqkWq0lKikgCFoWKQ": 264,
    "UCevD0wKzJFpfIkvHOiQsfLQ": 64,
    "UCewpvF9-zQyndzbB7t55XnA": 355,
    "UCewRhO43UmIohSBzW2HMheA": 256,
    "UCEWwY8fc-ER9H_MlSAgwVVw": 35,
    "UCExterzFt2UwU2B-vnVUazQ": 7,
    "UCEY0Cmg2-UeUbcxINxiFNKw": 324,
    "UCEy9cYULQrC2cRlVqJPCcSw": 7,
    "UCeYJM8wsI4oGzc5veQDbVwg": 0,
    "UCEYU-OEI9FnbeC5hna_cbhw": 29,
    "UCez5D_dtExDJzQOAzg1k1RQ": 8,
    "UCez6PoUm-tuIzHLXiXDGKWg": 300,
    "UCf_C-0WsqsIyueQDovsSS0w": 293,
    "UCf-PcSHzYAtfcoiBr5C9DZA": 211,
    "UCf-QRi_9sjik_BZBn7lFY_Q": 80,
    "UCf0XdGC_TkebEQfoo63lg3A": 15,
    "UCF3EqpGBmczbO7LFqKrkrNQ": 276,
    "UCF4ghCrozjWPSIbqV8tiTSw": 21,
    "UCf57-IJn5mUJDyqd9uNEmrg": 29,
    "UCf5NlkiqHh1BYBKzcdIssOA": 14,
    "UCF8ftavKoTxvh4si_rTLPSw": 47,
    "UCF8icKLU4FGF8Ln-KlKakSg": 10,
    "UCf97Z6Ntd1n0LQ3TsUtYNgQ": 295,
    "UCFaGKEDWe9_jOmWMsyatxSw": 319,
    "UCFahBR2wixu0xOex84bXFvg": 22,
    "UCFBc8kuCtTwmtdsBcJoZ3qA": 294,
    "UCfBkUgaJ6eqYA9_TX2cmq9A": 256,
    "UCfBxhUGEacqBlXSXvcch_Hw": 61,
    "UCfc4mTWCuWOQP9lHB19Tt4Q": 240,
    "UCfcizLIjD-OMeWbdeC8UPUw": 293,
    "UCFDAKGVq1uBl9QYrTwXqMBQ": 35,
    "UCfdF96prvBt7_N28veNdVkA": 26,
    "UCFEd5V7VcxBPPcuMGpmvkQA": 58,
    "UCfErRnESYXp86XRZVNZYK_g": 4,
    "UCfeznQrLe9URem6xJmWQVlw": 64,
    "UCffASWaVk1PFnpC-gTvuJgw": 243,
    "UCffGFdXg-xiXS-MeA4eeQZg": 304,
    "UCfFhyViosklD4kvyO-M0BJA": 16,
    "UCFfKS52xZaus6HunxP3Owsw": 282,
    "UCFgXWZOUZA2oYHNr6qDmsTQ": 28,
    "UCfHSSdj-1uucpAx7-VJ0V3Q": 346,
    "UCFI81W9F49a7GvimKF905eQ": 14,
    "UCFiAImXVyHSguz8wh9y_omw": 352,
    "UCfiD6DpIwPP4lQ4NPqZNOHg": 27,
    "UCFiIsVOC1p_gfTYDYXXfl4g": 26,
    "UCfiK42sBHraMBK6eNWtsy7A": 58,
    "UCFimqykDM5g9a5KxlW_e7ZQ": 311,
    "UCfipDDn7wY-C-SoUChgxCQQ": 189,
    "UCFIPVDm8SejRZHkuVOzBmpA": 192,
    "UCfiSo8tO3WPU-8YOgr4Ba6g": 291,
    "UCfiy-dr0s1O6LJRV6KHomLw": 181,
    "UCfIZ5P7BcgIyLpfOj66DwtA": 358,
    "UCfjJBQs0T-pn8rRnoHudcTA": 226,
    "UCFjU-kRnqfn9wtcGsFbe7aA": 13,
    "UCFkHpBGMeNSQW-j9-F0nxnQ": 7,
    "UCFKOVgVbGmX65RxO3EtH3iw": 230,
    "UCFKt4a_HRAyry05rLaHI3LA": 318,
    "UCfKWQaZo28SJR-7ikfzAbEg": 201,
    "UCfm05QV1b5BP0TSS842mF7Q": 291,
    "UCfMNN0I96oGbmJzCRCWgoog": 100,
    "UCfn1OyGrBAdX2xVsCb5Uoag": 99,
    "UCFnXTeBpJRPSN6QmWz_uDgQ": 282,
    "UCFOhd3zJLXms6_ekbCPmyMQ": 260,
    "UCfol9ZU2HpEajyBDj-EbiOQ": 11,
    "UCFozqRSzA3K_EcCGHRKspRw": 319,
    "UCfpKZtsYneZVf6cvdcVyE_w": 278,
    "UCfPOynlPffrryH8JAsHOmJA": 31,
    "UCfPwtmjVXsByl4z8TT32Lbg": 316,
    "UCfQIxnEq2M5lOaz3xjFp0FA": 58,
    "UCFqVAFANOHm17UVy8sWkhqw": 2,
    "UCfQVs_KuXeNAlGa3fb8rlnQ": 326,
    "UCFrHf8DmvNQRj_IWYu956VA": 351,
    "UCFROaN5dGbTyhRrQ-gbgw-Q": 215,
    "UCfRQQjdfgKc2ZKqiQYGbfug": 33,
    "UCfrWoRGlawPQDQxxeIDRP0Q": 62,
    "UCFsWaTQ7kT76jNNGeGIKNSA": 27,
    "UCFSXa6dHRKLbj9Vcn_h8Sjg": 22,
    "UCfSznBOuXiDxON_YUMCSFiQ": 265,
    "UCftCE9ESkZMn3gR2Uu3hIyQ": 89,
    "UCftJR3Qm0LyEuEQue1QYytA": 222,
    "UCfTjT67uIy1hcAJFO7_AqOQ": 275,
    "UCFTLzh12_nrtzqBPsTCqenA": 265,
    "UCFtyinR2ZdvKK_Xgy07qXUg": 271,
    "UCFv2z4iM5vHrS8bZPq4fHQQ": 352,
    "UCFvEuP2EDkvrgJpHI6-pyNw": 343,
    "UCfVSveW0-5LoLjM_SmkR2PQ": 199,
    "UCfwAKc_vwVTzTcm1wki8oHg": 4,
    "UCFwcEIsjvi9XEvpGx6iwHpw": 23,
    "UCFWD2vvDJqjimIzhjEvogNQ": 287,
    "UCFYEdWawKUvw6zTR5FLBYhQ": 88,
    "UCfz6EIcVmOa7zbw-3kytBvA": 3,
    "UCfZlSUOVlHqGwoflo6xju2g": 27,
    "UCFZnIzx5T0tGl0DMQb8yPjg": 27,
    "UCfZofhrZ4pxCESrcs5m5NJg": 350,
    "UCfzP3R8QQ77ryTnHeEiBVMw": 56,
    "UCG_CzdeNlcDnBCK8AbgiuVw": 11,
    "UCG_m8BBH26y5aaLN75fdltw": 230,
    "UCG_UQg-S5Fofys7M10HpyCw": 256,
    "UCg_xsJxJNVmAdMwXIvPNmTA": 50,
    "UCg-0h4n88wmt40Kn3rvIKTg": 69,
    "UCg07Ij3Uov3k9rYgBwDQLVQ": 293,
    "UCG0rzBZV_QMP4MtWg6IjhEA": 327,
    "UCg1_w0RiyAkamG1BqADHgaw": 102,
    "UCG3hBfZxzLixJPZQ9QUP_Lw": 272,
    "UCg4x4QmjPx0I1HNQp9h1xvg": 274,
    "UCg53fzp6UNYvsyAg8UoNXCA": 33,
    "UCG5vZgELi3on_pksaLrIoxw": 58,
    "UCG60AciQFwS6Q22njFpEHuQ": 357,
    "UCG6UJ-NOM0A92ppgfPoVuGA": 258,
    "UCG6W0T4aceuM5CCpDQ-qQyg": 239,
    "UCg74CPB9q0eQldB8SfJcJsQ": 344,
    "UCg7aL_drCGzlPCrV6Hys_-w": 19,
    "UCg7qCZeLEToWf3W6hnVketg": 224,
    "UCg7sW-h1PUowdiR5K4HlBew": 262,
    "UCg9_f0eR1KuqAb86Lj7xNew": 27,
    "UCgA2jKRkqpY_8eysPUs8sjw": 70,
    "UCGAFA1wiOnXwRsFlh38FuiQ": 20,
    "UCGAtHjeWWgyWboVQ33ZQX6Q": 282,
    "UCGbzUHV3QvyWXIts9NRYIQQ": 149,
    "UCGeCnpimiSN5rgiKbJzHd3A": 5,
    "UCGEMpMpll4otCdnnxQ9paFg": 5,
    "UCgexPS9fwEtLTCM8VZnEpjA": 90,
    "UCGFD_8TRHhlpjfqGhLUSk4g": 70,
    "UCgFfIQzgZn-kTKLlRLlMzSQ": 275,
    "UCgfRDtfK0QDlE0RaDWp5baw": 326,
    "UCGGc-KmG4fxc8D03S-H0rbw": 10,
    "UCGGIGlgxXoVu1ZzbQ2XBxqQ": 258,
    "UCGH_ty6YBy2Q9KWtiRYm2IQ": 39,
    "UCghSSXNbZRmPAv3UaS8g21A": 6,
    "UCgIfLpQvelloDi8I0Ycbwpg": 346,
    "UCgIHvyZWE6Ny7pfRpya86Yw": 27,
    "UCGJxABIB4vdwTpEgmY3e_wQ": 21,
    "UCgK45_8vM6bMxtEiVBEsS8A": 263,
    "UCGKNbtDv8OTa8559buDu-Gw": 63,
    "UCgL6PS1vba90zrZW9xmiwng": 6,
    "UCgLEceZtHtnlvDvMIcATXhg": 40,
    "UCGLrsPlc2DpavAxmj1QV1tw": 21,
    "UCGLS7BOgNa6c03r7VYacblw": 20,
    "UCgLuSfjVG33nYXgreHMDnRQ": 89,
    "UCgM1sly6rnxqWe8GLbceEag": 0,
    "UCgmFrRcyH7d1zR9sIVQhFow": 12,
    "UCgmPnx-EEeOrZSg5Tiw7ZRQ": 30,
    "UCGMSJFuXdNmswEPX4X6NnLQ": 116,
    "UCgnavpGZUMzWODQB_daHZbQ": 302,
    "UCgNC_LzvmZdZqTn77JntMMg": 23,
    "UCGndc74kfWb_A-8hZBG534Q": 327,
    "UCgnfPPb9JI3e9A4cXHnWbyg": 309,
    "UCGo7fnmWfGQewxZVDmC3iJQ": 301,
    "UCGofntRkNUAgXGqimLtLy4g": 12,
    "UCGOkz3h-Ov894lSsDJH7aoQ": 55,
    "UCgPGVORhti-KKcV4CqUyumQ": 304,
    "UCGPSbXH61y4l85L9XTUl2mA": 354,
    "UCGqdiSvu-i8A8XC6CK7cUvA": 273,
    "UCgqsGN6McgMtc-Xz50MsG9w": 286,
    "UCgRm3fdPH4n6FiT3WrXJ74g": 217,
    "UCgSlUqXm0ktHAjypGpaJwyw": 302,
    "UCGSoN_2YZanR3cxRzVpr6GQ": 15,
    "UCGsYwogFsaHmYREWUvXAOCA": 354,
    "UCgThaxkwwg2Ey1cthaHAB0Q": 47,
    "UCgttI8QfdWhvd3SRtCYcJzw": 347,
    "UCgTzsBI0DIRopMylJEDqnog": 105,
    "UCgUjg-2DGP7jXs8l-O27fHw": 24,
    "UCGV96w_TwvyCDusr_tmcu8A": 254,
    "UCgVuzUu24q8KIDOjJcmCnIQ": 21,
    "UCGw7lrT-rVZCWHfdG9Frcgg": 17,
    "UCGWa1dMU_sDCaRQjdabsVgg": 10,
    "UCGwLSyPLaHpq0nuT_JVSMtQ": 78,
    "UCgwZmQZC7O-TP1Xbnz50VtQ": 79,
    "UCGx0t5bUkm-rY3jKSRolY1w": 244,
    "UCgx5BnhXFHxi4RflFV0l3Ig": 246,
    "UCGxXc1UNZI9-iva1zmdldqw": 222,
    "UCGy6-GQj6ALoCkjCLus7c0w": 313,
    "UCgYAQU6TWUj2t9va0dej61Q": 232,
    "UCGYSdXbiAxm7AVqPeb9CooA": 32,
    "UCGYvl7VA13xTKyQMf4S7mmA": 152,
    "UCgyxG91nNr1hO4nsu2b6GxQ": 269,
    "UCgZ0pH7j6c9z-pkOG3PYw1Q": 298,
    "UCGzTVXqMQHa4AgJVJIVvtDQ": 345,
    "UCH-SLA_jpPhM2lzdZjZDxjQ": 93,
    "UCh-tv3ERhOinEHnPWjRsURw": 83,
    "UCh03lxwbX8zXkeGyOMZJ9Ow": 331,
    "UCH0ObmokE-zUOeihkKwWySA": 335,
    "UCh0VAaX5GbU59pLoiY52q_A": 2,
    "UCH1B9AR8sfWJVf9zcu9rbGg": 344,
    "UCh1BGjlKPa0BJqmeZerVrpA": 4,
    "UCH24asiIqsVUQlz8FvXJbcw": 2,
    "UCH2dAEECzniZIShBZ50Iujg": 270,
    "UCh2G4R2nto3ckemjB_2Tt4g": 214,
    "UCh2ykSGKiJB3f-Y8w2LWplw": 23,
    "UCh6x8FMbew4bZ90iIBeCOPw": 358,
    "UCh8Ah1mEK9ESRGJzl6JFUBg": 82,
    "UChAceimbkzq6_tcfkEPfcpw": 327,
    "UChAnqc_AY5_I3Px5dig3X1Q": 98,
    "UChAQQ9at2MDlXjvQX3vL3Yw": 47,
    "UCHBhnG2G-qN0JrrWmMO2FTA": 11,
    "UChBuxXl8poN1Jz8kZDdsfhw": 315,
    "UCHCbTXJHv9bk-kngMQq205Q": 351,
    "UCHCbWdtJmZX9pEFtSye_juA": 265,
    "UCHccxX2p_9DB_HPnXSb2omw": 311,
    "UCHCnxECJBxKrMByroUWSgcw": 303,
    "UCHDteTHrF5wmI9nQYuAgcpw": 287,
    "UChdY64fJb14Nfnbs8EGdQig": 155,
    "UCHE25f3cfppcibo7JNIMZYQ": 251,
    "UChE6aOThY8r78LxUsNGcALw": 291,
    "UChEe0jSUdb2ox9wQFYkByEQ": 23,
    "UCHefdkPE5A4EqGHgDhrVfzw": 290,
    "UCHEkFIG6YOD5t0_x-sfEvgw": 266,
    "UCheqzZj54e5y_5HEtwG7FSA": 271,
    "UCHf7hWxhZ3YBYy3FPkA0Qrg": 29,
    "UChfW-zJZsd2_UXPkCy68W0Q": 16,
    "UCHfZJaPkIwmDOV1QusijqTw": 238,
    "UChgPVLjqugDQpRLWvC7zzig": 1,
    "UChgTyjG-pdNvxxhdsXfHQ5Q": 260,
    "UCHIgbtz8t8snEwWlE1eyS2g": 293,
    "UChiMMOhl6FpzjoRqvZ5rcaA": 9,
    "UChJ5FTsHOu72_5OVx0rvsvQ": 310,
    "UChjF8eypSzjUnHJ4ziqgBxg": 25,
    "UCHjFUkpN2TYcUtqxaR8qpfQ": 26,
    "UChJo7dFfZ6mJXQgpXr3OxGg": 194,
    "UChKXd7oqD18qiIYBoRIHTlw": 288,
    "UChl9chAone90455JN7RHvWw": 49,
    "UChlBh7_w93cGbvEm6m4Yc8A": 264,
    "UChLfthKoUV502J7gU9STArg": 57,
    "UChN7P9OhRltW3w9IesC92PA": 66,
    "UCHnbtVLZYGuKkGh6iFxxTpw": 265,
    "UCHnY2fxHXfZmKLPYn_Ps7Sw": 259,
    "UCHP4f7G2dWD4qib7BMatGAw": 358,
    "UCHPfTzszxxBC2whb9vWaHPg": 12,
    "UChpkyQ3O21OnkcMcgCoNHCg": 28,
    "UChpppq5ezHdxvIFjp6nbS7A": 102,
    "UChpRPsAeSZn5DistGacR3iA": 310,
    "UChpYVFWNuWbOTtXfxCL62Kw": 89,
    "UChq9ybV-EPcRMwBvnOKpu4Q": 87,
    "UChQuOTY4qlCHvfHRqDR9P9A": 255,
    "UCHRCp0CSacVnTVS2Z4x9xYg": 269,
    "UChrTMfNcD1eN2ENGWBD7lUQ": 0,
    "UCHsx4Hqa-1ORjQTh9TYDhww": 36,
    "UChTI-WraqcTbKuSiG6zVQcw": 230,
    "UCHTnX0CSX_KObo5I9WuZ64g": 207,
    "UCHtpsJRyv8og3GQxrF-coLQ": 309,
    "UCHtQPKLeHqOPKbIIOfsoWEQ": 237,
    "UChUJbHiTVeGrSkTdBzVfNCQ": 323,
    "UChV9GjZYgve_VtdcxTB1NcA": 19,
    "UCHVSA2OScyef9W7OwPGgJ9w": 293,
    "UChvSz0MzDk3g7hzKZ1VvmGQ": 301,
    "UCHVXbQzkl3rDfsXWo8xi2qw": 27,
    "UChwB-iMNTouaemKeS6NgOOQ": 241,
    "UCHWOl8IRo1qiFDH5Qo1mckw": 279,
    "UCHX7YpFG8rVwhsHCx34xt7w": 225,
    "UCHXgFLFyqR-XqtxfTH3qiYA": 2,
    "UChXm-xAYPfygrbyLo2yCASQ": 9,
    "UCHXmyTZ3UFbhzpfVgVlrdgw": 22,
    "UCHxUvAIXHfDzpTW02v7Qarg": 40,
    "UCHz3PeU1RRcY9vJDSqsigIA": 22,
    "UCHZiV_ewlnKeFcP0raBiD7Q": 357,
    "UCI-aDQ7k0Ghd9JlFv_qzB7w": 277,
    "UCi2IRVADWRCkrZdAPwEw_dg": 255,
    "UCi427aW2rjzGjUlE27SqteQ": 66,
    "UCi6nuuHhOj_usxkjlcHdRXw": 282,
    "UCi7TwomtS3ZyfjAM5TWEMSQ": 170,
    "UCi86xN74eUECs8naHF_Z_bg": 11,
    "UCi9O6GC9DvnrXqQfgXrNaYg": 13,
    "UCiA-trSZfB0i92V_-dyDqBw": 3,
    "UCIaC5td9nGG6JeKllWLwFLA": 15,
    "UCIaZylf5L9MsCMOJX3BdTEg": 267,
    "UCIbaYUBG8e7j_uq6_T2XM8g": 264,
    "UCiBBDZ-ndtBgE4xKbswlgXQ": 15,
    "UCiBMH1d7ew_3bi2A_zZGsmw": 70,
    "UCiBXVFuA-IPRrmb9r5cTT2w": 330,
    "UCIbZflzpCowPvqbB2gt0TlA": 250,
    "UCIcAj6WkJ8vZ7DeJVgmeqKw": 303,
    "UCIClNlvEUvEqLe_rs_i8h_w": 343,
    "UCIDEDCk2cFJqww1O7GgPPGA": 2,
    "UCIdEIHpS0TdkqRkHL5OkLtA": 1,
    "UCiDSFTxFuXIzZkpzobjen4Q": 332,
    "UCIEBSYfCdoSwkeWu9Odhkgg": 69,
    "UCIeSUTOTkF9Hs7q3SGcO-Ow": 219,
    "UCIf6cffSRZqS7TUXbUAK_hw": 19,
    "UCIfAvpeIWGHb0duCkMkmm2Q": 49,
    "UCIFQuGbLFsSduuFpALAj1sw": 195,
    "UCIG9rDtgR45VCZmYnd-4DUw": 74,
    "UCigpSsgPbdCxXtbfGksFIYQ": 87,
    "UCIIE8BmWQKEy2hXQMnAd9Mg": 84,
    "UCiJ_Um3KbfF19NzkDYLzZVQ": 293,
    "UCIJ6TGsTcBlYGUj-zbL60EQ": 12,
    "UCIjdfjcSaEgdjwbgjxC3ZWg": 20,
    "UCijLnnTWoGaX3S6kVyG2tjQ": 13,
    "UCijNnZ-6m8g85UGaRAWuw7g": 350,
    "UCiJUQctXBFIEhatvI74b7Xg": 1,
    "UCikyhPyuEu3rn1izGOGxZcg": 161,
    "UCiL8200wgmCEpT83Q9oTxqg": 186,
    "UCilDXp9OCn51TLcWwfXcmtA": 268,
    "UCiLFvfLfq5MpS-x2vCy2Amg": 357,
    "UCiLhMk-gmE2zgF7KGVyqvFw": 290,
    "UCIluhwUtoEKl_PrYbPR3eKw": 48,
    "UCim0N3tvLijU_I3jbJeJV8g": 84,
    "UCIm8pnnTNhCgGAtNxrQQv-g": 62,
    "UCIMFIkXOGA7dWA903WdRKKg": 9,
    "UCiMG6VdScBabPhJ1ZtaVmbw": 347,
    "UCiMrvZ_l8lw42T8amrGCFNQ": 19,
    "UCin40B5inoY5PHk_Z2MDIvw": 8,
    "UCIoRFfQdwgErIokdU4Zb-Sg": 34,
    "UCIOUnOw74BcQZzskbjK3f8w": 126,
    "UCiphSlsDcJJQ7mDqR9Q3SdA": 0,
    "UCIPYZHEvSEEpEIQQBt--yNA": 4,
    "UCIq2HwA2iBOso7ar4VuU-TA": 97,
    "UCiQGM9nz7JMp14HJtSVwmkQ": 318,
    "UCIqsDMfhM3yeM9l6kNyEURg": 342,
    "UCIQsiulMw70eRex4cXRAx2A": 181,
    "UCiqtXLBjDT6TRLhetkqO4nA": 69,
    "UCiR6oBbZBlAuOLInDTMzYuw": 232,
    "UCIRI90jWpTW1exSdW7NicEg": 7,
    "UCiS8bmdvcPfDbT5dqmxz_ew": 17,
    "UCiSm-bQq8dgIX6ZATVqEppg": 351,
    "UCiSRx1a2k-0tOg-fs6gAolQ": 10,
    "UCithyOpRcZTMvvkMz8tTqFg": 251,
    "UCIu-aUArYq_H84dBpCAokMA": 286,
    "UCIu1rRiQLeUU8e1saN6I0eg": 226,
    "UCiUDDGQfSoftNBq3KDUmVog": 355,
    "UCIumx9FItlv6B_JsHVMjVYA": 238,
    "UCIupuPQXXbCMoUfy2qpzgBg": 272,
    "UCivDgaCAh7WPBoKA24WNwJQ": 23,
    "UCIvTMmQjViIGMK1VjsVxCZg": 354,
    "UCivwPlOp0ojnMPZj5pNOPPA": 295,
    "UCiw0IHf0T1XWNDgTOA57CbQ": 20,
    "UCIwHOJn_3QjBTwQ_gNj7WRA": 11,
    "UCiWkgRl4asSN5kRUSWgRLWQ": 171,
    "UCIxiVz8JLYTMXexmLh92S6A": 337,
    "UCiyDpPerqXkicZmnxKB9qZQ": 264,
    "UCiYFmDfFBoAP2yk9yuXBTTg": 29,
    "UCIYk01c-wq6Ex9sjsDBEl0g": 286,
    "UCiySJLvpBF590Q6FY_ycUOA": 86,
    "UCIytNcoz4pWzXfLda0DoULQ": 233,
    "UCIzgC9UfhG8eEbH7N5BBBWA": 9,
    "UCizybmN9SQ_V_L3hVcPSf5Q": 253,
    "UCiZyc9uhPft4ax1CTTMM2Bg": 79,
    "UCIzZDiilcPv0wim_MbuizFA": 30,
    "UCj_dHWD0o2k_Ef4lwcXd0Iw": 95,
    "UCj_ptTHh9OboZpWfsDCoyjg": 28,
    "UCJ-a35UYtoSg5Y8kIj0YRAg": 345,
    "UCJ-gAk3Hp2LvPTsQ0g02z_g": 27,
    "UCj0cM28jO3CK5yqFeYNe_Yw": 32,
    "UCj0GjRCFN8pGudhIDJ3SR9g": 298,
    "UCJ0PCT2OVrvWGfSdrpG5Stw": 106,
    "UCj2RY_n9_5C6-OtM0hViytA": 24,
    "UCJ46YTYBQVXsfsp8-HryoUA": 9,
    "UCJ4O6PWA47f6XbCgrLQNqEQ": 348,
    "UCJ4pezclPqwIWtluOAEzQgQ": 19,
    "UCJ4pvspwjnM-hSXqkoIuMGQ": 175,
    "UCj63OWl-HQ-I6ORzUWF1EDg": 15,
    "UCj76pRLEg2JHwDwJJXvZtSw": 29,
    "UCJ7i38lvylKhd3jcvq7lO9w": 146,
    "UCJA_J8CpKRT78Sr1bylS1vA": 357,
    "UCJABeTIKrhExlG6tBTov_ZA": 54,
    "UCJB1hgmiAD4ysg0Ao7uS8Rw": 280,
    "UCJBex5fRn2HBM8imvAKlLdg": 28,
    "UCjBNrqkmv-Ggcc3tAjOcVuw": 262,
    "UCjbtwMOGYuSp_o11omDXUQQ": 290,
    "UCJcfB-86rWM0NF2li1CqNNw": 252,
    "UCJcKh9mwJH4zhHsU4NDs54g": 1,
    "UCjcXw7nWechEaodFEWtDk1Q": 349,
    "UCJCzy0Fyrm0UhIrGQ7tHpjg": 3,
    "UCJdpDe5TsvHUhSzK5EfRtgw": 17,
    "UCJE9BZz0ld_yqc2ryoA3-GQ": 354,
    "UCJEpkwwDiTKS5lxwFttEbIQ": 281,
    "UCJePO0Zl-zZTqjpHO82RNNA": 339,
    "UCjFu-9GHnabzSFRAYm1B9Dw": 20,
    "UCJFU1SniFoAvixVoixnwiVg": 359,
    "UCJFZiqLMntJufDCHc6bQixg": 223,
    "UCjH4Z-uXHegQCTlGeUc7qUA": 12,
    "UCJIeV0tZCf3aL-4_Y-jncKw": 249,
    "UCJILY3bThqgIyFrFy6LQ3ww": 266,
    "UCJjjeqEYMSzdsKt6vJ78WVw": 28,
    "UCjk2nKmHzgH5Xy-C5qYRd5A": 219,
    "UCJkbFDMgYIC-uM4uj6Z4IbQ": 15,
    "UCjKPgy9YPt16z8AFMi-TLeA": 262,
    "UCJKVe_hw2HzCcQ9pFIoaw3w": 359,
    "UCjKz7BX3DOFHEhsagb-2Muw": 30,
    "UCJlcEuTs4LNMPn0xL3czRrA": 267,
    "UCjLEmnpCNeisMxy134KPwWw": 286,
    "UCjlmCrq4TP1I4xguOtJ-31w": 275,
    "UCjlO0QCarccGehZqm6rhnSQ": 319,
    "UCJMLq6i8piYf0AClqg8vsfA": 355,
    "UCjmLYMFRI56fZteeYu7kkpg": 269,
    "UCJmMPjJSRDOSfQKHHUs1efQ": 53,
    "UCjN-1QSJtD6RdRGXTf9L1Sw": 16,
    "UCJN7efhiwMD2ejB2wFnN5Iw": 127,
    "UCJoFZRvLVWDVX11sYC0N6Qg": 245,
    "UCjoGLVLapRciX38bwgDtttw": 185,
    "UCjooy4G0O8D-4KkE1SWr5Jg": 26,
    "UCJPAiylqzS9wJU8w5iRr5Gg": 54,
    "UCjqlgGE9PA7xEbE6XW5Tl9g": 6,
    "UCjQxLH9yqYXowVtH7a-6L-Q": 221,
    "UCjQyHnE_Q58jYTaP8gRHv4g": 328,
    "UCjr1VnM1LBRp9Ez2JGNndaA": 276,
    "UCjrs5Sse402rafaOP-k37Xw": 283,
    "UCjsABJX158qbQ0h98ZIXspA": 184,
    "UCJSBNjYCB1pu_t0FajsY17g": 340,
    "UCJSglVBagnVoCD82MsBlmDA": 228,
    "UCJtDr_tuvwv-lfN4Gejd5hQ": 277,
    "UCJtZ8bpQlM-tMNhDeQE4ogg": 44,
    "UCju5A0klfI-oklLAqUAY2sw": 16,
    "UCJubINhCcFXlsBwnHp0wl_g": 254,
    "UCJv02SHZgav7Mv3V0kBOR8Q": 185,
    "UCjv4bfP_67WLuPheS-Z8Ekg": 266,
    "UCJvCDGShDAxcqe-MdwUcJjA": 281,
    "UCjW4CngR-lKLxw7TxzxMVWg": 217,
    "UCJwnGUjoniJA3It-P2snc-A": 264,
    "UCJWTT5HZQbrkP1NUBwwVEbQ": 263,
    "UCjXBuHmWkieBApgBhDuJMMQ": 171,
    "UCJXIj8u4wVpN5kxieMTzW7A": 72,
    "UCJxIK02Po3xa46jG9RtbGYA": 296,
    "UCjXJYPsKxoJyc-1RPB6dSyw": 301,
    "UCJxwvbBoawRJtVgPgvMg-Qg": 251,
    "UCJxZpzx4wHzEYD-eCiZPikg": 297,
    "UCjzH42Z3aiRxY6SBP_MeihA": 195,
    "UCJZnhqz3mNpWJJ1FGrAy_qA": 269,
    "UCK_lMxHpJFGCGz3gXJgaoQw": 248,
    "UCk--7D107cvb6PKqAiAK5uQ": 78,
    "UCK-1eIMMbpbRBqnjmsFNqiQ": 7,
    "UCK-H5yv8OpCce5xmUrbOP8A": 2,
    "UCK-J76mePKSWV4Sl6zV1Eiw": 258,
    "UCk-m-OXRVEXUolSWtmY56oA": 10,
    "UCk-n2qPASA48IPgtYAsLYJg": 25,
    "UCK0OzXxJVvMjBnr9NeV1t1A": 15,
    "UCk1qKLPaznd5gnKms-2XHaA": 310,
    "UCk2k1y-d24nFyVCvyxnAaYA": 252,
    "UCk2q8NckMStR4uIK5hrDC4g": 285,
    "UCk4-LUmzFMETLt4Sn1J82Cw": 18,
    "UCK4lZqiWNuOf-CTyX3Qbj1w": 7,
    "UCk538Ux0EALmU4SOZmVfNRA": 99,
    "UCK6oCMib62eYAIPrlrYRVrw": 25,
    "UCK6vZrTlPNCrWzXHIgwDy4Q": 20,
    "UCk7UMlCJ6dlluad9GLKhHzg": 97,
    "UCk7zPbUEzyUmVfz_gJEHymg": 23,
    "UCK99i3t0--PW-qX0_H_WzTg": 51,
    "UCK9l6rTwU3hiSZijIMq51Gw": 344,
    "UCK9V2B22uJYu3N7eR_BT9QA": 23,
    "UCKAeNMLH_zCv-pSVjWLyHYw": 28,
    "UCKajmKUZ7age8zlTp-GvO2Q": 13,
    "UCkAqNPwqkw3u21YRID2rF8w": 196,
    "UCKAwc0NMXjkPGNkb-khG8Qg": 274,
    "UCkb-r702uhx4-6Lrmetp-Ow": 227,
    "UCkbFttoKBBaLTQfOa-ouGvA": 78,
    "UCKCb7zirdauYVUPokYvoNTQ": 123,
    "UCkcenwQpQwgNkG2sl28Az-A": 298,
    "UCkd3H8yZEXxZSGSOmxeHxrg": 140,
    "UCKDJzAxTJrO14C8eJo-0TSw": 139,
    "UCkDri1T0PnXbjINqUsoDFrA": 247,
    "UCKeA3GiW32eSZNdKK_ouw-A": 328,
    "UCkEcY4RbLYs2AF45nhkyjtw": 239,
    "UCkeECSuB4aRbUyQrgR2SJOQ": 264,
    "UCkevX8TzdLiIS12WPwKTS7A": 264,
    "UCKF1MD2q4prAsaQapJnKzuA": 307,
    "UCKGaMcZgDqo2dpEs3SW-L4g": 69,
    "UCkGiDxmJVfORwnm4kwEEt1Q": 129,
    "UCkhViRjLUKgIcVpar9JiNrw": 235,
    "UCKI3MdO4a1QvLrT_DWkH9eQ": 353,
    "UCkIimWZ9gBJRamKF0rmPU8w": 227,
    "UCkIKFUq55-oUsVsOUGQ7qXA": 359,
    "UCkiM6bCVlAGRkRm9R_CKbng": 318,
    "UCkIoEPncHPIWByx7OlzEVXQ": 319,
    "UCkiUByBCF1aOiRd16xAlPMg": 26,
    "UCKJexadCeNo3lu0U20skmNg": 14,
    "UCkjP_w607B-n4kWJrZAsHMQ": 278,
    "UCkJYa9mVS25eHOO9bM7YK3Q": 353,
    "UCkkdEmzZHMp9xqs_F7v1EQQ": 1,
    "UCKKH64iHZH2O9NdlsOQD2Qg": 74,
    "UCkKM0itKUXf1j0tJeGOI4lw": 296,
    "UCkkNp9yS5NDzN_VEukrtTaQ": 222,
    "UCkm1dVJoW8VRuUt4QGNyoug": 198,
    "UCkm5jTqzF3XSOsOdiACofgw": 266,
    "UCKMWFR6lAstLa7Vbf5dH7ig": 197,
    "UCKMYISTJAQ8xTplUPHiABlA": 269,
    "UCkN17JBEg63-17srUnyfWaA": 282,
    "UCkngxfPbmGyGl_RIq4FA3MQ": 232,
    "UCknOyz3O0-G6w5SJNAgO7uQ": 205,
    "UCKnts8S_hayjQIOXtQKCVIg": 211,
    "UCKofJjNEmQ3LwERp3pRVxtw": 229,
    "UCKp8ba_60r68AJ4d-bz0kXQ": 286,
    "UCKpbaZWXUTkGUKBmZ4ZUFxw": 18,
    "UCkPIfBOLoO0hVPG-tI2YeGg": 0,
    "UCKpKC3M5fkcEvtOr06dmYlA": 106,
    "UCKPNQgpjufFtB_OBgYJNL0g": 0,
    "UCkpqb53xiOvOgNYEbNpFSyw": 25,
    "UCkpxBlaxpnoMtObVL36gXAA": 16,
    "UCkQ8i_cz0prqdo9jj__L93Q": 338,
    "UCkQFRBUPh5mcF1kca4f_DvQ": 13,
    "UCKqRDf_aLT9kQkuLWkC0HWw": 278,
    "UCKRtoH_aSPlNG73v3didU5g": 238,
    "UCKSpM183c85d5V2cW5qaUjA": 328,
    "UCktUGMC7AKl1e8n20Ys8w0Q": 255,
    "UCKu59gTZ_rdEmerdx5rV4Yg": 163,
    "UCKUHfnNk_9kGED_2WaXrYhA": 246,
    "UCkul8Q_Dn0m0eZIeLLsuZQw": 327,
    "UCKuwxopq9c3cldzSOo4ceSA": 189,
    "UCKvij44VV9TWt-EM3evoRWg": 48,
    "UCKVQ9q8o_HPoMzf0bdUpgpw": 288,
    "UCkvYma9kesq6Jkp_SKNp7ow": 16,
    "UCKwATdrcjyzNv9c56PqJbWA": 59,
    "UCKWFm_17yck-zK4qE5CCSFw": 244,
    "UCkWnwVAYGshTEVDPZ451kBQ": 26,
    "UCKWwV1HHlTM1jw8znW4HI2A": 354,
    "UCkxbj3w_fzU0Ie8lsFLl7ng": 279,
    "UCKxqF8NxORtXspqf7LElQ-g": 24,
    "UCkYmpSIAkPgNg4wBeNn9JAA": 277,
    "UCKYPwPHjmgLWrJwkcLhGvNg": 9,
    "UCkYQc5CYxYyyMrn0i-uQyXw": 325,
    "UCkZif4byA067Xl_c199w3BQ": 15,
    "UCKzKgU-xlncdEG5WouqTfyg": 269,
    "UCL_O_HXgLJx3Auteer0n0pA": 36,
    "UCL_qhgtOy0dy1Agp8vkySQg": 16,
    "UCL-2thbJ7grC9fmGF4OLuTg": 34,
    "UCL-soYzCYr0oUJxJUBJnyvQ": 136,
    "UCl1oLKcAq93p-pwKfDGhiYQ": 10,
    "UCL34fAoFim9oHLbVzMKFavQ": 15,
    "UCL4UZHX-26xAtVT4Jys5A1Q": 251,
    "UCl69AEx4MdqMZH7Jtsm7Tig": 0,
    "UCL6Mo_l_ebCidjNpsWuyIvg": 280,
    "UCL7lolCifod5V21pPzR3K-w": 16,
    "UCL9dLCVvHyMiqjp2RDgowqQ": 20,
    "UCL9hJsdk9eQa0IlWbFB2oRg": 41,
    "UCLAl_kA_uPje7sH1TgJUnlw": 326,
    "UClalgSZ1Q4m2j96cP24XGBw": 15,
    "UClBEIFD7lKEJ2mQYUFaePtA": 18,
    "UCLdkcTt5vOfGi_myvK-iO0g": 19,
    "UCle1cz6rcyH0a-xoMYwLlAg": 318,
    "UCLe26g9dDVhx-pwscUZ9_kw": 90,
    "UCLeoYMhaM3UVlnmESpAoIfg": 55,
    "UCLEp9_-cPbHmyJ9dmjcEwCQ": 11,
    "UCLeT7sAyMHTR-9tls7lzCMw": 271,
    "UCLEXfayxeCKe0FXObRjyQhQ": 21,
    "UCLfAsY3iMUAF2vvDxvIjymQ": 90,
    "UClFSJcAQo0tm5ZnVZX-Kiag": 66,
    "UCLGaPXIpe67JWtwlrXZwTvw": 275,
    "UClgYOnvfPW9Yyb47UheMIkQ": 55,
    "UCLH2yQZY_yG165dVqtabtYw": 254,
    "UClHap4tvcYZnyiqgAyEs0BQ": 357,
    "UClhLb5qSZy0Gvn3c-HuaInQ": 127,
    "UCLhUvJ_wO9hOvv_yYENu4fQ": 248,
    "UCLI_XmsVZzOrOB1LaoV0BEQ": 23,
    "UCLIpj4TmXviSTNE_U5WG_Ug": 269,
    "UCLK0cRXu3PY7cPbdWiVYemA": 327,
    "UCLk1hcmxg8rJ3Nm1_GvxTRA": 271,
    "UCLK1T0xtIgPIP298CUV40IA": 278,
    "UCLKUX65DUynX3azXjBFh2CA": 228,
    "UCllKI7VjyANuS1RXatizfLQ": 242,
    "UCLLTq5nDGMGQwEmqeD3Yezw": 303,
    "UCLMC54YctropOupFX8jyz9A": 221,
    "UClMEozXfSVOS3xcF2ZQJqfw": 277,
    "UClMYGvekJOb51eBOCK-d4Dw": 147,
    "UCLNBff3KDEUxdfH_lkvyOKQ": 269,
    "UCLnKUWEIEVESNY-537GRU3g": 5,
    "UCLO12aWGUbbBIIoBrAq3SZA": 9,
    "UCLOnKw76ypBM5PeYr4OdkJQ": 1,
    "UClpOEZoIYhxIY6n5NNGaPbA": 0,
    "UCLqCmbd6bgcLaBVz3aA-68A": 81,
    "UCLQIMDHNE0ZGAiHIdMbq7dw": 349,
    "UClQuqgfslfwZ3-SPPDzb_QA": 27,
    "UClrQ7xhRBxS_v_-WuudGKmA": 221,
    "UCLRXibICU9WCCa3qG8fiFaA": 28,
    "UCLS28fzx6TqoccWmjzrG2YA": 103,
    "UClS3cnIUM9yzsBPQzeyX_8Q": 254,
    "UClS6k3w1sPwlVFqK3-yID5A": 231,
    "UCls95hH--nOEgKDjR2nKNUA": 150,
    "UClSBG7Pj_BzvBmEc6GgIAjQ": 349,
    "UCLSbJjbegkALewYKxfG__rA": 95,
    "UCLt8h9Z5jcYSqEMqv_l2kgA": 325,
    "UCLtcSflT3HmJucrOmlChKHg": 260,
    "UCltL6Tvv1aKrrYt4tnkmNtw": 23,
    "UCLUd--6WCQBy563GEkN0NJg": 37,
    "UClWFwzCosFg76rM6iUhFsIA": 258,
    "UClxj3GlGphZVgd1SLYhZKmg": 74,
    "UClxrt4pRmaqQnSlDii3EJBQ": 293,
    "UClyh1xSrABqbItEr3dBJosQ": 272,
    "UClzpoRto1BJXaRGe9OkkGLQ": 293,
    "UCM_Mb-ZC3jMg3p32jN6v4cA": 315,
    "UCM1nL55m_QImE0ZRqvGmWWQ": 21,
    "UCM1pPyAoHMn56Dyk8HBhdSg": 265,
    "UCM2SwvNjA0uH8oc5D0ihSDA": 85,
    "UCm4QiJHdsgz9PshJkGMSk5w": 56,
    "UCM69uU9b_raR3mcACHeivgg": 12,
    "UCm6JMVKxg8PvJjl3F7J0tdQ": 63,
    "UCm6NmXO5dxpdk-AxG3qyZRQ": 97,
    "UCm75JVwGM032VxSmw7FI1mQ": 3,
    "UCm8Dj7dQ0oRHXNUXF31kjEw": 357,
    "UCm8nQX91wYRpkMiZWLly3GQ": 126,
    "UCMAc88lqzqGV0uxgw9JDj0w": 217,
    "UCmaDYcJHNFrZ5Owuz-KM-Jw": 348,
    "UCmB1E78Kdgd9z6hN3ONRKow": 18,
    "UCmbokzv5VTe9LeuzAFcDu9A": 14,
    "UCmbs8T6MWqUHP1tIQvSgKrg": 269,
    "UCMBzCzLVj4J40PUtQUSY0eQ": 270,
    "UCMCBdyUhjf372hVCKDxoh8w": 273,
    "UCMCTUv9mWhE2KH4yG3KX_VA": 326,
    "UCmDbgImSrPBfNo4o1B0yTDg": 63,
    "UCme_K5Xd_DusukPab7iD67w": 160,
    "UCMeC1_0B_bnoyeqampk4QJA": 309,
    "UCmEehAwjzjAk1cwPP9DOaHw": 54,
    "UCmeyo5pRj_6PXG-CsGUuWWg": 279,
    "UCmFdkp21Jl2PLobz7UGm5Pw": 16,
    "UCMfMBbR9UBNvUyN8fujbJVw": 116,
    "UCmGQLXEbwBGtjaqyMO40Xbg": 340,
    "UCmgWMQkenFc72QnYkdxdoKA": 127,
    "UCMh-Au5vSbEtMZNOYvc1-jQ": 31,
    "UCMhjWfFiyxVjNWBJpkDotcg": 20,
    "UCmhtmUBjkXOAetnaDq-XJ1g": 293,
    "UCMHyqlEwC-IdXCQZht8g44w": 142,
    "UCmiYJycZXBGc4s_zjIRUHhQ": 269,
    "UCmJT-AhNcDrvZsN0UZKtysQ": 293,
    "UCmkA3ZlbadJFCfR7OnQWM0A": 291,
    "UCmkma_txKc51VxT9BSjvByQ": 20,
    "UCmKZED1y3oPf8sTaPu3XIQw": 303,
    "UCmLB7NCu7cmC7nhrN3fQE0g": 304,
    "UCmlvunkzaM1ACZrnLYR_JZg": 284,
    "UCMmcz1ybSoAD-GUlDx_7H2A": 258,
    "UCMMnAFarbXqv6SEImoANlAQ": 297,
    "UCmms2EE02mK4zdECwrHBpaA": 0,
    "UCmNeOjitXbWHg_CDNGrwoHw": 20,
    "UCMOe-3aL83MLz4ts1NENFaw": 46,
    "UCmovZ2th3Sqpd00F5RdeigQ": 326,
    "UCmp1vw137-GvWyrBFraXQUw": 355,
    "UCMp55EbT_ZlqiMS3lCj01BQ": 91,
    "UCmpEFsiD67ZOjn2CCJoo1mw": 26,
    "UCMPKmFrLWgZyCGOw0QAEiIQ": 196,
    "UCMpw36mXEu3SLsqdrJxUKNA": 36,
    "UCMPyGnBgm6l0KiLoxPI8x3A": 353,
    "UCMqGG8BRAiI1lJfKOpETM_w": 60,
    "UCmqrvfLMws-GLGHQcB5dasg": 176,
    "UCmrTXPnIhAm-hosYsZ8rAHg": 273,
    "UCmSmV7pyrMItYbxyyZeVJBg": 277,
    "UCmT0aSHuf-tb8UsvARLEjgg": 28,
    "UCmTRbCwWxsdsLe5a4GElcNA": 164,
    "UCmtuXBKrUdFlVgFUrA4Kvuw": 296,
    "UCMu8Uwowp1c1-N3mLnZnflA": 238,
    "UCmUjjW5zF1MMOhYUwwwQv9Q": 13,
    "UCMUmvaIF0-fBHzxt1PLOq3A": 343,
    "UCMvc8BlQ7r5gRbz-D2EY0LA": 96,
    "UCmVomBV_EV5WpXhlyqBXUww": 8,
    "UCMwGHR0BTZuLsmjY_NT5Pwg": 298,
    "UCMwY4OKlMbwJYzT_wDAXs3w": 11,
    "UCmxAWbOvT8osBX_tGMVFVPA": 89,
    "UCMXgokh6CT4v7LpGwfikTkw": 4,
    "UCMxIxoMdtcLkZ1wTq7qjztg": 262,
    "UCMxKcUjeTEcgHmC9Zzn3R4w": 29,
    "UCMxxFFeuhFQ30quuePTym0A": 357,
    "UCmyc8eVR3G9A7hjaHsLR6NQ": 240,
    "UCmYO-WfY7Tasry4D1YB4LJw": 280,
    "UCMyvP0GM_l4khRYDZ5eKvxA": 332,
    "UCmZ1Rbthn-6Jm_qOGjYsh5A": 264,
    "UCmZA7XRRzmxhM4jPltZX1Zg": 20,
    "UCMzVa7B8UEdrvUGsPmSgyjA": 356,
    "UCMzxQ58QL4NNbWghGymtHvw": 298,
    "UCn-mCuYyJQpRTxf14tPcxkA": 59,
    "UCn0bPhgINwJh_2SvHqcjO7Q": 256,
    "UCN0tg4W1Johw2KT188GGUuQ": 19,
    "UCn14Z641OthNps7vppBvZFA": 15,
    "UCn1coImC6NMDYCQfH_ILzXw": 49,
    "UCn1Zf28m6WbhMDjMjdIjOIA": 307,
    "UCN2uDnQBkmrdzTH26LtzKiA": 354,
    "UCn3HVGEh-uMStdkcSL6g7TA": 303,
    "UCn4XvlTXjGSvDynpxpOYZPQ": 52,
    "UCn58MSGrtsDY8N_VhyLcPjg": 86,
    "UCN5bD1YYapThOeadG7YkBOA": 241,
    "UCN84kddLj2J6OTgKl6Kkt7Q": 356,
    "UCn96UPNvrT3xkpN9sCZTGTA": 298,
    "UCnbJ8LTbHrsRgqkxwJXCU8w": 7,
    "UCnbNzG6tecF6BAdhuv_Tipg": 264,
    "UCnBOUGfsfcD6nUbpdDAwMfw": 100,
    "UCNbpZM28AR6GXvrUcZ5v0zg": 265,
    "UCNbvNifhbMHOjbStQiojiDg": 229,
    "UCncsOsnMBAAaYb6WidBYIDw": 341,
    "UCnd1H6EindKca9PbOddxWkQ": 14,
    "UCNDVQnBttqVsTZs7zOZHwWA": 1,
    "UCndWeMfiDIQs-o18GJPwETA": 294,
    "UCnDZwUFMzqOBcF3bjRfZD-g": 34,
    "UCNethwV7AkG4NKfNGaCuXMg": 195,
    "UCNex1zlO3-TIHgqeSGVFOsw": 21,
    "UCNf5FVGkl1Tv4A-N2fMN20Q": 255,
    "UCNFiS2XnCHcBnKnKICHDyrA": 247,
    "UCng1cLWRDtsCy-CeGzfa1jw": 299,
    "UCngBjKSLC8IhPNagQCnf2LQ": 4,
    "UCngFYCS8p8PX9wf4V8kLVgw": 271,
    "UCNGMMdEgYIUR6rC44v9aZ8w": 103,
    "UCNH-swU7qbGTQftgUh1Veyg": 39,
    "UCnin3au_ZfBGph17cXuHM-w": 1,
    "UCniv2gmY8r6JxC3XrKKlHLw": 73,
    "UCNj88lUpk9fyzQydjbsuzRw": 346,
    "UCnJNNk45O1QYS2oMRYFKSyw": 284,
    "UCnJo24KSPg3iGpZvspSaD9w": 305,
    "UCNjTjd2-PMC8Oo_-dCEss7A": 21,
    "UCNKf15eqoAhxJ6CalqgVSCA": 24,
    "UCnKt20HH_BiuID0FDHGMcvw": 0,
    "UCNLn0WqgKurXuo-3rlzKjAQ": 335,
    "UCNmFtWjc-dG1ih90JecO6Ww": 17,
    "UCNN0n29dfU-F3DQ4YvEenuQ": 26,
    "UCnn1Pb_JtyHbiDTELf7mgSA": 332,
    "UCNNbqO-6o-E4DJ7wQMndrVQ": 287,
    "UCnNLZWjl4GvVF4s8zBT9_kA": 264,
    "UCNObi6xvj6QeZ0g7BhAbF7w": 61,
    "UCNomdKfjGPeJCo3bXaHHPGw": 21,
    "UCNPn2INOtplZRLl2-6dnJIA": 24,
    "UCNPu5zXzXvS6pLCCaI5SnSA": 312,
    "UCNq94QHAnn-zCxXQYpvPk7A": 42,
    "UCnqDxEcVsvt7WpDy0px1HgA": 80,
    "UCNQRVwSH7vVkhunhRGe5W6w": 259,
    "UCnrJK-sb3gSn3kRLkmpmzaw": 295,
    "UCnSa7dnmEf6bmyS_34yqE_A": 344,
    "UCNskpCCH661BeRJkN8n8d-A": 9,
    "UCNTTkKKQOV_hSjj1_txwEPw": 272,
    "UCNtwkcCmjmPIqVYWkhnzjdw": 356,
    "UCnTwPSKk1bOaQ8D95m2SwaQ": 10,
    "UCNu3Wxws9DM5G6sZj_K-zhg": 8,
    "UCnUhgh7rNaLnvmya--q0pCw": 320,
    "UCNUS0XshN1Tf7iLdd0MpPAg": 194,
    "UCNV41fU_c4IvhrwHhGKSWLA": 22,
    "UCNVBHr5slQH4BVYog9Cppkg": 358,
    "UCnVbtCwr-5LXxUlGxsgD7sQ": 271,
    "UCNVEsYbiZjH5QLmGeSgTSzg": 260,
    "UCnvVG9RbOW3J6Ifqo-zKLiw": 311,
    "UCNW1Ex0r6HsWRD4LCtPwvoQ": 28,
    "UCNwjdfFJVqQ9-qi1lwn4olw": 324,
    "UCNwo7eikmX5HPs7NedWVBgw": 314,
    "UCNxKbKlIa1BTCq05pp384Mg": 91,
    "UCNydvA0D7GSuT0c9Zs-zWdw": 15,
    "UCnyE-wD1pE2GZOxA6OHjW9g": 339,
    "UCnYhIk9aGEx_bIgheVjs53w": 13,
    "UCnYrx-hDfnlBVuO8D8L2ByQ": 24,
    "UCnz0wcNhch0nU1a6nnRLmNQ": 9,
    "UCNz4hh9wLzfB-vf8JZmVwSQ": 65,
    "UCNZHLeBjtWAIpgh-LONoBHA": 348,
    "UCO_f6uJHsTFN36snt8ppIRA": 306,
    "UCO_o0X1-ESEk8LEr1g9x1wg": 249,
    "UCO-FZDAG0mOvgu6jmGg1tiA": 354,
    "UCO-n4ZDDXKPKK29c5eaytpA": 17,
    "UCO-qFBbGNAQ6vX1cHE2MxmQ": 298,
    "UCO0HdDEA0ZpTf_gSPqGulEg": 20,
    "UCO0NANkx_kVNnTomK94zpPA": 5,
    "UCO0UOvSRvaRe2XTBQ5pjRYQ": 78,
    "UCO2bnzPlCau6YzLoSt8EDdA": 20,
    "UCo2N7C-Z91waaR6lF3LL_jw": 203,
    "UCo3zRhsnXIieauvm6c-xwkA": 222,
    "UCO4zMaYBEzdYISfeoO6ip_Q": 326,
    "UCO5MA_Dr1o6I0IPQZ6tp_6w": 8,
    "UCo5pboqAxtr5gOFSDBGD09w": 289,
    "UCO62chyehk6pX7OitrnJAUg": 73,
    "UCO6mA1hC3Gv9jEoCTITjAQw": 349,
    "UCo6mwsozDGMW0UNGowBJGhg": 29,
    "UCO6ngsu6Bx1SnJgL1iLyafA": 11,
    "UCO6R8Pc5g2R7ObJQPBGppdg": 302,
    "UCo7TRj3cS-f_1D9ZDmuTsjw": 233,
    "UCO8WcDsF5znr-qsXlzZNpqg": 11,
    "UCo96eJdTpPOrxHFztYajbtg": 234,
    "UCo9wBz0FkJwiLeagB8tWXCg": 350,
    "UCoAL7HKxjpPGuA1G4bdfHTQ": 211,
    "UCoAQsc-DQ0MjfTp059otQAw": 356,
    "UCoAw3SML_09dF-7yhQU8wFQ": 265,
    "UCobENw9ZqZb1dpu6pT_8-9g": 346,
    "UCobEOOm5RDIupAg5bpZ31Dg": 74,
    "UCociy1BFTJsLL1z9amrEehQ": 97,
    "UCocnY-kJ7VYVA7SQLP8AHIA": 8,
    "UCODNLyn3L83wEmC0DLL0cxA": 314,
    "UCOeorikassgCW5Mw9JgOQmQ": 11,
    "UCoePNQDJTH27hrEMp6_O62A": 19,
    "UCOeWtmxz4_18CFUvnP5KjGw": 26,
    "UCOg01LJmZF9UnwFbly73CVw": 65,
    "UCoHouPtzx5hpyRg-RxeEp_A": 36,
    "UCOl0Rfe3Erum2cP74y7Eayw": 277,
    "UCOlwkBhjMe1PNm9055AQ88Q": 247,
    "UCom8rCUQZP98SIXJzMwjrxw": 94,
    "UComInW10MkHJs-_vi4rHQCQ": 82,
    "UCompe4fS2oUss8CGTuhOSxA": 10,
    "UCoNKCsX9tSxiuh9jznYxXfw": 274,
    "UCOnPtWuGIz0kTNGcb9FR8xQ": 351,
    "UCONtwJdE7A68l1eCjf8k4jQ": 287,
    "UConWeAx_HHF3ztw0Ec05pug": 19,
    "UCOoFLF5LEgA7WH08krUFa9Q": 18,
    "UCoOFzr8_DYKA69p0IgFoBtg": 50,
    "UCoOPu8WqToJ4jHbBXY6NPrA": 266,
    "UCOp2E63vw8m2ChLdvZ_fYYw": 43,
    "UCoPn3WqfWgbaS4fh19AkMNA": 311,
    "UCoqSuOp1CpewXVdlA5SLvKg": 197,
    "UCoqYsniJLqpjc-TlknuucHw": 274,
    "UCoS1_Fn4xDeyCYjIgQJOHGg": 3,
    "UCOseNFJYQJVDB-9D3egG4ZA": 275,
    "UCOSFGQ8d_eLCsjWXwuMh4LA": 5,
    "UCot8DHNnZ2X0ARgaNYZopjw": 274,
    "UCotQnZvYn2T-JiJTs8LrAlw": 182,
    "UCotXwY6s8pWmuWd_snKYjhg": 231,
    "UCOuaCgLWUPRwQtnX78Cat5w": 285,
    "UCoUFv7APM1XOo4TUaWbRekw": 261,
    "UCoupL81t75_Z4XRKzOSHLbg": 349,
    "UCoVOQRAu354dQIG047gNkFw": 27,
    "UCoW8qQy80mKH0RJTKAK-nNA": 130,
    "UCoWn6qkdxCSHvJElmgvzr1g": 4,
    "UCoX_ETXDQLX7T1WzhDNwIQQ": 357,
    "UCoXnzHGJbwAFoPzjUbkC6cw": 359,
    "UCoXSKKBV8CyxwibHl8c2QHg": 273,
    "UCoXWDfyKkziR0C01Zp559-Q": 9,
    "UCoY9O-RYuBYHNf41pgQHCnw": 354,
    "UCOyYb1c43VlX9rc_lT6NKQw": 29,
    "UCoztvTULBYd3WmStqYeoHcA": 4,
    "UCOZvtH_I_Xruzi0Le_GKAbg": 95,
    "UCozx5csNhCx1wsVq3SZVkBQ": 245,
    "UCp_3ej2br9l9L1DSoHVDZGw": 264,
    "UCp-5t9SrOQwXMU7iIjQfARg": 18,
    "UCp-8cPCziyRz2OXJWBOjsCQ": 169,
    "UCp-UfRz1EEPlX6xwfPKd2lQ": 26,
    "UCP03XuewcMC2DaSFDJhqJmA": 199,
    "UCP0BspO_AMEe3aQqqpo89Dg": 295,
    "UCP0Eq4VN3bUB5EJUerAugSQ": 74,
    "UCP19rQ5V-46B-6ZeLDJqp5w": 275,
    "UCp3tgHXw_HI0QMk1K8qh3gQ": 3,
    "UCP49yY6NEgddv28n6ECKFLg": 281,
    "UCP4g36UtLmGuqEUUIPLa1fg": 41,
    "UCp4G83RMBDN0EgZFSUDK7zw": 165,
    "UCp5nfeCnwHVuDZEqv-1brwA": 80,
    "UCP5zSITvbymag1L4eK2nrZA": 67,
    "UCp6993wxpyDPHUpavwDFqgg": 263,
    "UCp77Qho-YHhnklRr-DkjiOw": 139,
    "UCp7RIfl5Vjc30bnBL4KohQw": 2,
    "UCP9ZgeIJ3Ri9En69R0kJc9Q": 349,
    "UCpa3ff1zCBfEqua3xD9pXsg": 50,
    "UCPcsJUA8PhOy3c4y1Q1eu3g": 71,
    "UCPd0Z22gF43dUidPYEQO5-w": 294,
    "UCpe6USwJgyctDpWQhzVBeVQ": 85,
    "UCPEBV-1VoZvjYpgp8aFAQ0Q": 32,
    "UCPeF0V8dzSUYHwgLjvC86PQ": 335,
    "UCPEKpqpHu0ojN8lJnMUGjaQ": 0,
    "UCpeRj9-GaLGNUoKdI5I7vZA": 92,
    "UCPet_g252gdu3R_jg4VP_ZQ": 170,
    "UCPf-EnX70UM7jqjKwhDmS8g": 15,
    "UCpFAeyYSv4-7R1rC91c6DuA": 284,
    "UCpfjQCCavrO-rnKaAaIF9dg": 74,
    "UCPg_ly15LE5iAZo9KRp8aMA": 349,
    "UCpgM2Ycx8WC8eRNxGAL2i3Q": 119,
    "UCPH0ZS-AGZbt2JC51qFGrkw": 349,
    "UCPH7d3YxfeH56FG-UyPAB1g": 29,
    "UCpHIwGHq_3OfX42cyfyJp-A": 351,
    "UCPHqJsNtOp94Vcol4DPKpSA": 260,
    "UCPI-eyzOIfQiGE3JK7H8XEw": 253,
    "UCPiTBgk5j5A8wDdoyJ-01iA": 338,
    "UCpJc-f0Xs-u3QrkBQr5QiEQ": 47,
    "UCpJtk0myFr5WnyfsmnInP-w": 80,
    "UCpJx12AW2vILTylBTQhNRKA": 98,
    "UCpjypWF_wNRs9_TrjjWngpQ": 211,
    "UCPK3S9ij0DXINmTjQ4KhQVA": 10,
    "UCPkhI1WcLilaKu44B5p0jZg": 223,
    "UCPkKpOHxEDcwmUAnRpIu-Ng": 206,
    "UCPLeqi7rIqS9uY4_TrSUOMg": 244,
    "UCpLvJ42sm-edPGF8pKJonOQ": 8,
    "UCPm_htRQjzhgFikcO_LTvTA": 266,
    "UCPMOk4hbIh5A-_6uNhzAvDg": 307,
    "UCPMp2UuxV8Tz8GzcABKPsCA": 101,
    "UCpmSwekVKXnObCY7hpdHXdQ": 225,
    "UCpMTDhx-pe2QTOJMHCjDCMw": 298,
    "UCpNH2Zk2gw3JBjWAKSyZcQQ": 185,
    "UCPnOp0REt1QY1aA355pfE2g": 28,
    "UCpPkVnKaAqg9_conr8qAZjA": 85,
    "UCpPuEfqwYbpn7e2jWdQeWew": 352,
    "UCPqswBEjZm3FdvOzPyDw9wg": 299,
    "UCpRXCTyNNa-MnjhK6gisnRw": 97,
    "UCPtSgQ5-yCPl9wbo5w7tmWQ": 190,
    "UCPUcv2Zv9WhH6y8H1A9uWfg": 89,
    "UCPuqNtP0QO5uNUir6L7U-5g": 330,
    "UCPuvcSaRl8hmJObcLDQ3Qdw": 336,
    "UCPvGypSgfDkVe7JG2KygK7A": 284,
    "UCpvk50-r2n1FqXaRvEro9lg": 144,
    "UCPvtZdR4IN8EM10mSVVFV1Q": 12,
    "UCpwEuBTZQ8VFHuZa4ZcSsyg": 332,
    "UCPwohsg-7h_fuIOuKBRtTew": 33,
    "UCpxGLLkVwa2Q86w5Brok33g": 264,
    "UCPxMx-ftudQXzoYwxKjBmjQ": 94,
    "UCPxSh63XjfSYJbkBLxM3fSw": 29,
    "UCPXWk2EYjlwaCj6p-XnLbUg": 295,
    "UCpYf6C9QsP_BRf97vLuXlIA": 301,
    "UCpyujTZ5FrV3wkNdxwCRaQw": 15,
    "UCPzB4ROWho13wC9ngTCz1hA": 17,
    "UCpZIbzoEC_3rZglErpQkbDg": 285,
    "UCPzLuxpU9o3Bx67XY_1jd0g": 226,
    "UCQ-V5GotSJ1-xN8WYwpY7Ag": 258,
    "UCQ0mXXHhB9rc2vsu1ogDtSA": 33,
    "UCQ0UDLQCjY0rmuxCDE38FGg": 68,
    "UCQ1U65-CQdIoZ2_NA4Z4F7A": 353,
    "UCQ1zGxHrfEmmW4CPpBx9-qw": 41,
    "UCQ3_iXMIMehWxjY9ObVJsdQ": 6,
    "UCQ5_73vsQoCL_ieU3Uh0X5g": 4,
    "UCq5LQH-bD0Q3ZRhlclBAmqg": 244,
    "UCq6EBsKaFIUpac6fPkGu2PQ": 271,
    "UCq6zDxOHS0Hl7my19jOuRzg": 316,
    "UCQ7CahbXDmC0ibAULBxRJBQ": 255,
    "UCQ7KYc1-IMQ8_Uz7XTE5DWw": 8,
    "UCq7n-GF0SZ7Pt1NCVfTvIaQ": 273,
    "UCQ84yr-8if63nF8TZg8xcAQ": 20,
    "UCq8ewJ7MMd-sWixhlJ1tWuw": 259,
    "UCQ8F2dEhbkZu8RdKASyzBSQ": 305,
    "UCQ9ojibvAX4UXCMeDzuc68g": 283,
    "UCQaGj_l3dqmGWJLEbEmwgFQ": 50,
    "UCQb4rUTrgEUlEf4vN7e87Dw": 25,
    "UCQBM5oc2f9wLgbD_5x8voKA": 37,
    "UCQbn3hkCmc7d-X3pWiHKxpQ": 347,
    "UCQccGv1G0YL313NA28xTQ8A": 217,
    "UCqd9gfQFKjbrkfyr0-enzNw": 244,
    "UCqDN60QQx3GGmfagx1eyIEg": 11,
    "UCqe0-vqZwAvZUb22wCMu1fA": 293,
    "UCqEmTmyRamfTHxCVYR_gluA": 73,
    "UCQEqMSX5YYpQ9-4pdMip-vg": 21,
    "UCqewFfi_wwydw6fpazmlAFA": 63,
    "UCQfp96ujs7PXiUG6ov29RKg": 303,
    "UCqfXdQpIDb6nuTU_ZXd1NnA": 249,
    "UCQG5eRfno9f2rptcM6srQZA": 358,
    "UCqGLWrvVOqtrpxFdoTY5tYg": 38,
    "UCqGtqSn0NiOCottKpYwBc4w": 27,
    "UCQHCHIoeu0FRJTJNMG2_Ezw": 257,
    "UCqhnvjASWaS1eF_023Y--DQ": 288,
    "UCqHPlGki5aaT8hsA5_QWcQg": 13,
    "UCQjIXLk6lridUCQIBHaLMDw": 246,
    "UCqJkD0kgSoO4PchExX2ks3Q": 326,
    "UCQJoP9OHhKqUHiIDCMp412w": 182,
    "UCqjTqdVlvIipZXIKeCkHKUA": 113,
    "UCQKP8wRcQ4tNP__Ikv3X2UA": 286,
    "UCqlgtk9H_1GoWtvW8Vii38w": 22,
    "UCQLyq7TDKHlmp2Ufd5Z2qMw": 11,
    "UCQm--lgPz5Sq_b5hW9UXXQQ": 238,
    "UCqm3BQLlJfvkTsX_hvm0UmA": 16,
    "UCQnZmxiZOwvcXR_yLhhA50g": 266,
    "UCQoK32rBoWhHTBIWOYsYC4Q": 43,
    "UCqOPA9ZQ7uB4OXmCw1jTAPQ": 15,
    "UCQouenND5iNe6I-6mxt2rBw": 67,
    "UCqPx4VmOpL2NVvaZJOngSnA": 273,
    "UCqQb-TTl7VIMPYctVE9GWnA": 284,
    "UCqS5riKFNe0niYs1AG2wilw": 228,
    "UCqskJ0nmw-_eweWfsKvbrzQ": 180,
    "UCqSmlvDR6ZwM1At-5MDwbqg": 87,
    "UCqsS32C_llpT2ia5S1Oh44A": 34,
    "UCqTGCMjeKOclEEfW8Vs7sXQ": 80,
    "UCQU6SWDHJSaN4mcoRxK_kyw": 346,
    "UCQudM1LZYLl06QLmqtKQUiQ": 9,
    "UCquyWr7sdEFHCsqEgn1UA1g": 231,
    "UCqVwRGYcVavZ49rGmPB1DKA": 234,
    "UCqw3pdPEKKVOI7SFXomyKLA": 75,
    "UCqwhYNog2BVPDRzHYsYUEbw": 355,
    "UCqXsdheBs0ONTTiQTJqn5QQ": 249,
    "UCQXuGcIoseWY5HmW6-U7teg": 35,
    "UCqXvL55GYHtRZhBS03LVGnQ": 23,
    "UCqXxS-9x9Ha_UiH6hG4kh5Q": 227,
    "UCQY514VtpAastF9qI1mVr9w": 28,
    "UCqyL0oB2jl-5GpSg-GWZ_gw": 21,
    "UCQymE4njJ-t9oahwX9-iC8w": 337,
    "UCQYwIUCLqFoin7lHKmePjJw": 60,
    "UCqyX914s1cW_NwhbREvKTxA": 18,
    "UCqYXJ5M55HWE6zyvl6rjIaA": 262,
    "UCQYy35PowPpc6ImRH1TQgcw": 63,
    "UCQz5mRHdiwt7NrS9tc4D1Dg": 20,
    "UCqzwIwDJRvGhewGtvXCvu9g": 246,
    "UCR_NmKXLzwhhW3E0tXHJglQ": 357,
    "UCr09pC3aSihXjNXbm_uR4wQ": 285,
    "UCR0aSbKJnVenHPsmbBkIcDg": 89,
    "UCR1Htb-H1-tus7UPotPh69A": 57,
    "UCR2Sp9fMxurwtmXQneAMTVg": 293,
    "UCr3NozIjwp1k2B2wBiwQHtA": 252,
    "UCR3O-Ps1Q6CXrDRdSFvEHtA": 301,
    "UCr40BzcLiGruKe7M5gXR9zQ": 15,
    "UCR6iEupS3ZqqPMI4gJTZ6sQ": 61,
    "UCR6qhsLpn62WVxCBK1dkLow": 277,
    "UCr6rRU8fI3rRC-psnLlDW8g": 264,
    "UCr8NZ9jOrrVcIRnaHZCjJUg": 309,
    "UCr9p1ZjLKgfaoqNorY7PiWQ": 5,
    "UCRAP6PI9-BnPH3tYqWy1NKA": 244,
    "UCrAsByHNIFObjr2sEaZHkCg": 316,
    "UCRbsmnDTHD9-4pEIuG7zYRw": 307,
    "UCRbzJbCE7fDV7D_5Wv8_9Qg": 63,
    "UCRcLAVTbmx2-iNcXSsupdNA": 227,
    "UCRDdfcwxMannHdKfyw0hHWQ": 301,
    "UCrdeP-uXM5EPvAuxOA2Vxng": 9,
    "UCRDkw1IZn8pzAFyO99MZrCQ": 274,
    "UCRDKWD6xNd9IRathedwmEgw": 231,
    "UCrDRepCC81GaakxeWwJhMFA": 261,
    "UCred0xaqDGcYXWz2KUcd8pw": 6,
    "UCRf7OJA3azS4RsGd_G96FUw": 51,
    "UCRFcWtPFA7KkpmexCJFfkeA": 310,
    "UCRfz2yOn8C7Jg5zq4Xi67-Q": 21,
    "UCrG08WU5TTsVINMx7hLEmmQ": 83,
    "UCRG5fX1v4b-3sUyKfAAtxxA": 26,
    "UCRGoi4YW5afhZukGo3P8H_Q": 60,
    "UCrGTSXWMiAWoPlowSuMVZ4Q": 62,
    "UCRHgyuhghUjuZnKo6dTU4hg": 312,
    "UCrhhJPNsOqzNIkUfTABoSpg": 22,
    "UCrIs26bEKOvA_lRnO2Hgscw": 255,
    "UCRjiAP_0KdYHGdMUBkpLVTw": 43,
    "UCRJqr-GB6JjORPzQWun6S9w": 18,
    "UCRJV_1aV4aZjFAEUn6o5arw": 343,
    "UCrJWs9LeZ0LcnHfRxi8OKPQ": 72,
    "UCrk73NgQe0XPjKTAa-nXzKg": 202,
    "UCrKD8cwv_Wrpx22SO-VeWAQ": 0,
    "UCRkdFGXwBtxvm9SsfmNmMZA": 257,
    "UCrKJzFngweq8mA3zBAptwXg": 70,
    "UCrKS2bOUZDXA_R3qhCux7ow": 88,
    "UCrlV1Iy0clxpfBADND4ONIQ": 34,
    "UCRm6lqtdxs_Qo6HeL-SRQ-w": 25,
    "UCRMs0dRR4MEnCftyk6l1tvQ": 57,
    "UCroFIkR0bjqup9pPbAfaxsA": 308,
    "UCrOK22InJkQCsKZC6Bq0Bcg": 250,
    "UCROQtXcp2loQEmvpe5rhJzQ": 277,
    "UCrP4jHr7YrCnCDTI19SimEA": 18,
    "UCRqBKoKuX30ruKAq05pCeRQ": 167,
    "UCRQCV5LXaJKVQ35qaMuI0dw": 1,
    "UCrQPrfSgzfiUdp8WE2e9gNg": 300,
    "UCrQzlLd-Aew7aS71R8b3VPQ": 282,
    "UCrRdBPzK4sj-MMvYOhHRvHg": 172,
    "UCRRKdB87Oj-FkqS4L9QQRiQ": 30,
    "UCrS80YZ_-a_BaH_d8XL-3og": 65,
    "UCrsTmr4ZBqtb5TtX_w_wRLw": 357,
    "UCrsyP6H1Ftqt503xKE7_CUg": 25,
    "UCrt4cTM_sWH0iySLMkwwYLQ": 272,
    "UCrtj7mTumU4Pg9sdzfGZm6Q": 77,
    "UCRtugKQIPPfZmVZ6vLiOsdQ": 190,
    "UCRUFY2ZCyVOvC-1rJIVZlKg": 61,
    "UCrV1Hf5r8P148idjoSfrGEQ": 359,
    "UCrv1rxP_XqrEeaEREB7dzFQ": 300,
    "UCRV9d6YCYIMUszK-83TwxVA": 29,
    "UCRvkXFtB70ZADg4L6A8L3wQ": 246,
    "UCRvpMpzAXBRKJQuk-8-Sdvg": 127,
    "UCRvxgWZV-LYr0sPP0nmpTBw": 257,
    "UCRVYDlnhf6MCqbbf5-jjjsQ": 84,
    "UCRWF6QSuklmwY3UJHyVTQ1w": 83,
    "UCrWkFUu3DK5XpYBUPDC5uLA": 69,
    "UCRWOdwLRsenx2jLaiCAIU4A": 305,
    "UCrx5cwSB4bl3fI34Boxvq2A": 329,
    "UCRXBTd80F5IIWWY4HatJ5Ug": 39,
    "UCrXDgn1Jo6Vc0_ZlaMgyTbQ": 75,
    "UCRxQ9A9Rjww_wLUrRyQKb0g": 357,
    "UCRXqXc_ixp62KiSckhocSSw": 269,
    "UCrxtv0Zc8uQNfsY0HsAGY8g": 263,
    "UCRY2TC7xV6N_q9Fsx4Mp2Pw": 275,
    "UCrycDv1sYVGH5GK8XBTXABg": 355,
    "UCRYh9eOSnwcT6aftSf8hYUw": 252,
    "UCryOPk2GZ1meIDt53tL30Tw": 293,
    "UCRzoTlvAr66LWn41B7QSu1Q": 195,
    "UCrzRVEJbO4_aEDgN4WXo0mQ": 278,
    "UCS-xRujIU-uqF7B5t-Adc2A": 327,
    "UCS-XXTgVkotkbkDnGEprXpg": 273,
    "UCS1IqPUpSTzxuCvoPLqocFA": 174,
    "UCS2Dg5p3hplqjR8DamlW1eg": 96,
    "UCs2eFSeyAQqjH7PyjZwSH1w": 306,
    "UCs4bSiZgxDdAW4MSrig0PvQ": 42,
    "UCS5l_Y0oMVTjEos2LuyeSZQ": 22,
    "UCs5ojCJFNXaBgUrGmarvrPQ": 182,
    "UCS7sNAksJVcaqCKEQwcZ2JA": 279,
    "UCs86f6tbWatcKVt7emv9hfQ": 169,
    "UCs9_O1tRPMQTHQ-N_L6FU2g": 7,
    "UCS9vgAEQSQDhgTRIskKA2tA": 276,
    "UCsabgMZxnsDwYzCe9vcQbNw": 89,
    "UCSAFgtALLOrJ7P5yJh7YbPw": 41,
    "UCsAzaxwiKWolOWLH1bIU3wA": 45,
    "UCSB9S5M1ktSjDEdmTTOZqkA": 270,
    "UCsCAwLNMv0ZdmO-QXQeK_Ig": 223,
    "UCscLA6_oJpVQyV9fkjHneKA": 348,
    "UCSCmu_VjL4RR7rBjrvSAwSg": 31,
    "UCSFCh5NL4qXrAy9u-u2lX3g": 297,
    "UCsFgdazMeQtf8lHvISB1DLQ": 348,
    "UCsfggcx_LSxN1FzOYU0xH0A": 35,
    "UCsFn_ueskBkMCEyzCEqAOvg": 156,
    "UCsg-YqdqQ-KFF0LNk23BY4A": 59,
    "UCsg4TnP4vfR82IvQ5FKC9Cg": 156,
    "UCSgwEeOm7mrwPapt6PUt_5Q": 262,
    "UCSH2LgTRhPCsaVPW_emgDJg": 89,
    "UCSH4t_nhsNIoxPza4ooYqaA": 16,
    "UCsHILl-8i1H9316RPeTEcfQ": 15,
    "UCShXNLMXCfstmWKH_q86B8w": 24,
    "UCsiKFVHkQSMlSe0vaCG0anw": 62,
    "UCSiTkTBwIMwsAetwwzgFyBg": 301,
    "UCSjQDxud2HkAO2DVD3lwxmw": 51,
    "UCsjRqYxiTIhsQgDdFm9Ks6g": 134,
    "UCskh11uxbzX3GQTzHMOJZSQ": 29,
    "UCSlcMof1GIPvH6H_VcknCbQ": 39,
    "UCsM7ZqGb6qZ68h044y8dqEQ": 237,
    "UCSMhfe2KZ_tpm2ISWWbSC-A": 18,
    "UCsNIVzD4AJ2FPLi9rY7I05Q": 43,
    "UCSPiaTLJ5FQj7BJAM6Y4j7w": 45,
    "UCspv01oxUFf_MTSipURRhkA": 206,
    "UCsQqk4cn8pljUeadYbUVgyg": 354,
    "UCSrqod-g3OrXm5ldoNdCFBQ": 28,
    "UCSRSnY9sp1igbHx3pY7jySA": 13,
    "UCSSqkGEa3TlzHkvvGabwT_g": 38,
    "UCSUOEmvQLKPdiRnUgmHYX2g": 12,
    "UCsuu8qrlqJMNcZO1TS_vKTQ": 11,
    "UCSuVf5hodNJftAv0Zio-vXA": 299,
    "UCsvLzyduqA3GZC7cBRixxRg": 22,
    "UCsVUXbx_h0YEvfH41Zwa_5w": 278,
    "UCSVZ0dOBynRS9mI1S7HoJhQ": 213,
    "UCSw8TAyNIuPZc6gZqRKnO6A": 87,
    "UCSWkUurjlKM39CnS1hnfE_Q": 357,
    "UCswRX8mNNdn1fjRctZqzjgA": 208,
    "UCswvd6_YWmd6riRk-8oT-sA": 35,
    "UCsX2VFvpuLIQ2kZHfDjvi2g": 317,
    "UCsXMS7pHyF8s5UrpIwWP8gQ": 280,
    "UCsxs_R8xnsQN4t-F_3qQ8PQ": 194,
    "UCSzhhX7Jlr5rzUR_MFTDOUQ": 28,
    "UCSZTVauGKnA77Ym15ivQFgA": 255,
    "UCt0-gubsgxcYTGc8MsJSaHw": 237,
    "UCt0clH12Xk1-Ej5PXKGfdPA": 209,
    "UCt0CvoFAgrhVYd1X4P5Lqng": 6,
    "UCT16mw3e7Lm8DZzjnRfealg": 263,
    "UCT1kajmUhayQ4QaLlDbK23g": 71,
    "UCt30jJgChL8qeT9VPadidSw": 163,
    "UCt3HI_oat7L-TJVOQYp7sIg": 29,
    "UCt4uzM21MBcP0aJW-fTp4-w": 288,
    "UCt5-0i4AVHXaWJrL8Wql3mw": 171,
    "UCT5-iIJ3np5QwBkp_OiBTYQ": 265,
    "UCt5LKMT1F-ADuSWcIgCsTXw": 2,
    "UCt7_srJeiw55kTcK7M9ID6g": 313,
    "UCt7GA5G4wbw4iSvEzwuqkqw": 149,
    "UCT7sUh1Spye6kbBAMZPCsKA": 27,
    "UCt8tmsv8kL9Nc1sxvCo9j4Q": 41,
    "UCt8Xs96iRw-qeRLnx1GRH4g": 253,
    "UCT9eMfqcnG6dFHXqNe6xyQg": 331,
    "UCtAvQ5U0aXyKwm2i4GqFgJg": 269,
    "UCTbEua7o1f8I7EMBQlLjTpQ": 228,
    "UCtC3B1n4XMiJmrDtu1Ni5qw": 128,
    "UCtC7olOldksX4fcl_8XKUFA": 28,
    "UCTCbl97ja-28Mu_K_EHPeiQ": 8,
    "UCTcnJXO452QM1Bzg0qVtSmA": 262,
    "UCTDjY_fil039K4JPF8z6J9g": 65,
    "UCTEoGGp5G9AFbNOb3nmrY3w": 345,
    "UCTEZGNJDqv-isWSPRsEhnRA": 93,
    "UCTFCSCPvqjXEs3zq91aeOVg": 54,
    "UCtGgHePeV6ePoTtlEspXJbQ": 274,
    "UCth5j6WaPTf9osdNrdz92PA": 283,
    "UCtHY-tP0dyykhTRMmnfPs_g": 101,
    "UCTi_rzf5QIkXjhJjkbcAdTg": 206,
    "UCTIDlL4VwxOQVTrhEf32nBA": 306,
    "UCTIE7LM5X15NVugV7Krp9Hw": 13,
    "UCTJ15i3Bl-QbeBA4NCcpyJA": 24,
    "UCtj391Z3PBxq2MKq0b1-dxw": 12,
    "UCtjQoCilYbnxUXquXcVU3uA": 82,
    "UCTk5oKWUGXIzmVve-C_0oPw": 12,
    "UCtL8V7j0xpzLXWztmmtl5hg": 302,
    "UCtLfA_qUqCJtjXJM2ZR_keg": 13,
    "UCtM5G3bS7zM8bv6p-OwoNTw": 260,
    "UCTMgd9qnUD9qKBX5oTtD6ug": 50,
    "UCtMiyDQJ97iax5wuwGhLzGg": 11,
    "UCtmL-ahW1SLAN8Y31zkIJGQ": 283,
    "UCTNH2qG40u2KMe4MvMgaXVA": 320,
    "UCtnO2N4kPTXmyvedjGWdx3Q": 40,
    "UCTNpwWyoLgeJ-tsxWq7ucvw": 201,
    "UCTOQQLzatFOM3R91G8ZIyxw": 31,
    "UCtOy6aKyz2ltSKSkQccXVGA": 315,
    "UCtp1nFt0-kuM7s6vlgDRHJQ": 3,
    "UCTp5NHgkwroqGzoQlQSyJAQ": 69,
    "UCtpB6Bvhs1Um93ziEDACQ8g": 130,
    "UCTpyXDDGdkcw3GCol3lwq_w": 41,
    "UCTqk8vac-qpZC8bn029lk6A": 62,
    "UCtQwleVyBMjBGNuUQ7a-KYg": 196,
    "UCTRQ7X-nxix3gjjXUb6ylvA": 13,
    "UCtTU6L8VDMdz0E62TxHbIZg": 320,
    "UCTUhaUoo6SuzlRp_EJehewQ": 353,
    "UCtuoyOZhnxJ12pE294FdH8Q": 357,
    "UCTUYzaLYcTnKCsw1lHX2YzQ": 1,
    "UCTVFh6LIPPU6ea7jfUvc_YA": 134,
    "UCTVSOgYuSWmNAt-lnJPkEEw": 14,
    "UCtWH0tVAcUcSm4v96H5cAqQ": 356,
    "UCtX7NysS-O-27iZ-zH3JedA": 6,
    "UCTxoJgb4DzMd7tiM8cvf4PA": 280,
    "UCtYEdVH1gntEG3J7yGsMAeg": 263,
    "UCtyWhCj3AqKh2dXctLkDtng": 358,
    "UCTyzuXqhHQN2BMnFJKPWphA": 72,
    "UCTz_x6-9E2Mc8vSvPXPXBXg": 340,
    "UCTZ8Zj9WnD40QKT3zLbfveg": 230,
    "UCTZyqEU7dSXbc4b-NBolgMg": 156,
    "UCU_xRFdTRIneHBBAgNhSNaw": 267,
    "UCu-J8uIXuLZh16gG-cT1naw": 170,
    "UCu-rV2gPtJ-CsGxe71z_BrQ": 52,
    "UCu06qIis7ypubiMrH-3gRNg": 273,
    "UCu2gCn_jiX0yd47eKkPYYbQ": 359,
    "UCu2n3qHuOuQIygREMnWeQWg": 291,
    "UCU3Gh5BkFVEsxKpe9TvJsOA": 19,
    "UCu5nZcaVhqiskh--rhQv0rA": 353,
    "UCU6XL1U-MB7D7fFTSF2e_Pg": 277,
    "UCU8dA_oneCC6YnJ18HOQalA": 339,
    "UCU8VGKDhiSHLerg4wYXjhtw": 309,
    "UCU96TPgZ_cXtBp29EmabUtQ": 8,
    "UCuaDidGk4HNLOnQE9wzMMeQ": 78,
    "UCUAy59_4jUN0WGB5gLY8LBg": 264,
    "UCuBEdI-24bquMoP_dACignQ": 11,
    "UCuBf9cUDP4jj-agX9lhmQRg": 323,
    "UCUC1EIq0MtF-kctHPtQzIjQ": 357,
    "UCUc8GZfFxtmk7ZwSO7ccQ0g": 16,
    "UCUceQpufooVwkqcKPjepFLw": 17,
    "UCucJYLJSEFRRfV2CA_JGHIQ": 15,
    "UCucNf1IRpyQalBZM8HIZ4Ug": 296,
    "UCuCRPpSFUXrvBK__75GT8Yg": 57,
    "UCuDfldiO-ujdFC-36eYMl2g": 347,
    "UCUdlDvZJGGP78zvta3swIhw": 337,
    "UCUdlTxswKdGgstI2n-RlQTw": 290,
    "UCuDmUl3WY41FqGI_bUr62PA": 359,
    "UCuDY3ibSP2MFRgf7eo3cojg": 41,
    "UCUEiLI0PQYewvAEtp6vEitA": 314,
    "UCuep1JCrMvSxOGgGhBfJuYw": 25,
    "UCUEXMpxIa7le_CK6yYRAboA": 86,
    "UCuF8D_f-QrkBS9a-c5kFQTA": 26,
    "UCUfkaeS_RMaZfIapykxldVg": 267,
    "UCufQu4q65z63IgE4cfKs1BQ": 235,
    "UCuGD1paDrwhDP-PJteOh-UA": 50,
    "UCUHTdqEOFW_X4wGPOIayzkg": 154,
    "UCUI_DJ5jCR2lKwfJqc_yskg": 247,
    "UCuI_opAVX6qbxZY-a-AxFuQ": 56,
    "UCuI5XaO-6VkOEhHao6ij7JA": 357,
    "UCUIAL_OAPtNmlAlKfj-ZuRQ": 87,
    "UCujhOjvSoET9Sjj4TjHfz6A": 15,
    "UCuJpyIPTENcIMpdqGYCU6WA": 48,
    "UCuk7vapXKckSw6yCGGDspDg": 19,
    "UCUKD-uaobj9jiqB-VXt71mA": 172,
    "UCUKngXhjnKJ6KCyuC7ejI_w": 299,
    "UCUkYFx-HMPcTa7YMWTtD3vw": 14,
    "UCUL_-dZeUr4eF8CdtAXV10g": 270,
    "UCulpRaJyJGOZc6ieSO5qt0A": 245,
    "UCuMymp-zYqsjRY2WEIdS_SA": 213,
    "UCuopa0aa9XTQziWB1MiQlWA": 82,
    "UCuORn0gpP7nIM0M-H5oN7uw": 11,
    "UCup2TSNKxDM_SNCF9xuXSNg": 23,
    "UCUP8TmlO7NNra88AMqGU_vQ": 304,
    "UCupCAZz1l52vV8m-dvaoBVQ": 29,
    "UCuPHlMEd0cR-tvAYPjGWVwQ": 88,
    "UCupmjRr7kPgzXKh-cPxxGbg": 13,
    "UCurEA8YoqFwimJcAuSHU0MQ": 115,
    "UCURF_5QNzf8d8MlXRc3bjcQ": 264,
    "UCUSJIma7V4ImjirHMPBLQqw": 18,
    "UCutAaW976ttCjVTa46xrVfA": 2,
    "UCUtKkGKef8BYMs3h-3zQm9A": 233,
    "UCuTNHY_b7EvqhRO7COboxsQ": 271,
    "UCUtoueXsWIIwpb0joVtl6JA": 146,
    "UCUTrRvqZOTkxsQndPjXP9Sw": 7,
    "UCuuAb_72QzK0M1USPMEl1yw": 106,
    "UCUUNhAmPupTXMcKglezuFjQ": 11,
    "UCuVk2Al9auR476fHpeBiNGg": 87,
    "UCuvk5PilcvDECU7dDZhQiEw": 288,
    "UCuvYHCPdMxfvjW_F9w5LmRA": 19,
    "UCUWiEBm4pi_ApdyRPq_Sb8w": 257,
    "UCuWoH9mx0EgT69UyVxaw1NQ": 11,
    "UCuX1NOTF2wZVXo8WP1q7uLw": 126,
    "UCuy-kZJ7HWwUU-eKv0zUZFQ": 16,
    "UCuycJ_IsA5ESbTYhe05ozqQ": 80,
    "UCuyrIzf_bCTnyJHktJVpe4g": 191,
    "UCUyt08xfo-nPAUugQwaIYKQ": 277,
    "UCUYVXFLTfEUoC6pHLv7CpaA": 29,
    "UCuZ1ajvlGFUMCHZAPdetKHw": 96,
    "UCUZ5AlC3rTlM-rA2cj5RP6w": 183,
    "UCUz7tGmXSAxMO04Xvs9GVOA": 140,
    "UCUzJ90o1EjqUbk2pBAy0_aw": 263,
    "UCUZsNTEVYLyYI3FPqYrpm_A": 14,
    "UCV0YFbQEkDoWewu-LOlLwdA": 71,
    "UCv1fFr156jc65EMiLbaLImw": 315,
    "UCV1is8yPGubl7J7vG7K45Hg": 281,
    "UCv2bd2F-abCJaE7-wruZ6Bg": 339,
    "UCv2byPgvl60Mh1vQBnXuksA": 32,
    "UCV2m2UifDGr3ebjSnDv5rUA": 338,
    "UCv3EicDtxObcZZmnFcHvNnw": 45,
    "UCv4skZNlBQ_bmQNMmq4aegA": 5,
    "UCV5fHI5euR7ZC4ZqhYqlwYw": 347,
    "UCV5LeyelycKSPly52nT4Qcg": 267,
    "UCv5ndlKn_HNPySHP7mL1TTA": 15,
    "UCV5wmu2YD64XF1Y3DDuD-Rw": 13,
    "UCv5XfaorU_67je3AfovCEAQ": 30,
    "UCV5ZZlLjk5MKGg3L0n0vbzw": 358,
    "UCv6rts7X60zoL__5JPwdPGA": 294,
    "UCv7hPaqfIM06j3B1vOgSPyg": 246,
    "UCVAsOHcLLGVQq6aOpesOwBQ": 312,
    "UCvaTdHTWBGv3MKj3KVqJVCw": 296,
    "UCVAyRbZsu5lrv2_xvgliB2Q": 276,
    "UCVB6njJBYf-7Di03j8993AA": 311,
    "UCVbcZO1njpH5fsmGQnC-L2g": 318,
    "UCVbRXkQP-LumaBzfw-wsrrg": 227,
    "UCvCks1oVZfBuG1VXicOr5aw": 234,
    "UCVdG6wPQ31tqqxwcjkkV0gQ": 5,
    "UCvdnHDN9VpPFeLoB8BpPHFg": 7,
    "UCVDrzfo7NnOvNx8dU-Ebitg": 19,
    "UCVdt9lYJVyI2G-TnusGHM9g": 7,
    "UCVdX1tXsZs-BHdQ-ODP2X4A": 350,
    "UCVEvMzXlpobF6hhfwfAYKJg": 307,
    "UCvEX2UICvFAa_T6pqizC20g": 339,
    "UCVEypLUntZfAsC56LrD-UIw": 316,
    "UCvFgWnhRKSuTMHoh6fKAwhQ": 99,
    "UCvFS_og2AnvkcKIRVo1HlUQ": 38,
    "UCvgbuonmEURc7sGXLWPUYDQ": 32,
    "UCVGcTlGxcf67I6YUrdwDXeQ": 324,
    "UCvGfUjV0yRUmczK15_SMcWA": 359,
    "UCvglsaXuC9oHuDJZaZbs0AQ": 255,
    "UCVgTBOPtDwnpxLSkrLcv9gQ": 355,
    "UCVH_3Wx7lvQwaAWX6bE4-PQ": 265,
    "UCvh-4bGSvQfcg7kDb2lVzcQ": 268,
    "UCVhRMzNWYcg8XDTgB9NFRTw": 305,
    "UCVhYtU97qLJVElzKJzXfGxQ": 30,
    "UCvInZx9h3jC2JzsIzoOebWg": 32,
    "UCVIx8gfh26W4fZm9wjUR0-A": 261,
    "UCvj_cfALhRaO8dxa0Q6bgfg": 11,
    "UCVj0qG8hr8On0r5uYqpGE4w": 343,
    "UCVKdX-jZ0frmU4SJm43yh6g": 244,
    "UCvKw3PofZzkvDY5oF2kAbuw": 5,
    "UCVLsPBwDtv7n7FZLiOsvhSQ": 21,
    "UCvmppcdYf4HOv-tFQhHHJMA": 257,
    "UCvN5h1ShZtc7nly3pezRayg": 156,
    "UCvnO_CTJr80qayp5JFEf3Fw": 205,
    "UCVNTrSlNl69gHiYPt_eX64g": 22,
    "UCVo_KgPNsDKxHwzib7uarCw": 177,
    "UCvob8U-yjPS-fSf5bq7jvGw": 227,
    "UCvoQO7lOcmlD5WVuOLmCgmQ": 235,
    "UCVp6lhGaIDZRCXTc_pD-HTQ": 75,
    "UCvPlw6DtODOTwt76eaJg4Dw": 287,
    "UCvq_7I63tALUzJJvFOrjHPg": 308,
    "UCVqeEUJOJgH2uam5q_78W4g": 208,
    "UCvQIBipkXlXXVdGga9sn8dw": 90,
    "UCvuAdWg_I8U9kwVGZ4XLvog": 327,
    "UCvUc0m317LWTTPZoBQV479A": 349,
    "UCvUTCi2Ms1eP-bFnh0lfGHA": 314,
    "UCVv9h7LWpxqcAYevNQ1A1-g": 183,
    "UCVVt5tbZEzfQSIsHUh3b_vg": 264,
    "UCVwc3XV94ifVOonbFP6-7tw": 2,
    "UCVwYCJIcKru_15r-CPGveXg": 4,
    "UCVX-NoHO_ihN1KqAiCarzlg": 337,
    "UCVXGiGSzuMJr-FdKZq3mOzg": 55,
    "UCvy86WpnHG-h7-tgBVQBJYg": 22,
    "UCvYzwEkCQ27gPaj54wBsVOg": 85,
    "UCvzGlP9oQwU--Y0r9id_jnA": 117,
    "UCvzVB-EYuHFXHZrObB8a_Og": 70,
    "UCVzwLEJkdBeVFYy7HALfWhQ": 15,
    "UCw-kTlPnZYSHhlGMFJ17Znw": 87,
    "UCW-Nn0dm_kHTHObsQTOtlcw": 0,
    "UCW0EhUBJrTtjSywG4-MGgrQ": 280,
    "UCW0l6XXIjbHYdd11gSL1jog": 22,
    "UCw0ty0mpHBx6xZt-K_hfNcA": 300,
    "UCw1KNjVqfrJSfcFd6zlcSzA": 21,
    "UCw4J-5X7x1xUdbIcQkZ4VYA": 0,
    "UCw4MpdfIjJHnZ8OLuYFEgCQ": 339,
    "UCW5kRrAI7lxkXZPiZm1HfTw": 112,
    "UCW5uhrG1eCBYditmhL0Ykjw": 24,
    "UCW5YPK9Cwrlu3wVOX8NWDEg": 279,
    "UCw64ItsCX0Cb4lCjb68oTpw": 275,
    "UCW7GR_A6tdKc6YtNNw83AgA": 11,
    "UCW7htl9_IlxgjrXkn4Vu33w": 314,
    "UCW7WDwN4wIglKiH7TTRoBbA": 331,
    "UCw8bMzcXgX4SAQPraOJIVgA": 325,
    "UCW8WKciBixmaqaGqrlTITRQ": 53,
    "UCw9_unaq1z9CJXeFOZm-MfQ": 245,
    "UCW98GVLrx8lG_ddOts3cl4g": 240,
    "UCW9L0nw1rH-3nckyA8eeWxg": 5,
    "UCwaS8_S7kMiKA3izlTWHbQg": 354,
    "UCwAUQdBH_rg9SYjrydUj-dQ": 295,
    "UCwAX4JrrsHqs05yKQh03keg": 340,
    "UCwBmSNUOWnowsju5YG7dT6g": 273,
    "UCwBwiSuuYcfPc5WkmSw6qtQ": 14,
    "UCWCc8tO-uUl_7SJXIKJACMw": 225,
    "UCWChGhf3iYh9C_zAUNe9nag": 8,
    "UCWdLywu_nBU705wIJqqXx9g": 322,
    "UCwdwrnaJCQl69ZFc39NrySA": 355,
    "UCwePpiw1ocZRSNSkpKvVISw": 320,
    "UCWF-3hyAv7TFw8mpS_wHLmw": 270,
    "UCWfF0DB6m_t2CE3KcOOOX7g": 84,
    "UCWhFUlcawiD78qAD7zzS6Bw": 269,
    "UCwhH8ZM5aNdMo8XzkY2b-AA": 356,
    "UCwHrMTxlvNw0930t_dIaECw": 10,
    "UCWhv732tk4DAQ7X32qHKrfA": 295,
    "UCWImOidHDmm0KK20bkF-rSQ": 254,
    "UCWIPfdcux1WxuX5yZLPJDww": 251,
    "UCWIuRhTlxLn9x1L7nMLZxVw": 30,
    "UCwIwDOZlhJRDPvVwUmcHPOQ": 277,
    "UCwjGLaiIe39nsuXdxKE7MhA": 264,
    "UCwjlRIySBvZ-kLV5bfjya4A": 351,
    "UCwkfNQzKwICfPKs6V0ZUFZQ": 5,
    "UCwkVDkOudIxhYMG61Jv8Tww": 208,
    "UCwKydIfpAlllZap4K7dzJ4g": 31,
    "UCWL_9MaaMy8ObTDPmVHemjA": 260,
    "UCwL7dgTxKo8Y4RFIKWaf8gA": 132,
    "UCWm9Si8uzmWg8lq18wCi6nA": 1,
    "UCwmG_7y6pToRWHJ9TwFdZ1Q": 10,
    "UCWMwHoGz5QhhRDc3K8SQ6cw": 352,
    "UCWNV-ixuEAxaso9rLk5PRFQ": 265,
    "UCWNVjAzZmYUni8YBXYiy01w": 234,
    "UCWOKF8h6kFj2pRn3rCD6nyw": 340,
    "UCWQGiZK_rAMpnl4awiUrqqg": 55,
    "UCWQtYtq9EOB4-I5P-3fh8lA": 85,
    "UCwrCVLCD5Lm3EKpfiwg9PBA": 299,
    "UCWRgyZ7sllnMwli-9IeouTQ": 49,
    "UCwrjITPwG4q71HzihV2C7Nw": 97,
    "UCwRKt_raV3N5KZgxcFyC1vw": 231,
    "UCWRPqA0ehhWV4Hnp27PJCkQ": 95,
    "UCWrxLFxCjH3_1Ii-SGEBsdQ": 306,
    "UCWsfcksUUpoEvhia0_ut0bA": 263,
    "UCWtr2UnCkvyFZnzKBQqG3lg": 254,
    "UCwtyxO7B0xIv3XdtSvdnYgQ": 266,
    "UCwUNuXd6rN08SQFzlIH4Ozg": 203,
    "UCwuS0uY-Z2Gr_5OV2oFybFA": 17,
    "UCwwVVsJTvdeUK3sj4-qxgMQ": 65,
    "UCwXfrtn26oj7JW9fwB_z1bw": 31,
    "UCwXOUuxUxCJ1yD0JfogUvMg": 10,
    "UCwYESzW2VQ5VtpuK-_elBzA": 328,
    "UCwyzBrOA3sfi3RZjYj0x8gQ": 252,
    "UCWz0CSYCxf4MhRKPDm220AQ": 94,
    "UCwzpXmWAFEVKH3VzwvSlY_w": 281,
    "UCx_A6fns9qKjybu-6k0ur1g": 84,
    "UCx_zwZuGIS4jxO07kFk8G6Q": 238,
    "UCx-G0TH8a5kxsTIwSvheWpw": 20,
    "UCX2w__Ry85MpNQcI898K3KA": 3,
    "UCx45gypxj0fME6zxsLKsNow": 24,
    "UCX4WL24YEOUYd7qDsFSLDOw": 270,
    "UCx6SJSaAzGC7yY_wmeqIWGA": 356,
    "UCx7GU8C3cr7vqp_SbS-8P-w": 10,
    "UCX7WYPXASkYUm2GyomLllIg": 27,
    "UCX7YkU9nEeaoZbkVLVajcMg": 253,
    "UCx83BsemwWrkkbar8JNbnrQ": 300,
    "UCX88Pe54pxbJDSGIyGrzNdg": 352,
    "UCX8P-LApHpfSfT1ICdra-rQ": 68,
    "UCx8TAQNBAHvzqHw9obUlCAQ": 17,
    "UCx9Jdpe15OxFQrCDGriAIqA": 4,
    "UCx9yRTjbPuS1ZA1Hxdsxj4A": 270,
    "UCXAKcg8yuuewsq56tPgwkzg": 246,
    "UCxAxBPUKQZzDGeI9xNSex7g": 272,
    "UCxc0MrPoACKTFlV24GqX2sg": 250,
    "UCxc8EqhUyYaRywhQKpu-2sg": 248,
    "UCXcRVQCR6jHUpFaYjuuthAg": 164,
    "UCxDX9DXSqoRxxB-NO5Hz6XQ": 170,
    "UCXe8hqIk_Yap31y7EOCMdzg": 23,
    "UCxerQlE0t1yY4bqeK5ldM9A": 84,
    "UCXEtq-HwfxgedQ2tF6-txUQ": 259,
    "UCXF3MyKynKruuQuvQDr7Arw": 266,
    "UCXFhqQZk_sDW-MDXxnioxuQ": 261,
    "UCXflNk_Du_ql2Fko-OhHfIw": 24,
    "UCxfyW58K88YepKgIS1BLmOg": 254,
    "UCXGOa3UALiTiX7txYSsDh2A": 254,
    "UCXHPI-3mWB-4rfvjFoHAFWw": 2,
    "UCxI5FyblWfEVBJDbSwRPzyw": 42,
    "UCxJ9SJLG7dA00M7VoEe4ltw": 75,
    "UCXJmMrUT3UMB2bBBO3ABVsQ": 137,
    "UCxjQ7hHb0I3TGNi7iw8NWtg": 31,
    "UCxJVZE-A65Vdjg9J0XsGf6A": 318,
    "UCxk-xk9E_GS8Z5qJ-iBYLyw": 12,
    "UCXk991ipUbLpEsnPIDzYDOg": 12,
    "UCXKJGirkNWJIDMcHufaNKcw": 21,
    "UCXkoAHy8rg9tryYsD61IXOg": 270,
    "UCxL_Vlnhfo46sN6vPHR_4hA": 14,
    "UCxm2qC7Z7cjDAd6yPyl-sKQ": 34,
    "UCxm3RjoZHKNbvpiP5RW6Wlg": 26,
    "UCxm7yNjJsSvyvcG96-Cvmpw": 44,
    "UCxmbiuI6Gyyln9Ec7uZ-8wQ": 359,
    "UCxmQS8WZFJFms31zpDxSXhw": 2,
    "UCxn-IeA9DCFxUthBk6rYdQQ": 312,
    "UCXN-ZRdGnFtLiJ8EY1i_alg": 50,
    "UCxN7pUZzXmMOuost2oRCHUw": 21,
    "UCXoEt2GeYzlERNe9CkRsE2Q": 275,
    "UCXOG00AT1ts8aKutvdZfvBg": 316,
    "UCXoQVAAHlSXdAr3PJ2nK1LQ": 246,
    "UCxOTQ01cBN86_QX3jbNnW7g": 230,
    "UCxp-_zVZcJBwZzjLt-LwAaQ": 255,
    "UCxp0LCMGXynLAtl8mfwJkHw": 8,
    "UCXp26d9RQqUnCeRwaulXZgA": 327,
    "UCXp7sNC0F_qkjickvlYkg-Q": 52,
    "UCxpmipyCaJ07EHwKlrIKHkA": 268,
    "UCxq402WAMVFx5lNcMzKU0cA": 313,
    "UCxqB40OYroYH2s1xxf_3Plw": 353,
    "UCxR1xcxGQcXb4xX9cojKVcQ": 11,
    "UCxr2Qc48DAGqC5wflQw1qlw": 242,
    "UCXRlIK3Cw_TJIQC5kSJJQMg": 149,
    "UCxrmkJf_X1Yhte_a4devFzA": 9,
    "UCXSbl3XQYtx1u4Gvvca7NUA": 272,
    "UCxSJP2WWP_CKuayijH2lWfw": 82,
    "UCxsq3LUxUQPwMrLxqIqlMqQ": 41,
    "UCxSuoaaxXsWYbuFlBaRZX6g": 28,
    "UCxsZ6NCzjU_t4YSxQLBcM5A": 230,
    "UCXtBTX9FKmRWN0OpHfbB2Ew": 55,
    "UCxTIuegV_Vqx11ctdeezPRQ": 101,
    "UCXtpFDzOrngcgnzJJWovMOg": 179,
    "UCxu7SxO5GaB9tDgDIaNGMNA": 267,
    "UCXU7YYxy_iQd3ulXyO-zC2w": 84,
    "UCXUb2wcPPg7mPMaanF7Q_zw": 308,
    "UCXUu1nCtDMAbasD0wAK1cdw": 22,
    "UCXuXvC53isoiOUJKpUMSfLQ": 288,
    "UCxvhDD55L4OiabpPJKcoWeQ": 218,
    "UCxvlgkpP5z98LsRudHN_Ucg": 187,
    "UCXW4MqCQn-jCaxlX-nn-BYg": 285,
    "UCXw752V8J8yl_kkiEycyyqg": 290,
    "UCXWWTCS2f4FcD-V8SXdvrjA": 275,
    "UCxx2uRmAwkhb3QJMfLssgsw": 348,
    "UCxX7trAb1ZadPY6oGpny7SA": 30,
    "UCXX96uOJ0dnGOD6tf2Avq4A": 268,
    "UCXxakVxNmVfFEu1zuU9JmMQ": 267,
    "UCXXlhNCp1EPbDQ2pzmmy9aw": 299,
    "UCXXnWssOLdB2jg-4CznteAA": 14,
    "UCxy3KNlLQiN64tikKipnQNg": 8,
    "UCXyAitTabBsoRclTn_Gq-eA": 84,
    "UCxYkBSXKRgbxVwwqBQ_sy0w": 327,
    "UCxyTFoXTDyo16R2zBEMPZrw": 100,
    "UCXzcu59Cbu-hkpNNXnNiKDg": 302,
    "UCy5aIkRAdFp0Lml3s1ap-pA": 322,
    "UCy6Fu_0fDzQ7H-UWZFENklQ": 10,
    "UCY7Qs1UGnO3LYpNVwitTXUA": 105,
    "UCy8P3o5XlMpJGQY4WugzdNA": 354,
    "UCY8SN0bnFzfUTyAbYI1ORpQ": 15,
    "UCy91xBlY_Brh3bnHxKtjrrg": 341,
    "UCy951eHJiaOED-G2hsR4CjA": 261,
    "UCy9mgxB8pn2C4aNK_MPthDQ": 26,
    "UCYa58DdXGAGMJQHqTxi-isA": 97,
    "UCYADafT8oPKTdD7E9SrsuwA": 301,
    "UCyapmNSsYj2KkoQEhZEhxrw": 290,
    "UCyaxhmE-zyUIjMfCGQ75vlA": 88,
    "UCyb-cllCkMREr9de-hoiDrg": 245,
    "UCyCbd63S29BuFOkJC2-aR4g": 304,
    "UCycCBxHNj4QvCXxkC8tFa3w": 26,
    "UCYcnLc0n1ryBDZeGWQTVJ_g": 321,
    "UCycPDRVWCQakmKRKh6Z3Dqw": 91,
    "UCycU4fDdw0-SXsyjj2tvMVg": 249,
    "UCyD-4021fig0lxKSYK9DL-g": 271,
    "UCYf6p4uBTByWwR_DF-0EGaA": 310,
    "UCyF7SeIyWlUznk_sg_XjC8Q": 328,
    "UCyFnK5Qqa9P93jcBf31h9Bw": 324,
    "UCygtb6wTyiSxXYHPAHs3UKA": 15,
    "UCYiIgZVotTS9K3eb7nine0g": 244,
    "UCYjdP5F0ds2D6deMo5rpoyw": 343,
    "UCyJOgJhgfoVRpFjsBCUmuvg": 348,
    "UCyJPVXNqCOm5jHaneVwde_A": 90,
    "UCyK9d4b6gTZIORk2ka7TBnQ": 256,
    "UCYKf7Bcd5QhZHvkQQ96GXsw": 6,
    "UCykMWf8B8I7c_jA8FTy2tGw": 293,
    "UCYKP16oMX9KKPbrNgo_Kgag": 18,
    "UCYKX4HL54erXdCyMj7TpFyg": 296,
    "UCykXKu-j0Sm68h-kBxRMwpg": 310,
    "UCyLGcqYs7RsBb3L0SJfzGYA": 273,
    "UCYLp2FLXcqLUZhvrCxQmNIA": 344,
    "UCYm8zALd2uHqyy6C1tb4_zA": 356,
    "UCymJsbvAMc3j-bcsoxI7NZQ": 308,
    "UCyn3sHnu7Q2D4vF7jhd6fzQ": 138,
    "UCyNeg0jV71t0wbwHvPFYQlg": 81,
    "UCyO7wyh07pYJaZk51OV75bA": 92,
    "UCyO8Nae_zF-OpxtbL01Dwow": 193,
    "UCYOjhswZ0y5KYoLdMNR5QvQ": 52,
    "UCyPGVE5M6d6nK5JA1wIc07g": 143,
    "UCyQbgpFyFoCfp_cGTJYGp4w": 351,
    "UCyRkQSuhJILuGOuXk10voPg": 21,
    "UCYRUVhql7_2UiB5ADw8KZAQ": 358,
    "UCYRV9PtY5jx0x5PWV6hJD3w": 320,
    "UCySlA9Pv5IVXvkW_lN_NXRw": 152,
    "UCyT2VGLjNPvDdLHtQLuLj1Q": 349,
    "UCytjAmFoKRtd9CA9pSJeljw": 22,
    "UCYTz3uIgwVY3ZU-IQJS8r3A": 259,
    "UCyu3y1sc7SshB7VI1MoKinw": 334,
    "UCyUxY4O2vYtRjF7J8-IyHtw": 43,
    "UCYVhzyujupNgRbvVPcA3KrA": 17,
    "UCyViZK_Uh7cxvNGuJgb2YJw": 75,
    "UCyVypf7vg9KqoDiXkDIvetg": 328,
    "UCYX_iGrhBnFt0dyXwSi7U4Q": 273,
    "UCyXBNgCulibV9pRm3ZKpmoQ": 303,
    "UCyxmcqI51yu8Jac87_9U2nA": 12,
    "UCyxtGMdWlURZ30WSnEjDOQw": 235,
    "UCyY6YeINiwQoA-FnmdQCkug": 356,
    "UCYz_5n-uDuChHtLo7My1HnQ": 11,
    "UCyZZMKRn-mUEkPzaqa9b6bg": 90,
    "UCz_8ztQ9rcu_UpUp0hv7bYw": 277,
    "UCz_9zqgFPUYQBhDiZBFc00w": 338,
    "UCZ_AhGfYNG1aCIkeg601zoA": 25,
    "UCz-C8SKOIIJszraH1MuoLSQ": 29,
    "UCz1RAeb7dVaUcd-4rEgyxPw": 5,
    "UCZ1WJDkMNiZ_QwHnNrVf7Pw": 90,
    "UCZ1xuCK1kNmn5RzPYIZop3w": 195,
    "UCZ2rFJTs3IPJzYfxtvbKp8Q": 214,
    "UCz3MxafXlPxGCJVpFLI7fGQ": 202,
    "UCZ3pa-Ps7K_sh1ejEFxTzHg": 324,
    "UCz4jhqrCfthF8NnldZeK_rw": 23,
    "UCz6Gi81kE6p5cdW1rT0ixqw": 25,
    "UCz6tl7neFN4QX1qq0Xyyt_w": 20,
    "UCz6vnIbgiqFT9xUcD6Bp65Q": 264,
    "UCz89MGFBrAqwJ5xMr5weSuA": 120,
    "UCZ8HRnRgOhsjsnEPU37m4Cg": 17,
    "UCz9ybVl62AGclmn7S3WUwVw": 118,
    "UCzA7j_ixOvBz39saDYlbRiA": 242,
    "UCzArdRlyB498Ksl8BIiD6ZA": 252,
    "UCzAxQCoeJrmYkHr0cHfD0Nw": 18,
    "UCzbDTH6ennkRENJDBCk-NPw": 99,
    "UCzBhjWQ0wFcVaHW14exEdUA": 87,
    "UCzc8GwjUvecxpjhGtuewYOQ": 25,
    "UCzCAg-n7M4PIhSDPMstTOfQ": 245,
    "UCzcuYIyP-1YcXC96t9J5yWQ": 40,
    "UCzDItyJCdmen77IAVmcT7Rg": 347,
    "UCzdOjaT-KZVyHwLPP6YrFhw": 154,
    "UCzdqFhJKZMurlZ2gTA2D1rA": 291,
    "UCzeKqHQqEtsNfxO4JT9cA0w": 300,
    "UCZF1cUKuWlvo_wn--s-21kw": 85,
    "UCZfQRuwSLty74QAj55BaKlA": 192,
    "UCZgOv3YDEs-ZnZWDYVwJdmA": 268,
    "UCZHa6yKnBnU34yRyvV3EXSA": 255,
    "UCZhgX5W2iLfUm2NfyD7BSvw": 8,
    "UCzHiiP2r1zyTr8A1-6HtQtw": 238,
    "UCzhJ4os46kPnx3FCBdQ2oog": 291,
    "UCZIFph1bYyGxmFkkNNLAKdA": 263,
    "UCZilc7jP-X_92Fii1uTIs0Q": 62,
    "UCZjjxaAK8FIB50pjYQ1BwRg": 8,
    "UCZjRhT78El4L5hD4h_4wh1w": 14,
    "UCZk6mxfTpjuuxgqxuFBJO_g": 84,
    "UCZkZnbVO2bECxwcGlE9YOGg": 17,
    "UCZlj_hp57CuyacF5d7K0VMg": 186,
    "UCZLZ8Jjx_RN2CXloOmgTHVg": 26,
    "UCZmUoMwjyuQ59sk5_7Tx07A": 306,
    "UCzNXpqpdvlibmNc1JpM1o4g": 251,
    "UCZnZn-PIfo_REKwUvETBFOg": 255,
    "UCZOpV9NRi3dFsXPrwnlcuhA": 359,
    "UCZosSaot0tp8A18U042NX-g": 264,
    "UCZphYueZZE2NVcriExbnkBw": 32,
    "UCzPv09-SJeVd1hBdpvlhy0g": 245,
    "UCzqmve9zNnDLSkojLc1vgQg": 334,
    "UCzqQYhCoGsQhzUjtFjppW1Q": 2,
    "UCzRRvwffRA57lYoYwCsnJ7A": 310,
    "UCzrw4K7D9Ti3FP8WMTVPImg": 276,
    "UCZrYHIPsKhYAXqOls2kQQNQ": 208,
    "UCzS7rVMWfXlf5mskzgD0x9w": 268,
    "UCzsCWYuvPUky3-DKzphYbEw": 96,
    "UCZSip1bpubWCwkRjVrSY7ew": 11,
    "UCZsMm2mdQgg3AG8lP8s5KOA": 19,
    "UCzSn2NDLngzhEnLNI9yZZaQ": 358,
    "UCZszUCQMhWNVMxp6CSoyWoA": 18,
    "UCzT2D5ggRdMiwMowEtQH8Vg": 9,
    "UCZtjTxFDan4ORyt1x6oQ6qA": 325,
    "UCZTw6BZCzfjCarjJMRpU0Wg": 354,
    "UCzuELV9IeEGNI3_3MUSNnow": 298,
    "UCzUNASdzI4PV5SlqtYwAkKQ": 63,
    "UCZVbzYgAUSRVWKG3x1Jo0bg": 296,
    "UCZvdJ--YvY6LguIoP87djjA": 347,
    "UCZwsOhl_T0k2Sgf7S3JReNQ": 343,
    "UCZXxRYaP7mfuglPnptnBBCA": 288,
    "UCzXYQeroiCQoNRGOoqZ7yAw": 235,
    "UCZYetJ72XDX0sn5GQLx-rBA": 25,
    "UCzyhBffWik7EShr6PEMsVSQ": 27,
    "UCZYl1o6ftRLKZP6U4KjQl3g": 256,
    "UCZYTMrnVmu1iUVyGeqB6zJQ": 47,
    "UCZYyhgoV314CM14zBD6vd4A": 28,
    "UCzyzcQtOIF4lnGJ9IxrhaYA": 237,
    "UCZzBZtqCowlyG4ZXr6R_pIw": 80,
    "UCzZVy9bmPS-2nyxtDv8Wx2Q": 116,
  });

  // Low-chroma suggestions from the same source; keep their lightness.
  const OSHI_NEUTRALS = Object.assign(Object.create(null), {
    // BEGIN additional neutral colours
    "UC--zuEfONeFXPvLqX0Kvbuw": "#FFFFFF",
    "UC3n5uGu18FoCy23ggWWp8tA": "#B99C90",
    "UCFG6teapZaN6J1oVXl7MYPA": "#F0EEE6",
    "UCsq-OUWv1erpLBN6qLIc7jA": "#625E70",
    // END additional neutral colours
    "UC-ADLXZ3RVOPCGe1ZbuFQeg": "#777B67",
    "UC-B61nVgvmpt43Ao5gU1NIQ": "#37373F",
    "UC-Jg7D3KSMxGDaIrV-PiWHQ": "#444248",
    "UC01vkmFjimJGiyNZkU5dyvw": "#000000",
    "UC0NvtZTT8OR6F5uKYTU8zsA": "#000000",
    "UC0Yq1Xn1e6vz6pFP78UdGqQ": "#6E727D",
    "UC0gbkS-xhcWWXfWugQUSRuw": "#CBC0C9",
    "UC1N7FKfsmXBE6HRSm-skDOg": "#E4E5E5",
    "UC1Z_ZyF860JM9ZrhqswGUvw": "#656565",
    "UC2hA-6M66dE2Tt_4xM8K9wQ": "#1A1A1A",
    "UC2mtxQezpgWjqMXF6WkuMiw": "#D0D8DF",
    "UC2xXx1m1jeL0W84_0jTg-Yw": "#58535E",
    "UC3-jXrZXv-PQshpaTQpicPQ": "#292629",
    "UC37t08C9wUIUYyaAcWih4EA": "#B6B0B4",
    "UC3Yu6xnvxBE4n6oZl-nvUrQ": "#69666A",
    "UC7W6gEF88kzL-mN8V_QxzVg": "#1D2027",
    "UC7r2U8wAxsXHCMz9XlMWo4w": "#FFFFFF",
    "UC8hwewh9svh92E1gXvgVazg": "#F0F8FF",
    "UCAHQGIKolfBfoeXXMY79SBA": "#F5F5F5",
    "UCAWplMaLzyb-qQYmCpLRkQw": "#FFFFFF",
    "UCAZ_LA7f0sjuZ1Ni8L2uITw": "#000000",
    "UCAeWi9Yt5O85W_nqllbhZbA": "#999FA6",
    "UCAr4U_HGMYXn1EZjdWiGSLQ": "#858499",
    "UCBz3ZLAMLt9h_XKsd8rVTAg": "#1C1C24",
    "UCC0i9nECi4Gz7TU63xZwodg": "#DBE2E5",
    "UCC7-0COkIxKGkjAKOM_W88A": "#E5E5E5",
    "UCC7rRD6P7RQcx0hKv9RQP4w": "#F0F0F5",
    "UCCA4jJY5PrTfIFJIcbI_NhQ": "#554448",
    "UCDpo2vnJP5iQPoCs2gK0bJw": "#E5E4E2",
    "UCE7AsnCoT5-je_fob9MAEqw": "#28282B",
    "UCElYE3bfzjjmJ9xwjvro9Yw": "#777777",
    "UCF3Y12X8s0nAJHb4eJfxfqw": "#AD9BAF",
    "UCF_U2GCKHvDz52jWdizppIA": "#FFFFFF",
    "UCFktDt-CX7EIOlaKCiR8hLQ": "#ADA9AC",
    "UCGYAYLDE7TZiiC8U6teciDQ": "#EEFFFF",
    "UCGyywYAJd2O5Y7yUyr7qBRQ": "#EAEFF9",
    "UCH6jR8Ddrevo4OFddNr5ACg": "#4A4348",
    "UCHT_vElA_6ERjOvRbww01dw": "#FFFFFF",
    "UCHVkG_htYhk-JmJ5RWYMXzw": "#E5DDE2",
    "UCHfPYJaCDADVssISUw-49TQ": "#C9C0BD",
    "UCHyoRjhtov-qos0YNM6EO-w": "#DCC8CD",
    "UCIjxWfF5ZkeR5G6saJY1zdg": "#4E4954",
    "UCKDHdDpoE9lurDuyAGAuNnw": "#FFFFFF",
    "UCLeyYlqnD5k1fbZIIE4eTsg": "#D8CDD5",
    "UCLlJpxXt6L5d-XQ0cDdIyDQ": "#000000",
    "UCLlOiYZ-zZddt-0gi9w5f-A": "#FFFFFF",
    "UCM1XeucEZHYmxCXlYNTELoQ": "#D7D6DF",
    "UCMmy_EmxnYQ8aar8fNZrumw": "#CAD2DB",
    "UCN68LoM3khS4gdBMiWJO8WA": "#FFFEF7",
    "UCNRh9kkByBTYLo0IJupnAug": "#2C2C34",
    "UCNTEr2_96vJnXNazr5MwNLA": "#6E6466",
    "UCOrjRyXJpMzfQFLWuWzGwlg": "#29292C",
    "UCPYOimOwBfRzqZDXSZgbZ2g": "#E0DDDB",
    "UCPb47fygHcFbRp_y05mS0IA": "#272529",
    "UCPmcUzR-kh8hGVbNdYU84EA": "#52485E",
    "UCPs7s2VlkwVWWpjcyjviINA": "#727D81",
    "UCQ3s_kQYf3PuqOKu90HrIqw": "#888585",
    "UCQZRHtkGm9vrQCE7mg7znCg": "#7B7A81",
    "UCRQa9FvT-ZlxQrN6B2HjIgQ": "#5E505A",
    "UCSg5pqRJLeXJKNeFHmnY1Wg": "#0B0801",
    "UCTvHWSfBZgtxE4sILOaurIQ": "#BAB9C3",
    "UCUERxnZSjCq-G7OfYL7Nukg": "#C8D4DB",
    "UCV5jFxqHWDppyzznOBJbvVg": "#B3ADA0",
    "UCVKWJcuZlcaiF8_oUXuixPw": "#000000",
    "UCVKWgVm8BSlMkGZIDGaoElw": "#F1F2F4",
    "UCVct2_K-PjRJASohALRLetg": "#FFFFFF",
    "UCWU7kvLd_JBaBqO_ilTYd_A": "#66786F",
    "UCX74Y5S5x3ir1CvP1Atd8rg": "#FFFFFF",
    "UCXMdn7Omv5l2yqQxuepQtNA": "#ACAAAD",
    "UCXUtikLthPFa5DDmgT3naGA": "#C0C0C0",
    "UCYRSuz5cmJeSNnGB7jedITg": "#FFFFFF",
    "UCYadZR9mRignx4RKvPow44g": "#D3D6D0",
    "UCZ9qNOUR_SqqIJ0dPbQVV1Q": "#A2A2A2",
    "UCZl92wMipjYFc1Ulm9Yy65g": "#504149",
    "UCZoxWxYT0X_4gqUDo4kR6BA": "#676166",
    "UCaHgUmTyQhth2s07ChoKJuw": "#EEFDFF",
    "UCaOoqUGW62lIqaTMC7sHBBw": "#525D68",
    "UCaoat2Vz9i1_wbR7_ctv3bA": "#EAE5E6",
    "UCbEkHjG43yPMGq5W08jq1TQ": "#9FA9AF",
    "UCcgspKfdWRiCKtJ1E1pAWwA": "#CFCCD5",
    "UCcyTlQ92NIJ4fYR45OFpFQQ": "#FFFFFF",
    "UCdGvQEGxpmp4GmOrzDkIJUw": "#998A83",
    "UCdureux7B_V-xhM7tYImASQ": "#8E8889",
    "UCeDbLOdxWZazyjMUigvPqNQ": "#E2DEDF",
    "UCf5X1k-R3Vk-2OYYKraJ7dQ": "#68655F",
    "UCf8c5sicLVaB0QE36sGNhrw": "#525365",
    "UCfpcs6jK285d1TJWFhjej-Q": "#ABAFB1",
    "UCgRqGV1gBf2Esxh0Tz1vxzw": "#F9EEE2",
    "UCgSsXxQ71nScJ-GIc90ZkYw": "#EEDFD3",
    "UCgYCMluaLpERsyNXlPOvBtA": "#595458",
    "UCge_6FJHyeOCxRtWCmaVTAQ": "#DDCDDB",
    "UCh-GyPNxvjTsza0ptjnkh1w": "#FFFFFF",
    "UChS8E6_q2Ew6QV2M3yEa8xw": "#696969",
    "UCiAONpBlBxxtKD4YE6K-ckw": "#9C989B",
    "UCil-nSDmDTgV9n4jjb95znw": "#2F3A45",
    "UCjSsmEC1IRjnl71KJXuqugQ": "#CBD9D3",
    "UCj_KuUzpOXAliYEesJwdrbw": "#3D3D3C",
    "UCji4kFR4n5TnEpqga0SHxlQ": "#BDB7AB",
    "UCjtEttSHpJacfd7a6fc4VXQ": "#1A1A1A",
    "UCk0dNVAdlgn4ynURwAq_z2A": "#66797F",
    "UCkJ64W0J7R0zCSAsZfRIhVQ": "#282323",
    "UCl-3q6t6zdZwgIsFZELb7Zg": "#DDDDD9",
    "UClhkaSagypQdw7lxP7alQVA": "#BDBCCB",
    "UCm-diKKwiFGZBEvUpizjGIg": "#FFFFFF",
    "UCm5rjZAFQuRrnDCkxnwvWkg": "#808080",
    "UCnuAMfQpNCNT6ZHAL60kHwA": "#333231",
    "UCnzZmBOSrQf2wDBbnsDajVw": "#F1F4F4",
    "UCo-Icx5sh4tXGs8zGbhUSXQ": "#000000",
    "UCoFEbNyIRUS26-hf2AucwFw": "#F7FAFF",
    "UCpBFfy9QFTtQ3CGThag3-Ug": "#908F94",
    "UCpFy8D37SUStmeWh38NuppA": "#D6D3DD",
    "UCpGnS7rfBp2omHKGEzmKC3w": "#533E46",
    "UCs-lYkwb-NYKE9_ssTRDK3Q": "#414141",
    "UCs4zWdCrlnXmpVkjOgAHs0w": "#E3E1DE",
    "UCsABPC_SPKUaf7BkZGs4wbQ": "#A5A1A2",
    "UCsYLq9j1Ay8nEr9FgAZb9aw": "#D1C6C1",
    "UCsrH_eLD23MzxZAmbGMr0SQ": "#D2D2D2",
    "UCt8JrunDR7gUhYesn0jHtLg": "#D7D3DE",
    "UCt9H_RpQzhxzlyBxFqrdHqA": "#F9F1E4",
    "UCuPrcSmgo6twlAQzwYPlSkQ": "#948489",
    "UCv0hpsgpGWYdBsotEA3_5fQ": "#DEC9D0",
    "UCvOpPp1upxcTHyl0pFJTnHw": "#3B3840",
    "UCvTP_oyNX8KhevNCm44D9kg": "#526368",
    "UCvcQcNTD7FbXbnvrzcXixcA": "#A8A8AB",
    "UCw-jEa3_788VkvM2zHzrDnw": "#96828F",
    "UCwNNw9kUM-Bo0n2ktXOPB7Q": "#FFFFFF",
    "UCwb3FyYsmbtA9SvWLTNUpBA": "#807B74",
    "UCwi4P78SVunSYAGrvC9aKcw": "#FFFFFF",
    "UCxMjBu1cPzJpPWmGd0UdUhA": "#DAD5CE",
    "UCykgAuIjn70_CXLNjZ8zppQ": "#DADBDD",
    "UCzVku8IXYwuk04hCXUh6nng": "#465050",
  });

  function defaultHue(channelId) {
    if (OSHI_COLORS[channelId]) return hueFromHex(OSHI_COLORS[channelId]);
    const known = OSHI_HUES[channelId];
    if (known != null) return known;

    let h = 0;
    for (const ch of String(channelId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return HUES[h % HUES.length];
  }

  // Chromatic choices use a hue at the palette's fixed lightness and chroma.
  // Low-chroma choices keep their HEX instead, or white/grey would become red.
  function oklabAxes(r, g, b) {
    const linear = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const R = linear(r), G = linear(g), B = linear(b);

    // sRGB to Oklab, via the cube roots of the LMS cone responses.
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);

    const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    return [a, bb];
  }

  function hueOfColor(r, g, b) {
    const [a, bb] = oklabAxes(r, g, b);

    // Grey has no hue to speak of; pick something rather than a random angle.
    if (Math.hypot(a, bb) < 1e-4) return 0;
    // Rounding a value just below 360 must still return a canonical angle.
    return Math.round((Math.atan2(bb, a) * 180 / Math.PI + 360) % 360) % 360;
  }

  // The other way, so a colour picker can open on the colour already chosen.
  // Out-of-gamut hues are clamped rather than refused: this is only ever the
  // starting swatch of a picker.
  function hexOfHue(hue, lightness = 0.72, chroma = 0.19) {
    const h = (hue * Math.PI) / 180;

    const rgb = (c) => {
      const a = Math.cos(h) * c;
      const b = Math.sin(h) * c;
      const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
      const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
      const s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;
      return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
      ];
    };

    // Some hues at this lightness and chroma are outside sRGB. Clipping the
    // channels would shift the hue by up to nine degrees, so the chroma comes
    // down instead and the hue survives — which is the part being chosen.
    let found = rgb(chroma);
    for (let c = chroma; c > 0.01 && found.some((v) => v < -0.0005 || v > 1.0005); c -= 0.005) {
      found = rgb(c);
    }

    const channel = (v) => {
      const encoded = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055;
      return Math.max(0, Math.min(255, Math.round(encoded * 255)));
    };

    return "#" + found.map((v) => channel(v).toString(16).padStart(2, "0")).join("");
  }

  const hueFromHex = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return hueOfColor((n >> 16) & 255, (n >> 8) & 255, n & 255);
  };

  const validHex = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

  function neutralFromHex(hex) {
    if (!validHex(hex)) return null;
    const n = parseInt(hex.slice(1), 16);
    // Match the low-chroma colours in the source table, including tinted grey.
    return Math.hypot(...oklabAxes((n >> 16) & 255, (n >> 8) & 255, n & 255)) <= 0.04
      ? hex.toUpperCase() : null;
  }

  function channelColor(channelId, meta = {}) {
    const chosen = validHex(meta?.color) ? meta.color.toUpperCase() : null;
    if (chosen) return chosen;
    // Zero is a chosen hue too. Old saved hues keep priority over new defaults.
    if (meta?.hue != null) return null;
    return OSHI_COLORS[channelId] ?? OSHI_NEUTRALS[channelId] ?? null;
  }

  const blank = () => ({ by: {}, createdAt: Date.now() });

  // How often a card is used is a fact about a chat, not about the card.
  //
  // 👏 pressed fifty times in one channel says nothing about the next one,
  // and one shared number put a card nobody there had ever pressed at the
  // front of the hand. So every card keeps a count per channel, under `by`.
  // A channel-only card has one channel to begin with, so for those this
  // changes nothing.
  const noCount = () => ({ uses: 0, heat: 0, lastUsedAt: 0 });
  const countOn = (card, channelId) => (channelId && card.by?.[channelId]) || noCount();

  // Scope survives every earlier format, because every earlier format recorded
  // the same distinction under a different name. Deriving it from the content
  // instead would quietly broaden a channel-only card to every pool.
  const withScope = (card, implied) => ({
    ...card,
    scope: forcedScope(card.tokens) || card.scope || implied || GLOBAL
  });

  // Counts used to be one number per card, shared by every channel. Where
  // they were earned cannot be recovered, so each deck holding the card keeps
  // what there was: for a card in one deck — which is most of them — that is
  // exactly right, and for a card in several it is the only answer that does
  // not throw the order away on upgrade. They go their own ways from the next
  // press onwards.
  function splitCounts(card, decks) {
    const was = { uses: card.uses || 0, heat: card.heat || 0, lastUsedAt: card.lastUsedAt || 0 };
    delete card.uses; delete card.heat; delete card.lastUsedAt;

    // `by` is empty, not missing: blank() puts one on every card before this
    // runs, so "has it been split already" is whether anything is in it.
    if (!was.uses && !was.heat && !was.lastUsedAt) return card;
    if (Object.keys(card.by || {}).length) return card;

    const held = Object.entries(decks || {})
      // Before pruneImpossible has had a chance to normalise them: a legacy
      // card with counts to migrate reaches this while `decks[x]` is still
      // whatever storage held, and `{}.includes` is not a function.
      .filter(([, ids]) => Array.isArray(ids) && ids.includes(card.id))
      .map(([channelId]) => channelId);

    // A card in no deck is usually one that was ejected into the pool, and it
    // still says where it was used if it is tied to a channel: that is the
    // only channel it could ever have been used on. Dropping its counts threw
    // away a history that was right there in its scope.
    const scope = scopeOf(card);
    const where = held.length ? held : (scope === GLOBAL ? [] : [scope]);

    card.by = {};
    for (const channelId of where) card.by[channelId] = { ...was };
    return card;
  }

  // A card lives in the pool once. A deck is an ordered list of ids drawn from
  // it, so the same card can sit in several decks and hold a different place
  // in each — which a single shared ordering could never express.
  // Every shape goes through the same split, once the decks are known. It
  // used to be applied inside the first branch only, so anything arriving in
  // an older shape was given an empty `by` and its counts deleted unread: a
  // card with forty uses came back as one the first time it was pressed.
  function migrate(raw) {
    const { cards, decks } = shape(raw);
    const whole = cards.filter(readable);
    for (const card of whole) splitCounts(card, decks);
    return { cards: whole, decks };
  }

  // A card that is not a card is dropped here rather than carried into the
  // panel. Storage is only written by this extension, but it is also where a
  // restored backup lands and where a hand edit goes — and one null token
  // threw on the way out of read(), so nothing loaded at all until storage
  // was cleared by hand. Losing one bad card is recoverable; losing the panel
  // is not.
  const wholeTokens = (list) =>
    Array.isArray(list) && list.every((token) => !!token && typeof token === "object");

  const readable = (card) =>
    !!card && typeof card === "object" &&
    typeof card.id === "string" && !!card.id &&
    wholeTokens(card.tokens);

  function shape(raw) {
    if (Array.isArray(raw[KEYS.CARDS]) && raw[KEYS.DECKS]) {
      return {
        cards: raw[KEYS.CARDS].map((card) => withScope({ ...blank(), ...card })),
        decks: raw[KEYS.DECKS]
      };
    }

    const cards = [];
    const decks = {};
    const add = (channelId, id) => (decks[channelId] ||= []).push(id);

    // v0.3: one flat list, scope on the card.
    if (Array.isArray(raw[KEYS.CARDS])) {
      const commons = [];
      for (const card of raw[KEYS.CARDS]) {
        // Before withScope reads its tokens. migrate() drops what is not a
        // card, but only after the shapes have been built, and this branch
        // builds one by reading it.
        if (!card || typeof card !== "object") continue;
        // v0.3 stored the same idea in the same field.
        cards.push(withScope({ ...blank(), ...card }));
        if (card.scope && card.scope !== GLOBAL) add(card.scope, card.id);
        else commons.push(card.id);
      }
      // Commons used to appear everywhere; keep them visible where they were.
      for (const channelId of Object.keys(decks)) {
        for (const id of commons) add(channelId, id);
      }
      return { cards, decks };
    }

    // v0.1/v0.2: presets.global plus presets.channels.
    const legacy = raw[KEYS.LEGACY];
    if (!legacy) return { cards, decks };

    for (const [channelId, list] of Object.entries(legacy.channels || {})) {
      for (const card of list || []) {
        // presets.channels[X] meant "this card is X's" — that is the scope.
        cards.push(withScope({ ...blank(), ...card }, channelId));
        add(channelId, card.id);
      }
    }
    const commons = [];
    for (const card of legacy.global || []) {
      cards.push(withScope({ ...blank(), ...card }));
      commons.push(card.id);
    }
    for (const channelId of Object.keys(decks)) {
      for (const id of commons) add(channelId, id);
    }
    return { cards, decks };
  }

  // A deck holding a card it cannot send is state the app has no way to show
  // and no way to act on. Older builds could produce it; drop it on the way in
  // rather than carrying it forward.
  function pruneImpossible(cards, decks) {
    const byId = new Map(cards.map((card) => [card.id, card]));
    for (const [channelId, ids] of Object.entries(decks)) {
      // A deck is a list of ids. Anything else is not a deck with problems in
      // it, it is not a deck.
      if (!Array.isArray(ids)) { decks[channelId] = []; continue; }
      decks[channelId] = ids.filter((id) => {
        const card = byId.get(id);
        return card && usableOn(card, channelId);
      });
    }
  }

  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch (_) {
      return false;
    }
  };

  const storage = () => OD.vault || OD.privacy || chrome.storage.local;

  async function read() {
    if (!alive()) return null;

    let raw;
    try {
      raw = await storage().get(Object.values(KEYS));
    } catch (error) {
      OD.journal?.record({ kind: "error", what: "storage-read", stage: "read", errorType: error?.name });
      return null;
    }

    // Read-only. Migration happens in memory and is persisted by the first
    // operation the worker runs — a page context writing here would bypass the
    // queue and could land after a worker mutation, erasing it.
    const { cards, decks } = migrate(raw);
    pruneImpossible(cards, decks);

    return {
      // On the way out as well as the way in. A replace import writes the
      // file's settings wholesale, and storage can also be edited by hand or
      // written by a build that allowed something this one does not.
      settings: { ...DEFAULT_SETTINGS, ...cleanSettings(raw[KEYS.SETTINGS]) },
      cards,
      decks,
      channelMeta: raw[KEYS.CHANNELS] || {}
    };
  }

  async function write(patch) {
    if (!alive()) return false;
    try {
      await storage().set(patch);
      return true;
    } catch (error) {
      OD.journal?.record({ kind: "error", what: "storage-write", stage: "apply", errorType: error?.name });
      return false;
    }
  }

  // Cards and decks refer to each other, so they are written in one operation.
  // Split across two, a failure between them leaves cards whose scope has been
  // stripped with no deck map to replace it — the next migration then reads
  // every card as global and persists an empty deck map, losing every
  // membership for good.
  const save = (data) => write({ [KEYS.CARDS]: data.cards, [KEYS.DECKS]: data.decks });

  const writeChannelMeta = (channelMeta) => write({ [KEYS.CHANNELS]: channelMeta });

  /* ---------- decks ---------- */

  const byId = (data) => new Map(data.cards.map((card) => [card.id, card]));

  // Ids that no longer resolve are dropped rather than rendered as blanks.
  function deckOf(data, channelId) {
    if (!channelId) return [];
    const lookup = byId(data);
    return (data.decks[channelId] || []).map((id) => lookup.get(id)).filter(Boolean);
  }

  const GLOBAL = "global";

  // Member emoji only send on the channel that hands them out, so a card
  // carrying them can only be that channel's. Everything else is the user's
  // choice, which is why scope is stored rather than read back off the tokens.
  // tokens.js loads after this file, so the lookup is deferred to call time.
  function forcedScope(tokenList) {
    const required = OD.tokens?.requiredChannels?.(tokenList) || [];
    return required.length === 1 ? required[0] : null;
  }

  // The forced scope wins. A stored value can be wrong — an old build, a
  // hand-edited backup — and a member-emoji card marked global would be
  // offered in every pool and sent nowhere.
  const scopeOf = (card) => forcedScope(card.tokens) || card.scope || GLOBAL;

  // A universal card belongs to every channel; a channel-only one to just its own.
  function usableOn(card, channelId) {
    const scope = scopeOf(card);
    return scope === GLOBAL || (!!channelId && scope === channelId);
  }

  // The caller has already matched the full card key. A user's universal
  // copy takes priority over this channel's copy, regardless of storage order.
  // Previewing one card and loading another would change its stripe and history.
  function presetMatch(cards, channelId) {
    return cards.find((card) => scopeOf(card) === GLOBAL && usableOn(card, channelId)) ||
      cards.find((card) => usableOn(card, channelId));
  }

  // What a card may be set to: forced when it carries member emoji, otherwise
  // either.
  function allowedScope(tokenList, wanted, channelId) {
    const forced = forcedScope(tokenList);
    if (forced) return forced;
    return wanted && wanted !== GLOBAL ? channelId || GLOBAL : GLOBAL;
  }

  // Everything this channel could ever hold: universal cards plus its own
  // member cards. Stable whatever is in the deck, which is what makes it a
  // pool rather than a leftovers list.
  const compatibleWith = (data, channelId) =>
    data.cards.filter((card) => usableOn(card, channelId));

  // The subset it could still take — used where offering a card already in the
  // deck would be pointless.
  function poolFor(data, channelId) {
    const held = new Set(data.decks[channelId] || []);
    return compatibleWith(data, channelId).filter((card) => !held.has(card.id));
  }

  // Cards that work anywhere.
  const universal = (data) => data.cards.filter((card) => scopeOf(card) === GLOBAL);

  const inDeck = (data, channelId, cardId) =>
    (data.decks[channelId] || []).includes(cardId);

  // The caller is a UI that may have been looking at a stale list: the card can
  // have been deleted, or edited into something this channel cannot send.
  function addToDeck(data, channelId, cardId) {
    if (!channelId || inDeck(data, channelId, cardId)) return false;
    const card = data.cards.find((c) => c.id === cardId);
    if (!card || !usableOn(card, channelId)) return false;
    (data.decks[channelId] ||= []).push(cardId);
    return true;
  }

  // Leaving a deck is not deleting: the card stays in the pool.
  function removeFromDeck(data, channelId, cardId) {
    const list = data.decks[channelId];
    const index = list?.indexOf(cardId) ?? -1;
    if (index < 0) return -1;
    list.splice(index, 1);
    return index;
  }

  // Which decks hold this card — so deleting a universal card can say what
  // else it is about to vanish from.
  const decksHolding = (data, cardId) =>
    Object.entries(data.decks)
      .filter(([, ids]) => ids.includes(cardId))
      .map(([channelId]) => channelId);

  // Deleting is from the pool, so it leaves every deck at once.
  function deleteCard(data, cardId) {
    const index = data.cards.findIndex((card) => card.id === cardId);
    if (index < 0) return null;

    const [card] = data.cards.splice(index, 1);
    const memberships = {};
    for (const [channelId, ids] of Object.entries(data.decks)) {
      const at = ids.indexOf(cardId);
      if (at < 0) continue;
      memberships[channelId] = at;
      ids.splice(at, 1);
    }
    return { card, index, memberships };
  }

  function restoreCard(data, { card, index, memberships }) {
    data.cards.splice(Math.min(index, data.cards.length), 0, card);
    for (const [channelId, at] of Object.entries(memberships)) {
      // Undo restores what was deleted, not state that was already impossible.
      if (!usableOn(card, channelId)) continue;
      const list = (data.decks[channelId] ||= []);
      if (list.includes(card.id)) continue;
      list.splice(Math.min(at, list.length), 0, card.id);
    }
  }

  // Removing a deck keeps the cards that outlive it and takes the ones that
  // do not. A universal card belongs to every other pool, so it stays; a card
  // scoped to this channel can belong to no other deck and appear in no other
  // pool, so leaving it behind would strand it — paid for, invisible,
  // impossible to delete. Those go with the deck, including ones that were
  // only ever in the pool, and undo brings all of it back.
  function deleteDeck(data, channelId) {
    const ids = data.decks[channelId];
    if (!ids) return null;
    delete data.decks[channelId];

    const meta = data.channelMeta[channelId];
    delete data.channelMeta[channelId];

    // Its member cards can belong to no other deck and appear in no other
    // pool, so leaving them behind would strand them: paid for, invisible,
    // impossible to delete. They go with the deck, and undo brings both back.
    const exclusive = [];
    for (let i = data.cards.length - 1; i >= 0; i--) {
      // Only cards scoped to this channel: they can belong nowhere else and
      // appear in no other pool.
      if (scopeOf(data.cards[i]) !== channelId) continue;

      const card = data.cards[i];
      // Older state — or an imported backup — can have filed this card under a
      // channel that cannot send it. Clearing only this deck would leave that
      // reference pointing at a card that no longer exists.
      const strays = {};
      for (const [other, list] of Object.entries(data.decks)) {
        const at = list.indexOf(card.id);
        if (at < 0) continue;
        strays[other] = at;
        list.splice(at, 1);
      }

      exclusive.unshift({ card, index: i, strays });
      data.cards.splice(i, 1);
    }

    return { channelId, ids, meta, exclusive };
  }

  function restoreDeck(data, { channelId, ids, meta, exclusive }) {
    // Only fill in metadata nobody has set since; the deck may have been
    // recreated and renamed or recoloured while undo was still on screen.
    if (data.channelMeta[channelId]) meta = null;
    for (const { card, index, strays } of exclusive || []) {
      data.cards.splice(Math.min(index, data.cards.length), 0, card);
      for (const [other, at] of Object.entries(strays || {})) {
        // These were references a deck could never send. Deleting the deck
        // cleared them; undo brings the cards back, not the broken references.
        if (!usableOn(card, other)) continue;
        const list = (data.decks[other] ||= []);
        if (!list.includes(card.id)) list.splice(Math.min(at, list.length), 0, card.id);
      }
    }
    data.decks[channelId] = ids;
    if (meta) data.channelMeta[channelId] = meta;
  }

  // Order lives per deck, so the same card can be first here and last there.
  function reorderDeck(data, channelId, movedId, targetId, side) {
    const list = data.decks[channelId];
    if (!list) return false;

    const from = list.indexOf(movedId);
    if (from < 0) return false;

    list.splice(from, 1);
    let to = list.indexOf(targetId);
    if (to < 0) to = list.length;
    list.splice(side === "after" ? to + 1 : to, 0, movedId);
    return true;
  }

  /* ---------- ordering for display ---------- */

  function score(card, channelId, now) {
    const count = countOn(card, channelId);
    return count.heat * decay(now - count.lastUsedAt);
  }

  function sortCards(cards, sortBy, channelId) {
    if (sortBy === "manual") return cards.slice();
    if (sortBy === "uses") {
      return cards.slice()
        .sort((a, b) => countOn(b, channelId).uses - countOn(a, channelId).uses);
    }
    const now = Date.now();
    return cards.slice().sort((a, b) => score(b, channelId, now) - score(a, channelId, now));
  }

  function markUsed(card, channelId) {
    if (!channelId) return card;
    const now = Date.now();
    const count = { ...countOn(card, channelId) };
    count.heat = count.heat * decay(now - (count.lastUsedAt || now)) + 1;
    count.lastUsedAt = now;
    count.uses += 1;
    card.by = { ...(card.by || {}), [channelId]: count };
    return card;
  }

  /* ---------- mutations ---------- */

  // Every change is a named operation applied to freshly-read state. Two
  // contexts can both finish read() before either writes, and the loser's
  // change is simply gone — so nobody writes directly. The service worker
  // runs these one at a time (background.js), which is the only place in the
  // extension where ordering can be guaranteed.
  const OPS = {
    addCard(data, { card, channelId, scope }) {
      // Nothing is written that the next read would drop. The token walks
      // tolerate a token that is not one so that a bad card costs you the
      // card rather than the panel — which is right for reading, and would
      // be silent acceptance here.
      if (!card || typeof card !== "object" || !wholeTokens(card.tokens)) return false;

      // A card whose emoji come from two channels can be sent nowhere, and no
      // pool would ever show it.
      if (OD.tokens.requiredChannels(card.tokens).length > 1) return false;

      // The user picks universal or channel-only; member emoji override that,
      // because such a card physically cannot be sent elsewhere.
      card.scope = allowedScope(card.tokens, scope, channelId);
      if (card.scope !== GLOBAL && card.scope !== channelId) return false;

      // Two fast saves, or two tabs, can both decide there is no duplicate.
      // Only here is that decision made against settled state.
      //
      // The same wording is not the same card. One tied to another channel
      // cannot be sent here, so calling it a duplicate reported the save as
      // handled while putting nothing in this deck — the same mistake
      // loadPreset was fixed for, made again one function away.
      const key = OD.tokens.cardKey(card.tokens);
      const existing = data.cards.find(
        (c) => OD.tokens.cardKey(c.tokens) === key && usableOn(c, channelId));
      if (existing) {
        // The existing card keeps its own scope — silently re-scoping it would
        // change what every other deck holding it can do. Report what it is so
        // the caller can say why the chosen kind was not applied.
        const added = channelId ? addToDeck(data, channelId, existing.id) : false;
        return {
          id: existing.id,
          duplicate: true,
          added,
          scope: scopeOf(existing),
          wanted: allowedScope(card.tokens, scope, channelId)
        };
      }

      data.cards.push(card);
      if (channelId) addToDeck(data, channelId, card.id);
      return { id: card.id, duplicate: false };
    },

    // A preset is a starting hand, so it never replaces anything. A card
    // already in the pool is reused rather than copied — two cards with the
    // same words would both answer to the same reaction — and one already in
    // the deck is left where it is.
    loadPreset(data, { channelId, cards, name }) {
      if (!channelId || !Array.isArray(cards) || !cards.length) return false;

      // Several cards can share one wording — a universal one and a
      // channel-only one, say — so a key maps to all of them, and the one that
      // can be played here is chosen. Keeping only the last meant an
      // incompatible card could hide a perfectly good one behind it.
      const byKey = new Map();
      for (const card of data.cards) {
        const key = OD.tokens.cardKey(card.tokens);
        (byKey.get(key) || byKey.set(key, []).get(key)).push(card);
      }

      let added = 0;
      let reused = 0;

      for (const card of cards) {
        // Same as addCard: not written if the next read would drop it.
        if (!card || typeof card !== "object" || !wholeTokens(card.tokens)) continue;

        // A preset can carry this channel's member emoji — its readers watch
        // the same streamer — but nobody else's, and a hand-edited one might
        // try. Anything that cannot be sent here is not loaded here.
        const required = OD.tokens.requiredChannels(card.tokens);
        if (required.length && !required.every((id) => id === channelId)) continue;

        const key = OD.tokens.cardKey(card.tokens);
        const family = byKey.get(key) || [];

        // Same words is not the same card. One tied to another channel cannot
        // be played here, so reusing it put nothing in the deck while the
        // operation still reported the card as handled.
        const existing = presetMatch(family, channelId);
        if (existing) {
          reused += 1;
          addToDeck(data, channelId, existing.id);
          continue;
        }

        // A starting deck adds suggestions to this channel, even when an old
        // page or imported file still calls them universal. Existing cards
        // above keep their scope; backup restoration has its own operation.
        card.scope = allowedScope(card.tokens, channelId, channelId);
        data.cards.push(card);
        family.push(card);
        byKey.set(key, family);
        added += 1;
        addToDeck(data, channelId, card.id);
      }

      // Saving a card is what usually teaches us a channel's name. A deck that
      // begins with a preset never saves one, and would be listed by raw id —
      // so the name rides along, and the two are one action rather than two
      // that can come apart.
      if (name) {
        const existing = data.channelMeta[channelId] || {};
        data.channelMeta[channelId] = {
          hue: existing.hue ?? defaultHue(channelId),
          ...(channelColor(channelId, existing) ? { color: channelColor(channelId, existing) } : {}),
          name: existing.name || name
        };
      }

      return { added, reused };
    },

    editCard(data, { id, tokens }) {
      const card = data.cards.find((c) => c.id === id);
      if (!card) return false;
      // The worst of the three: the card already exists, so writing tokens
      // the next read would drop replaces something good with something that
      // disappears — and says it worked.
      if (!wholeTokens(tokens)) return false;
      if (OD.tokens.requiredChannels(tokens).length > 1) return false;
      card.tokens = tokens;
      // An edit can add member emoji, which pins a previously universal card.
      card.scope = allowedScope(tokens, card.scope, card.scope);
      // Editing can add member emoji, which pins the card to one channel.
      for (const channelId of Object.keys(data.decks)) {
        if (!usableOn(card, channelId)) removeFromDeck(data, channelId, id);
      }
      return true;
    },

    markUsed(data, { id, channelId }) {
      const card = data.cards.find((c) => c.id === id);
      if (card) markUsed(card, channelId);
      return !!card;
    },

    addToDeck: (data, { channelId, cardId }) => addToDeck(data, channelId, cardId),

    removeFromDeck: (data, { channelId, cardId }) =>
      removeFromDeck(data, channelId, cardId),

    // Put a card back where it was, tolerating whatever happened meanwhile:
    // the other surface may have re-added it, or deleted it outright.
    insertIntoDeck(data, { channelId, cardId, at }) {
      const card = data.cards.find((c) => c.id === cardId);
      // It may have been deleted, or edited into a card this channel cannot
      // send, while the undo button was still on screen.
      if (!card || !usableOn(card, channelId)) return false;

      const list = (data.decks[channelId] ||= []);
      if (list.includes(cardId)) return true;
      list.splice(Math.min(at ?? list.length, list.length), 0, cardId);
      return true;
    },

    // Add and position in one operation. Split across two messages, a failure
    // between them left the card appended while the caller reported success.
    addToDeckAt(data, { channelId, cardId, targetId, side }) {
      if (!addToDeck(data, channelId, cardId)) return false;
      if (targetId && targetId !== cardId) {
        reorderDeck(data, channelId, cardId, targetId, side || "before");
      }
      return true;
    },

    reorderDeck: (data, { channelId, movedId, targetId, side }) =>
      reorderDeck(data, channelId, movedId, targetId, side),

    deleteCard: (data, { id }) => deleteCard(data, id),

    // Answered by the worker, so the page cannot decide from a snapshot taken
    // before the other surface changed something.
    decksHolding: (data, { id }) => decksHolding(data, id),
    restoreCard: (data, { snapshot }) => (restoreCard(data, snapshot), true),

    deleteDeck: (data, { channelId }) => deleteDeck(data, channelId),

    // Merge rather than overwrite. The deck can have been recreated during the
    // undo window, and assigning the captured list back would silently drop
    // everything added since — so the current list is read first and folded in.
    restoreDeck(data, { snapshot }) {
      const since = [...(data.decks[snapshot.channelId] || [])];
      restoreDeck(data, snapshot);

      const byId = new Map(data.cards.map((c) => [c.id, c]));
      const seen = new Set();
      data.decks[snapshot.channelId] = [...snapshot.ids, ...since].filter((id) => {
        const card = byId.get(id);
        if (seen.has(id) || !card || !usableOn(card, snapshot.channelId)) return false;
        seen.add(id);
        return true;
      });
      return true;
    },

    // Changing scope can strand a card: made channel-only, it leaves every
    // other deck, since those decks could no longer send it.
    setScope(data, { id, scope, channelId, confirmedDecks }) {
      const card = data.cards.find((c) => c.id === id);
      if (!card) return false;

      const next = allowedScope(card.tokens, scope, channelId);
      if (next !== GLOBAL && next !== channelId) return false;
      if (next !== scope || (next !== GLOBAL && !/^UC[A-Za-z0-9_-]{22}$/.test(channelId))) return false;

      // A new deck may have taken this card while the warning was open.
      // Ask again before removing any membership the viewer has not seen.
      if (next !== GLOBAL && Array.isArray(confirmedDecks)) {
        const held = decksHolding(data, id).filter((deckId) => deckId !== next);
        if (held.some((deckId) => !confirmedDecks.includes(deckId))) {
          return { needsConfirmation: true, held };
        }
      }

      const dropped = {};
      card.scope = next;
      for (const [deckId, list] of Object.entries(data.decks)) {
        if (usableOn(card, deckId)) continue;
        const at = list.indexOf(id);
        if (at < 0) continue;
        dropped[deckId] = at;
        list.splice(at, 1);
      }
      return { scope: next, dropped };
    },

    // Settings were the last thing writing storage from a page, which a
    // replace import could race.
    setSettings(data, { patch }) {
      data.settings = { ...data.settings, ...cleanSettings(patch) };
      return data.settings;
    },

    ensureDeck(data, { channelId, name }) {
      if (typeof channelId !== "string" || !/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) return false;
      data.decks[channelId] ||= [];
      const existing = data.channelMeta[channelId] || {};
      data.channelMeta[channelId] = {
        ...existing,
        name: existing.name || (typeof name === "string" ? name : "")
      };
      return true;
    },

    setChannel(data, { channelId, hue, color, name, resetColor }) {
      const existing = data.channelMeta[channelId] || {};
      if (resetColor === true) {
        const { hue: oldHue, color: oldColor, ...rest } = existing;
        data.channelMeta[channelId] = rest;
        return true;
      }
      const chosen = hue == null && color === undefined
        ? channelColor(channelId, existing) : validHex(color) ? color.toUpperCase() : null;
      data.channelMeta[channelId] = {
        hue: hue ?? existing.hue ?? defaultHue(channelId),
        ...(chosen ? { color: chosen } : {}),
        name: name || existing.name || ""
      };
      return true;
    },

    // Computed here, not by the caller. Merging against a snapshot read before
    // the queue and then writing the result wholesale would roll back anything
    // that committed in between.
    importBackup(data, { raw, mode }) {
      // The pages that offer this check the file first, but the operation is
      // what actually applies it — and an op can be dispatched without going
      // past them. Checking here is what makes "nothing is applied unless it
      // passes" true of the store rather than of one caller.
      const wrong = OD.backup.validate(raw);
      if (wrong) return false;

      const next = mode === "replace"
        ? OD.backup.replace(raw)
        : OD.backup.merge(data, raw);

      data.cards = next.cards;
      data.decks = next.decks;
      data.channelMeta = next.channelMeta;
      if (mode === "replace" && next.settings) data.settings = next.settings;

      return { count: next.cards.length, added: next.added, linked: next.linked };
    }
  };

  // Operations that deliberately replace the settings object.
  const writesSettings = new Set(["importBackup", "setSettings"]);
  const readOnly = new Set(["decksHolding"]);

  // Runs inside the service worker only.
  async function runOp(name, args) {
    const op = OPS[name];
    if (!op) throw new Error(`unknown op: ${name}`);

    const data = await read();
    if (!data) return { ok: false, reason: "storage-read" };

    const value = op(data, args || {});
    if (value === false) return { ok: false, value, reason: "rejected" };
    if (name === "setScope" && value.needsConfirmation) {
      return { ok: false, value, reason: "scope-confirmation" };
    }
    // A question, not a change: answering it should not rewrite storage.
    if (readOnly.has(name)) return { ok: true, value };

    const patch = {
      [KEYS.CARDS]: data.cards,
      [KEYS.DECKS]: data.decks,
      [KEYS.CHANNELS]: data.channelMeta
    };
    // read() always returns settings, so writing them unconditionally would
    // let any card operation roll back a setting changed in between. Only an
    // operation that deliberately replaces them says so — and then they ride
    // the same write, which is what makes a restore all-or-nothing.
    if (writesSettings.has(name)) patch[KEYS.SETTINGS] = data.settings;

    const ok = await write(patch);
    return { ok, value, ...(!ok ? { reason: "storage-write" } : {}) };
  }

  // Called from the page contexts.
  async function apply(name, args) {
    if (!alive()) return { ok: false };
    try {
      const reply = await chrome.runtime.sendMessage({ type: "mutate", op: name, args });
      return reply || { ok: false };
    } catch (_) {
      OD.journal?.record({ kind: "error", what: "worker-unavailable", op: name });
      return { ok: false };
    }
  }

  // Settings alone, for a page that wants nothing else. The options page read
  // storage directly and merged what it found, so a restored backup carrying
  // `mode: "not-a-mode"` reached paint() — which looks the matching radio up
  // by value and set `.checked` on nothing. Everything that reads settings
  // now goes through the same gate.
  async function readSettings() {
    try {
      const raw = await storage().get(KEYS.SETTINGS);
      return { ...DEFAULT_SETTINGS, ...cleanSettings(raw?.[KEYS.SETTINGS]) };
    } catch (_) {
      return { ...DEFAULT_SETTINGS };
    }
  }

  OD.store = {
    OPS, runOp, apply, readSettings,
    KEYS, GLOBAL, DEFAULT_SETTINGS, alive,
    HUES, OSHI_COLORS, OSHI_HUES, OSHI_NEUTRALS, defaultHue, channelColor, neutralFromHex, hueOfColor, hueFromHex, hexOfHue,
    TUNING, tuning,
    scopeOf, allowedScope,
    read,
    deckOf, poolFor, compatibleWith, universal, usableOn, presetMatch, inDeck, decksHolding,
    addToDeck, removeFromDeck,
    deleteCard, restoreCard, deleteDeck, restoreDeck, reorderDeck,
    sortCards, markUsed, countOn
  };
})();
