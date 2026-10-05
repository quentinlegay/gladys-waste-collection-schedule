// -----------------------------------------------------------------------------
// Waste types.
//
// The `key` is FROZEN: it is part of the device external_id and of the config
// keys (`rule_<key>`), both stored in the user's Gladys. Never rename one.
//
// The 7 first types can be configured by hand (custom schedule). A provider
// may return more (e.g. Christmas trees): they are mapped through `aliases`
// (provider codes), or kept with their own code when unknown.
// -----------------------------------------------------------------------------

export const WASTE_TYPES = [
  {
    key: 'omr',
    label: { fr: 'Ordures ménagères', en: 'Household waste' },
    aliases: ['omr', 'om'],
    icon: 'trash-2',
  },
  {
    key: 'emb',
    label: { fr: 'Emballages (bac jaune)', en: 'Recycling (yellow bin)' },
    aliases: ['emb', 'cs', 'tri'],
    icon: 'refresh-cw',
  },
  {
    key: 'verre',
    label: { fr: 'Verre', en: 'Glass' },
    aliases: ['verre', 'glass'],
    icon: 'box',
  },
  {
    key: 'papier',
    label: { fr: 'Papiers', en: 'Paper' },
    aliases: ['papier', 'paper', 'jrm', 'newspaper'],
    icon: 'file-text',
  },
  {
    key: 'bio',
    label: { fr: 'Biodéchets', en: 'Food waste' },
    aliases: ['bio', 'alim', 'biodechets'],
    icon: 'feather',
  },
  {
    key: 'dv',
    label: { fr: 'Déchets verts', en: 'Garden waste' },
    aliases: ['dv', 'vert'],
    icon: 'wind',
  },
  {
    key: 'enc',
    label: { fr: 'Encombrants', en: 'Bulky waste' },
    aliases: ['enc', 'mobil'],
    icon: 'package',
  },
  {
    key: 'sapin',
    label: { fr: 'Sapins', en: 'Christmas trees' },
    aliases: ['sapin'],
    icon: 'gift',
    providerOnly: true,
  },
];

/** Types the user can describe by hand (one `rule_<key>` config field each). */
export const CUSTOM_WASTE_TYPES = WASTE_TYPES.filter((t) => !t.providerOnly);

/** Known type of a key or of a provider code; null when unknown. */
export function findWasteType(code) {
  const value = String(code ?? '').toLowerCase();
  return WASTE_TYPES.find((t) => t.key === value || t.aliases.includes(value)) ?? null;
}

/**
 * Normalized key of a provider code: the known type key, or the code itself
 * reduced to the characters allowed in an external_id.
 */
export function wasteKey(code) {
  const known = findWasteType(code);
  if (known) {
    return known.key;
  }
  return (
    String(code ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 32) || 'autre'
  );
}

/** Display name of a type key, with an optional provider-given fallback. */
export function wasteLabel(key, language = 'fr', fallback = null) {
  const known = findWasteType(key);
  if (known) {
    return known.label[language === 'en' ? 'en' : 'fr'];
  }
  return fallback || key.charAt(0).toUpperCase() + key.slice(1);
}
