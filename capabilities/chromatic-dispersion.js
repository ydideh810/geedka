// chromatic-dispersion.js
//
// Fiber optic chromatic dispersion calculator.
// Computes dispersion coefficient, accumulated dispersion, and dispersion
// slope for standard and non-zero dispersion-shifted fiber types.
// Pure mathematics — no external API, zero latency.
//
// Seam: orbisapi.com/proxy/chromatic-dispersion-calculator-api — 1,447 sett/wk, 3 payers, $0.005/call
//
// Useful for optical network design agents, telecom simulation workflows,
// and fiber link budget calculations.

// Fiber type parameters (Sellmeier-based, typical manufacturer specs)
const FIBER_TYPES = {
  // Standard single-mode (ITU-T G.652)
  "smf28": {
    name:           "SMF-28 (G.652D)",
    lambda0:        1312,    // nm, zero-dispersion wavelength
    S0:             0.092,   // ps/(nm²·km), zero-dispersion slope
    D_at_1550:      17.0,    // ps/(nm·km) at 1550 nm
    aeff:           80,      // µm² effective area
    attenuation:    0.2,     // dB/km at 1550 nm
  },
  // Non-zero dispersion-shifted fiber (ITU-T G.655, e.g. TrueWave RS)
  "nzdsf": {
    name:           "NZDSF (G.655)",
    lambda0:        1490,
    S0:             0.060,
    D_at_1550:      4.0,
    aeff:           55,
    attenuation:    0.2,
  },
  // Dispersion-shifted fiber (ITU-T G.653) — optimized at 1550 nm
  "dsf": {
    name:           "DSF (G.653)",
    lambda0:        1550,
    S0:             0.070,
    D_at_1550:      0.0,
    aeff:           50,
    attenuation:    0.2,
  },
  // Large effective area fiber (LEAF, G.655C)
  "leaf": {
    name:           "LEAF (G.655C)",
    lambda0:        1510,
    S0:             0.055,
    D_at_1550:      4.2,
    aeff:           72,
    attenuation:    0.2,
  },
  // Dispersion-compensating fiber (DCF)
  "dcf": {
    name:           "DCF (generic)",
    lambda0:        null,
    S0:             null,
    D_at_1550:      -80.0,   // typical
    aeff:           20,
    attenuation:    0.5,
  },
  // Ultra-low loss (ITU-T G.654, e.g. long-haul submarine)
  "ullsf": {
    name:           "ULLSF (G.654)",
    lambda0:        1300,
    S0:             0.085,
    D_at_1550:      20.0,
    aeff:           150,
    attenuation:    0.155,
  },
};

// Dispersion coefficient D(λ) for G.652 / G.655 style fiber using Sellmeier slope model
function calcDispersion(fiberType, wavelength_nm) {
  const fiber = FIBER_TYPES[fiberType];
  if (!fiber || fiber.lambda0 === null) {
    // DCF: use flat D_at_1550 (no slope model available for generic DCF)
    return fiber ? fiber.D_at_1550 : null;
  }
  // Standard formula: D(λ) = (S₀/4) * [λ - λ₀⁴/λ³]  (ps/(nm·km))
  const lam = wavelength_nm;
  const l0  = fiber.lambda0;
  const S0  = fiber.S0;
  return (S0 / 4) * (lam - Math.pow(l0, 4) / Math.pow(lam, 3));
}

// Dispersion slope S(λ) = dD/dλ = (S₀/4) * (1 + 3λ₀⁴/λ⁴)
function calcSlope(fiberType, wavelength_nm) {
  const fiber = FIBER_TYPES[fiberType];
  if (!fiber || fiber.lambda0 === null) return fiber?.S0 || null;
  const lam = wavelength_nm;
  const l0  = fiber.lambda0;
  const S0  = fiber.S0;
  return (S0 / 4) * (1 + 3 * Math.pow(l0, 4) / Math.pow(lam, 4));
}

function round4(n) { return Math.round(n * 10000) / 10000; }

