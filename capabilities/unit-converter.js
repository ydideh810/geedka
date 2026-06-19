// unit-converter.js
//
// Universal unit converter — length, weight, temperature, volume, speed,
// area, energy, pressure, data, time. Pure math, zero external calls.
// Covers 100+ units across 12 categories.

const CATEGORIES = {
  length: {
    m:      1,          // base: meter
    km:     1000,
    cm:     0.01,
    mm:     0.001,
    mi:     1609.344,
    yd:     0.9144,
    ft:     0.3048,
    in:     0.0254,
    nm:     1e-9,
    um:     1e-6,
    nmi:   1852,        // nautical mile
    ly:    9.461e15,    // light-year
    au:    1.496e11,    // astronomical unit
  },
  weight: {
    kg:     1,          // base: kilogram
    g:      0.001,
    mg:     1e-6,
    lb:     0.453592,
    oz:     0.0283495,
    t:      1000,       // metric ton
    st:     6.35029,    // stone
    ct:     0.0002,     // carat
    ton:    907.185,    // US short ton
    tonne:  1000,
  },
  temperature: {
    c:  null,   // Celsius   — special handling
    f:  null,   // Fahrenheit
    k:  null,   // Kelvin
    r:  null,   // Rankine
  },
  volume: {
    l:      1,          // base: liter
    ml:     0.001,
    m3:     1000,
    cm3:    0.001,
    gal:    3.78541,    // US gallon
    qt:     0.946353,   // US quart
    pt:     0.473176,   // US pint
    cup:    0.236588,
    floz:   0.0295735,  // US fluid ounce
    tbsp:   0.0147868,
    tsp:    0.00492892,
    ukgal:  4.54609,    // UK/Imperial gallon
    bbl:    158.987,    // barrel (oil)
  },
  speed: {
    "m/s":  1,          // base: meters per second
    "km/h": 1/3.6,
    "mph":  0.44704,
    "ft/s": 0.3048,
    "kn":   0.514444,   // knot
    "mach": 340.29,     // Mach 1 at sea level
  },
  area: {
    m2:     1,          // base: square meter
    km2:    1e6,
    cm2:    0.0001,
    mm2:    1e-6,
    ha:     10000,
    acre:   4046.86,
    ft2:    0.092903,
    in2:    0.00064516,
    mi2:    2.59e6,
    yd2:    0.836127,
  },
  energy: {
    j:      1,          // base: joule
    kj:     1000,
    mj:     1e6,
    cal:    4.184,
    kcal:   4184,
    wh:     3600,
    kwh:    3.6e6,
    btu:    1055.06,
    ev:     1.60218e-19,
    ftlb:   1.35582,
  },
  pressure: {
    pa:     1,          // base: pascal
    kpa:    1000,
    mpa:    1e6,
    bar:    100000,
    mbar:   100,
    atm:    101325,
    psi:    6894.76,
    torr:   133.322,
    mmhg:   133.322,
    inhg:   3386.39,
  },
  data: {
    b:      1,          // base: byte
    kb:     1024,
    mb:     1048576,
    gb:     1073741824,
    tb:     1.0995e12,
    pb:     1.1259e15,
    bit:    0.125,
    kbit:   128,
    mbit:   131072,
    gbit:   1.342e8,
  },
  time: {
    s:      1,          // base: second
    ms:     0.001,
    us:     1e-6,
    min:    60,
    h:      3600,
    d:      86400,
    wk:     604800,
    mo:     2629800,    // avg month (365.25/12 days)
    yr:     31557600,   // Julian year
    dec:    315576000,  // decade
  },
  angle: {
    deg:    1,          // base: degree
    rad:    180/Math.PI,
    grad:   0.9,
    turn:   360,
    arcmin: 1/60,
    arcsec: 1/3600,
  },
  frequency: {
    hz:     1,
    khz:    1000,
    mhz:    1e6,
    ghz:    1e9,
    thz:    1e12,
    rpm:    1/60,
  },
};

