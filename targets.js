// Helpers for user-defined tracked protocols.
// - protocolId = apply (POST /protocols)
// - procedureCatalogId = detect (visit overview procedure)
// Targets are stored in chrome.storage.local.trackedProtocols (not hardcoded).

function normalizeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugifyKey(name) {
  const base = normalizeLabel(name).replace(/\s+/g, "-") || "protocol";
  return `${base}-${Date.now().toString(36)}`;
}

// Canonicalize common ophthalmology wording so "OCT Mac/Retina" can match
// ModMed names like "OCT, Retina" / "OCT Macula".
function canonicalizeToken(token) {
  const t = String(token || "").toLowerCase();
  if (!t) return "";
  if (["mac", "macula", "macular"].includes(t)) return "macula";
  if (["retina", "retinal", "retin"].includes(t)) return "retina";
  if (["optic", "onh"].includes(t)) return "optic";
  if (["nerve", "rnfl"].includes(t)) return "nerve";
  if (["anterior", "as"].includes(t)) return "anterior";
  if (["segment", "seg"].includes(t)) return "segment";
  if (["field", "fields", "vf", "hvf"].includes(t)) return "field";
  if (["visual"].includes(t)) return "visual";
  if (["cct", "pachymetry", "pach"].includes(t)) return "cct";
  if (["optos", "optomap"].includes(t)) return "optos";
  if (["oct"].includes(t)) return "oct";
  return t;
}

function labelTokens(value) {
  return normalizeLabel(value)
    .split(/\s+/)
    .map(canonicalizeToken)
    .filter((t) => t && t.length >= 2);
}

function uniqueTokens(tokens) {
  return [...new Set(tokens)];
}

function tokensOverlap(aTokens, bTokens) {
  const a = uniqueTokens(aTokens);
  const b = uniqueTokens(bTokens);
  if (!a.length || !b.length) return false;

  const bSet = new Set(b);
  const aSet = new Set(a);
  const shared = a.filter((t) => bSet.has(t));

  // Exact / containment-style token match:
  // all tokens of the shorter label appear in the longer one.
  const [shorter, longerSet] =
    a.length <= b.length ? [a, bSet] : [b, aSet];
  if (shorter.every((t) => longerSet.has(t))) return true;

  // Strong partial overlap (handles OCT Mac/Retina vs OCT Retina).
  if (shared.length >= 2) return true;

  // Anterior Segment vs AS-OCT / Anterior OCT
  if (
    shared.includes("anterior") &&
    (a.includes("segment") || b.includes("segment") || a.includes("oct") || b.includes("oct"))
  ) {
    return true;
  }

  // Single strong technical token match only when both sides are short
  // (e.g. "optos" vs "optos imaging"), not broad words alone.
  if (shared.length === 1 && shorter.length === 1) {
    const only = shared[0];
    if (["oct", "optos", "cct", "field"].includes(only)) return true;
  }

  return false;
}

function labelsLooselyMatch(a, b) {
  const left = normalizeLabel(a);
  const right = normalizeLabel(b);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  return tokensOverlap(labelTokens(left), labelTokens(right));
}

function targetMatchNeedles(target) {
  return [target.name]
    .concat(target.aliases || [])
    .concat(target.procedureName ? [target.procedureName] : [])
    .concat(target.procedureAlias ? [target.procedureAlias] : [])
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

function targetMatchesText(target, text) {
  const hay = String(text || "").trim();
  if (!hay) return false;
  return targetMatchNeedles(target).some((n) => labelsLooselyMatch(n, hay));
}

function emptyMapping(target) {
  return {
    key: target.key,
    name: target.name,
    aliases: Array.isArray(target.aliases) ? target.aliases : [],
    protocolId: target.protocolId != null ? String(target.protocolId) : null,
    // Detect / delete keys:
    // - procedureCatalogId: which test (Optos vs CCT)
    // - diagnosisCatalogId: which diagnosis bucket that test lives under
    //   (e.g. different "All Tests" diagnosis ids per test type)
    procedureCatalogId: target.procedureCatalogId != null ? String(target.procedureCatalogId) : null,
    procedureName: target.procedureName || null,
    procedureAlias: target.procedureAlias || null,
    procedureCatalogIds: target.procedureCatalogId ? [String(target.procedureCatalogId)] : [],
    procedures: [],
    diagnosisCatalogId: target.diagnosisCatalogId != null ? String(target.diagnosisCatalogId) : null,
    diagnosisName: target.diagnosisName || null,
    sources: [],
    updatedAt: null
  };
}

function parseAliases(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((a) => String(a).trim()).filter(Boolean);
  return String(raw)
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

function createTrackedProtocol({ name, protocolId, aliases, procedureCatalogId, diagnosisCatalogId }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    throw new Error("Name is required.");
  }

  const id = protocolId != null && String(protocolId).trim() ? String(protocolId).trim() : null;
  const procId =
    procedureCatalogId != null && String(procedureCatalogId).trim()
      ? String(procedureCatalogId).trim()
      : null;
  const dxId =
    diagnosisCatalogId != null && String(diagnosisCatalogId).trim()
      ? String(diagnosisCatalogId).trim()
      : null;

  return {
    key: slugifyKey(trimmedName),
    name: trimmedName,
    aliases: parseAliases(aliases),
    protocolId: id,
    procedureCatalogId: procId,
    diagnosisCatalogId: dxId,
    procedureName: null,
    procedureAlias: null,
    diagnosisName: null
  };
}
