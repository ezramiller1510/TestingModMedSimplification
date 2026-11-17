// Shared target list: apply uses protocolId; detect uses catalog IDs from visit overview.
var PROTOCOL_TARGETS = [
  {
    key: "visual-field",
    name: "Visual Field",
    aliases: ["visual field", "visual fields", "vf", "hvfonline", "humphrey"]
  },
  {
    key: "optos",
    name: "Optos",
    aliases: ["optos"]
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
      "glaucoma tests"
    ]
  },
  {
    key: "anterior-segment",
    name: "Anterior Segment",
    aliases: ["anterior segment", "as-oct", "as oct"]
  },
  {
    key: "retina",
    name: "Retina",
    aliases: ["retina", "macular oct", "oct macula", "oct, retina"]
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
    diagnosisCatalogId: null,
    diagnosisName: null,
    procedureCatalogIds: [],
    procedures: [],
    sources: [],
    updatedAt: null
  };
}