// All known units → category mapping
const UNIT_MAP = {};
for (const [cat, units] of Object.entries(CATEGORIES)) {
  for (const unit of Object.keys(units)) {
    if (!UNIT_MAP[unit]) UNIT_MAP[unit] = [];
    UNIT_MAP[unit].push(cat);
  }
}

function toBase(category, unit, value) {
  if (category === "temperature") {
    switch (unit) {
      case "c": return value;                   // C is base
      case "f": return (value - 32) * 5/9;
      case "k": return value - 273.15;
      case "r": return (value - 491.67) * 5/9;
    }
  }
  const factor = CATEGORIES[category][unit];
  if (factor === undefined) throw new Error(`unknown unit '${unit}' in ${category}`);
  return value * factor;
}

function fromBase(category, unit, baseValue) {
  if (category === "temperature") {
    switch (unit) {
      case "c": return baseValue;
      case "f": return baseValue * 9/5 + 32;
      case "k": return baseValue + 273.15;
      case "r": return (baseValue + 273.15) * 9/5;
    }
  }
  const factor = CATEGORIES[category][unit];
  return baseValue / factor;
}

function inferCategory(from, to) {
  const fromCats = UNIT_MAP[from] || [];
  const toCats   = UNIT_MAP[to]   || [];
  const shared   = fromCats.filter(c => toCats.includes(c));
  return shared[0] || null;
}

function round8(n) {
  if (!isFinite(n)) return n;
  const magnitude = Math.abs(n);
  if (magnitude === 0) return 0;
  if (magnitude >= 0.001 && magnitude < 1e9) return parseFloat(n.toPrecision(8));
  return parseFloat(n.toExponential(6));
}

export default {
  name: "unit-converter",
  price: "$0.002",

  description:
    "Converts between 100+ units across 12 categories: length, weight, temperature, volume, speed, area, energy, pressure, data, time, angle, frequency. Handles mixed-case inputs (km, KM, Km all work). Returns the converted value plus all common units in the same category. Zero external calls — pure math.",

  inputSchema: {
    type: "object",
    properties: {
      value: {
        type: "number",
        description: "Numeric value to convert.",
      },
      from: {
        type: "string",
        description: "Source unit (e.g. 'kg', 'mi', 'f', 'kwh', 'mph', 'gb', 'psi'). Case-insensitive.",
      },
      to: {
        type: "string",
        description: "Target unit. If omitted, returns all units in the same category.",
      },
    },
    required: [],
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      value:        { type: "number" },
      from:         { type: "string" },
      category:     { type: "string" },
      result:       { type: "number",  description: "Converted value (when 'to' is specified)." },
      to:           { type: "string"  },
      all_units:    { type: "object",  description: "All units in the same category with converted values." },
      generated_at: { type: "string" },
    },
  },

  async handler(query) {
    const value = query.value ?? 1;
    const from = (query.from || "km").toLowerCase();
    const to   = query.to?.toLowerCase();

    if (!isFinite(value)) throw new Error("'value' must be a finite number");

    const fromCats = UNIT_MAP[from];
    if (!fromCats || fromCats.length === 0) {
      throw new Error(`unknown unit '${from}' — supported categories: ${Object.keys(CATEGORIES).join(", ")}`);
    }

    let category = fromCats[0];

    if (to) {
      const toCats = UNIT_MAP[to] || [];
      const shared = fromCats.filter(c => toCats.includes(c));
      if (shared.length === 0) {
        throw new Error(`units '${from}' and '${to}' are not in the same category`);
      }
      category = shared[0];

      const base    = toBase(category, from, value);
      const result  = fromBase(category, to, base);

      return {
        value,
        from,
        to,
        category,
        result:       round8(result),
        generated_at: new Date().toISOString(),
      };
    }

    // Return all units in category
    const base     = toBase(category, from, value);
    const allUnits = {};
    for (const [unit, _] of Object.entries(CATEGORIES[category])) {
      allUnits[unit] = round8(fromBase(category, unit, base));
    }

    return {
      value,
      from,
      category,
      all_units:    allUnits,
      generated_at: new Date().toISOString(),
    };
  },
};
