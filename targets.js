// Shared target list:
// - protocolId = apply (POST /protocols)
// - procedureCatalogId(s) = detect (visit overview procedures)
// Detect is procedure-based on purpose: diagnoses like special-test buckets can group
// multiple imaging tests (e.g. Optos vs Anterior Segment) under one diagnosis.
var PROTOCOL_TARGETS = [
  {
    key: "visual-field",
    name: "Visual Field",
    aliases: ["visual field", "visual fields", "hvfonline", "humphrey visual"]
  },
  {
    key: "optos",
    name: "Optos",
    aliases: ["optos", "optomap"]
  },
  {
    key: "cct",
    name: "CCT",
    aliases: ["cct", "central corneal thickness", "pachymetry"]
  },
  {
    key: "optic-nerve",
    name: "Optic Nerve",
    aliases: [
      "optic nerve",
      "oct, optic nerve",
      "oct optic nerve",
      "optic nerve topography",
      "opticnervetopography"
    ]
  },
  {
    key: "anterior-segment",
    name: "Anterior Segment",
    aliases: ["anterior segment", "as-oct", "as oct", "anterior oct"]
  },
  {
    key: "retina",
    name: "Retina",
    aliases: ["retina", "macular oct", "oct macula", "oct, retina", "oct retina"]
  }
];

function normalizeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function targetMatchesText(target, text) {
  const hay = normalizeLabel(text);
  if (!hay) return false;
  const needles = [target.name].concat(target.aliases || []).map(normalizeLabel);
  return needles.some((n) => n && (hay === n || hay.includes(n) || n.includes(hay)));
}

function emptyMapping(target) {
  return {
    key: target.key,
    name: target.name,
    protocolId: null,
    // Primary detect key
    procedureCatalogId: null,
    procedureName: null,
    procedureAlias: null,
    // Extra matched procedures for the same target, if any
    procedureCatalogIds: [],
    procedures: [],
    // Diagnosis kept only as context, not used for detect
    diagnosisCatalogId: null,
    diagnosisName: null,
    sources: [],
    updatedAt: null
  };
}
