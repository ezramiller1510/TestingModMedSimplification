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

function targetMatchNeedles(target) {
  return [target.name]
    .concat(target.aliases || [])
    .concat(target.procedureName ? [target.procedureName] : [])
    .concat(target.procedureAlias ? [target.procedureAlias] : [])
    .map(normalizeLabel)
    .filter(Boolean);
}

function targetMatchesText(target, text) {
  const hay = normalizeLabel(text);
  if (!hay) return false;
  return targetMatchNeedles(target).some(
    (n) => n && (hay === n || hay.includes(n) || n.includes(hay))
  );
}

function emptyMapping(target) {
  return {
    key: target.key,
    name: target.name,
    aliases: Array.isArray(target.aliases) ? target.aliases : [],
    protocolId: target.protocolId != null ? String(target.protocolId) : null,
    procedureCatalogId: target.procedureCatalogId != null ? String(target.procedureCatalogId) : null,
    procedureName: target.procedureName || null,
    procedureAlias: target.procedureAlias || null,
    procedureCatalogIds: target.procedureCatalogId ? [String(target.procedureCatalogId)] : [],
    procedures: [],
    diagnosisCatalogId: null,
    diagnosisName: null,
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

function createTrackedProtocol({ name, protocolId, aliases, procedureCatalogId }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) {
    throw new Error("Name is required.");
  }

  const id = protocolId != null && String(protocolId).trim() ? String(protocolId).trim() : null;
  const procId =
    procedureCatalogId != null && String(procedureCatalogId).trim()
      ? String(procedureCatalogId).trim()
      : null;

  return {
    key: slugifyKey(trimmedName),
    name: trimmedName,
    aliases: parseAliases(aliases),
    protocolId: id,
    procedureCatalogId: procId,
    procedureName: null,
    procedureAlias: null
  };
}