export default {
  name: "chromatic-dispersion",
  price: "$0.014",

  description:
    "Fiber optic chromatic dispersion calculator. Computes dispersion coefficient D(λ) in ps/(nm·km), accumulated dispersion (ps/nm) over a fiber span, and dispersion slope for SMF-28, NZDSF, DSF, LEAF, DCF, and ULLSF fiber types. Optionally sweeps a wavelength range (C-band, L-band, or custom). Pure math — instant, zero API calls. Useful for optical network design, DWDM link budget, and dispersion compensation planning.",

  inputSchema: {
    type: "object",
    properties: {
      fiber_type: {
        type: "string",
        enum: ["smf28", "nzdsf", "dsf", "leaf", "dcf", "ullsf"],
        description: "Fiber type. Default: 'smf28' (standard SMF-28, G.652D).",
      },
      wavelength_nm: {
        type: "number",
        description: "Operating wavelength in nanometers (default 1550). Range: 1260–1675 nm.",
      },
      fiber_length_km: {
        type: "number",
        description: "Fiber span length in km for accumulated dispersion calculation (default 80).",
      },
      sweep: {
        type: "object",
        description: "Optional wavelength sweep to compute dispersion across a range.",
        properties: {
          start_nm:  { type: "number", description: "Start wavelength (nm). Default 1530." },
          end_nm:    { type: "number", description: "End wavelength (nm). Default 1565 (C-band)." },
          step_nm:   { type: "number", description: "Step size (nm). Default 5." },
        },
      },
    },
    additionalProperties: false,
  },

  outputSchema: {
    type: "object",
    properties: {
      fiber_type:           { type: "string" },
      fiber_name:           { type: "string" },
      wavelength_nm:        { type: "number" },
      D_coefficient:        { type: "number", description: "Dispersion coefficient in ps/(nm·km)." },
      D_slope:              { type: "number", description: "Dispersion slope in ps/(nm²·km)." },
      accumulated_dispersion_ps_nm: { type: "number", description: "Total dispersion over span in ps/nm." },
      fiber_length_km:      { type: "number" },
      attenuation_dB:       { type: "number", description: "Estimated span attenuation in dB." },
      zero_dispersion_wavelength_nm: { type: "number" },
      sweep_results:        { type: "array",  description: "Per-wavelength results when sweep is requested." },
      generated_at:         { type: "string" },
    },
  },

  async handler(query) {
    const fiberKey = (query.fiber_type || "smf28").toLowerCase();
    if (!FIBER_TYPES[fiberKey]) {
      throw new Error(`unknown fiber_type '${fiberKey}' — valid: ${Object.keys(FIBER_TYPES).join(", ")}`);
    }
    const fiber = FIBER_TYPES[fiberKey];

    const lambda     = query.wavelength_nm   || 1550;
    const lengthKm   = query.fiber_length_km || 80;

    if (lambda < 1260 || lambda > 1675) throw new Error("wavelength_nm must be 1260–1675 nm");
    if (lengthKm <= 0)                  throw new Error("fiber_length_km must be positive");

    const D   = round4(calcDispersion(fiberKey, lambda));
    const S   = round4(calcSlope(fiberKey, lambda));
    const acc = round4(D * lengthKm);
    const att = round4(fiber.attenuation * lengthKm);

    const result = {
      fiber_type:           fiberKey,
      fiber_name:           fiber.name,
      wavelength_nm:        lambda,
      D_coefficient:        D,
      D_slope:              S,
      accumulated_dispersion_ps_nm: acc,
      fiber_length_km:      lengthKm,
      attenuation_dB:       att,
      aeff_um2:             fiber.aeff,
      zero_dispersion_wavelength_nm: fiber.lambda0,
    };

    // Optional sweep
    if (query.sweep) {
      const start = query.sweep.start_nm || 1530;
      const end   = query.sweep.end_nm   || 1565;
      const step  = query.sweep.step_nm  || 5;

      if (start >= end)  throw new Error("sweep start_nm must be < end_nm");
      if (step <= 0)     throw new Error("sweep step_nm must be positive");
      if ((end - start) / step > 500) throw new Error("sweep range too large (max 500 points)");

      const sweepResults = [];
      for (let wl = start; wl <= end + 0.001; wl += step) {
        const wlRound = Math.round(wl * 10) / 10;
        sweepResults.push({
          wavelength_nm: wlRound,
          D:             round4(calcDispersion(fiberKey, wlRound)),
          S:             round4(calcSlope(fiberKey, wlRound)),
          accumulated:   round4(calcDispersion(fiberKey, wlRound) * lengthKm),
        });
      }
      result.sweep_results = sweepResults;
    }

    result.generated_at = new Date().toISOString();
    return result;
  },
};
