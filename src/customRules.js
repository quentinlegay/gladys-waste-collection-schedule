// -----------------------------------------------------------------------------
// Custom schedule: a plain-language rule per waste type, typed in the config.
//
// Examples (French or English, accents and case ignored):
//   "mardi"                                   every Tuesday
//   "lundi et jeudi"                          twice a week
//   "lundi semaines paires"                   Monday of even ISO weeks
//   "jeudi semaines impaires"                 Thursday of odd ISO weeks
//   "vendredi toutes les 2 semaines depuis le 09/01/2026"
//   "1er et 3e mercredi"                      of every month
//   "dernier samedi d'avril a octobre"
//   "mercredi de mars a novembre"
//   "2026-11-14, 2026-12-12"                  explicit days
//   "every other Tuesday from 2026-01-06"
// Several rules are separated by ";" ("mardi ; 1er samedi").
// Power users may also write the OpenStreetMap `opening_hours` syntax used by
// the providers ("week 02-53/2 Mo").
//
// Manual exceptions (one list for all types):
//   "omr: 2026-12-25 > 2026-12-26 ; emb: -2027-01-01 ; verre: +2026-12-31"
// -----------------------------------------------------------------------------

import { isoWeek, mondayOf, parseDate, toParts, weekday, daysInMonth } from './dates.js';
import { OpeningHoursError, isOpen, parseOpeningHours } from './openingHours.js';
import { findWasteType } from './wasteTypes.js';

export class CustomRuleError extends Error {
  /** @param {{ fr: string, en: string }} message */
  constructor(message) {
    super(message.en);
    this.messages = message;
  }
}

const WEEKDAY_WORDS = [
  ['lundi', 'lundis', 'lun', 'monday', 'mondays', 'mon'],
  ['mardi', 'mardis', 'mar', 'tuesday', 'tuesdays', 'tue', 'tues'],
  ['mercredi', 'mercredis', 'mer', 'wednesday', 'wednesdays', 'wed'],
  ['jeudi', 'jeudis', 'jeu', 'thursday', 'thursdays', 'thu', 'thur', 'thurs'],
  ['vendredi', 'vendredis', 'ven', 'friday', 'fridays', 'fri'],
  ['samedi', 'samedis', 'sam', 'saturday', 'saturdays', 'sat'],
  ['dimanche', 'dimanches', 'dim', 'sunday', 'sundays', 'sun'],
];

// Full names only: "mar" is Tuesday (mardi), never March.
const MONTH_WORDS = [
  ['janvier', 'january'],
  ['fevrier', 'february'],
  ['mars', 'march'],
  ['avril', 'april'],
  ['mai', 'may'],
  ['juin', 'june'],
  ['juillet', 'july'],
  ['aout', 'august'],
  ['septembre', 'september'],
  ['octobre', 'october'],
  ['novembre', 'november'],
  ['decembre', 'december'],
];

const ORDINAL_WORDS = {
  premier: 1,
  premiere: 1,
  first: 1,
  deuxieme: 2,
  second: 2,
  seconde: 2,
  troisieme: 3,
  third: 3,
  quatrieme: 4,
  fourth: 4,
  cinquieme: 5,
  fifth: 5,
  dernier: -1,
  derniere: -1,
  last: -1,
};

// Words that carry no meaning of their own in a rule.
const FILLER = new Set(
  (
    'et and le la les l du de des d mois month months of the chaque each every tous toutes ' +
    'semaine semaines week weeks on a au aux en in sur par collecte collectes ramassage le ' +
    'jour jours day days matin soir midi apres morning evening afternoon passage'
  ).split(' '),
);

const DATE = String.raw`(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.]\d{1,2}[/.]\d{4})`;
const MONTH = `(${MONTH_WORDS.flat().join('|')})`;

const monthIndex = (word) => MONTH_WORDS.findIndex((names) => names.includes(word)) + 1;

function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function error(fr, en) {
  return new CustomRuleError({ fr, en });
}

/** Looks like the OSM syntax ("Mo", "week 02-53/2", "Jan")? Case-sensitive. */
function looksLikeOpeningHours(clause) {
  return /\b(Mo|Tu|We|Th|Fr|Sa|Su|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|^week\b/.test(
    clause,
  );
}

/**
 * Parse ONE clause of plain language into a day matcher.
 * @returns {(dn: number) => boolean}
 */
function parseClause(clause) {
  let s = ` ${normalize(clause)} `;
  const take = (re) => {
    const found = [];
    s = s.replace(re, (...args) => {
      found.push(args);
      return ' ';
    });
    return found;
  };

  // Times are irrelevant for a collection day: "a partir de 11h", "dès 4h30",
  // "at 6:00", "7am" (copied as is from a collection service website).
  take(
    /(?:\b(?:a partir de|des|from|at|vers|avant|before)\s+)?\b\d{1,2}\s*(?:h\s*\d{0,2}|:\d{2}|am|pm)\b(?:\s*(?:am|pm)\b)?/g,
  );

  // Interval: "toutes les 2 semaines", "tous les 15 jours", "une semaine sur deux"
  let interval = null;
  for (const [, n] of take(/\b(?:toutes? les|tous les|every)\s+(\d+)\s*(?:semaines?|weeks?)\b/g)) {
    interval = Number(n);
  }
  for (const [, n] of take(/\b(?:tous les|every)\s+(\d+)\s*(?:jours|days)\b/g)) {
    if (Number(n) % 7 !== 0) {
      throw error(
        `« tous les ${n} jours » : seul un multiple de 7 jours est possible.`,
        `"every ${n} days": only a multiple of 7 days is supported.`,
      );
    }
    interval = Number(n) / 7;
  }
  if (take(/\b(?:une semaine sur (?:deux|2)|every other week|every second week)\b/g).length) {
    interval = 2;
  }
  if (take(/\bevery other\b/g).length) {
    interval = 2;
  }

  // ISO week parity ("impaires" first: it contains "paires").
  let parity = null;
  if (take(/\bsemaines? impaires?\b|\bodd weeks?\b|\bimpaires?\b/g).length) {
    parity = 1;
  }
  if (take(/\bsemaines? paires?\b|\beven weeks?\b|\bpaires?\b/g).length) {
    parity = parity === null ? 0 : 'both';
  }

  // Bounds: "depuis le 09/01/2026", "jusqu'au 2027-06-30".
  let start = null;
  let end = null;
  const startRe = new RegExp(
    String.raw`\b(?:depuis|a partir|a compter|from|since|starting)(?: on| du| de| le| the)*\s+${DATE}`,
    'g',
  );
  for (const [, date] of take(startRe)) {
    start = parseDate(date);
  }
  const endRe = new RegExp(
    String.raw`\b(?:jusqu' ?(?:au|a)|until|till|through)(?: le| the)*\s+${DATE}`,
    'g',
  );
  for (const [, date] of take(endRe)) {
    end = parseDate(date);
  }

  // Months: "de mars a novembre", "from March to November", "en juillet et aout".
  let months = null;
  const rangeRe = new RegExp(
    String.raw`\b(?:de|d'|du mois de|from|between)?\s*${MONTH}\s+(?:a|au|to|and|-|jusqu' ?(?:a|en))\s+${MONTH}\b`,
    'g',
  );
  for (const [, from, to] of take(rangeRe)) {
    months ??= new Set();
    const a = monthIndex(from);
    const b = monthIndex(to);
    for (let m = a; ; m = (m % 12) + 1) {
      months.add(m);
      if (m === b) break;
    }
  }
  for (const [, word] of take(new RegExp(String.raw`\b${MONTH}\b`, 'g'))) {
    months ??= new Set();
    months.add(monthIndex(word));
  }

  // Explicit days.
  const dates = take(new RegExp(String.raw`(?:^|\s|,)${DATE}(?=$|\s|,)`, 'g')).map(([, d]) =>
    parseDate(d),
  );
  if (dates.some((d) => d === null)) {
    throw error('Date invalide.', 'Invalid date.');
  }

  // Ordinals: "1er", "3e", "2nd", "premier", "dernier".
  const nth = [];
  for (const [, n] of take(/\b([1-5])\s*(?:er|ere|re|e|eme|ieme|st|nd|rd|th)?\b/g)) {
    nth.push(Number(n));
  }
  const ordinalRe = new RegExp(`\\b(${Object.keys(ORDINAL_WORDS).join('|')})s?\\b`, 'g');
  for (const [, word] of take(ordinalRe)) {
    nth.push(ORDINAL_WORDS[word]);
  }

  // Weekdays.
  const weekdays = new Set();
  WEEKDAY_WORDS.forEach((words, index) => {
    if (take(new RegExp(`\\b(${words.join('|')})\\.?(?=[\\s,.]|$)`, 'g')).length) {
      weekdays.add(index);
    }
  });

  const leftover = s
    .split(/[\s,.'’]+/)
    .filter(Boolean)
    .filter((word) => !FILLER.has(word));
  if (leftover.length) {
    throw error(
      `Mot non compris : « ${leftover.join(' ')} ».`,
      `Unknown word: "${leftover.join(' ')}".`,
    );
  }
  if (parity === 'both') {
    throw error(
      'Semaines paires ET impaires : retirez la précision.',
      'Even AND odd weeks: remove the qualifier.',
    );
  }
  if (dates.length) {
    if (weekdays.size || nth.length || interval || parity !== null) {
      throw error(
        'Les dates précises vont dans une règle à part (séparée par « ; »).',
        'Explicit dates go in a rule of their own (separated by ";").',
      );
    }
    const set = new Set(dates);
    return (dn) => set.has(dn);
  }
  if (!weekdays.size) {
    throw error(
      'Jour de la semaine manquant (ex. « mardi »).',
      'Missing day of the week (e.g. "tuesday").',
    );
  }
  if (interval !== null && parity !== null) {
    throw error(
      'Choisissez « toutes les N semaines » OU « semaines paires/impaires ».',
      'Choose "every N weeks" OR "even/odd weeks".',
    );
  }
  if (interval !== null && (interval < 1 || interval > 52)) {
    throw error('Intervalle de semaines invalide.', 'Invalid week interval.');
  }
  if (interval > 1 && start === null) {
    throw error(
      'Indiquez une date de référence : « toutes les 2 semaines depuis le 09/01/2026 ».',
      'Give a reference date: "every 2 weeks from 2026-01-09".',
    );
  }

  const refMonday = start === null ? null : mondayOf(start);
  return (dn) => {
    if (!weekdays.has(weekday(dn))) return false;
    if (start !== null && dn < start) return false;
    if (end !== null && dn > end) return false;
    const { year, month, day } = toParts(dn);
    if (months && !months.has(month)) return false;
    if (parity !== null && isoWeek(dn) % 2 !== parity) return false;
    if (interval > 1 && ((mondayOf(dn) - refMonday) / 7) % interval !== 0) return false;
    if (nth.length) {
      const n = Math.ceil(day / 7);
      const fromEnd = -(Math.floor((daysInMonth(year, month) - day) / 7) + 1);
      if (!nth.includes(n) && !nth.includes(fromEnd)) return false;
    }
    return true;
  };
}

/**
 * Parse the rule of a waste type.
 * @param {string} text
 * @returns {((dn: number) => boolean) | null} null when the rule is empty
 * @throws {CustomRuleError}
 */
export function parseCustomRule(text) {
  const clauses = String(text ?? '')
    .split(/[;\n]/)
    .map((c) => c.trim())
    .filter(Boolean);
  if (!clauses.length) {
    return null;
  }
  // All OSM: parse the value as a whole, so that a later "off" rule closes
  // what the earlier rules opened ("Tu; 2026 Jul 14 off").
  if (clauses.every(looksLikeOpeningHours)) {
    try {
      const rules = parseOpeningHours(clauses.join(';'));
      return (dn) => isOpen(rules, dn);
    } catch (err) {
      if (!(err instanceof OpeningHoursError)) throw err;
    }
  }
  const matchers = clauses.map((clause) => {
    if (looksLikeOpeningHours(clause)) {
      try {
        const rules = parseOpeningHours(clause);
        return (dn) => isOpen(rules, dn);
      } catch (err) {
        if (!(err instanceof OpeningHoursError)) throw err;
        // Not OSM after all: try plain language below.
      }
    }
    try {
      return parseClause(clause);
    } catch (err) {
      if (err instanceof CustomRuleError) {
        throw new CustomRuleError({
          fr: `« ${clause} » : ${err.messages.fr}`,
          en: `"${clause}": ${err.messages.en}`,
        });
      }
      throw err;
    }
  });
  return (dn) => matchers.some((match) => match(dn));
}

/**
 * Parse the manual exceptions.
 * @param {string} text e.g. "omr: 2026-12-25 > 2026-12-26 ; -2027-01-01"
 * @returns {{ type: string|null, remove: number|null, add: number|null }[]}
 *   `type` null = every waste type
 * @throws {CustomRuleError}
 */
export function parseExceptions(text) {
  const entries = String(text ?? '')
    .split(/[;\n]/)
    .map((e) => e.trim())
    .filter(Boolean);
  const re = new RegExp(
    String.raw`^(?:([a-z_-]+)\s*:\s*)?([+-])?\s*${DATE}(?:\s*(?:>|->|=>|→)\s*${DATE})?$`,
  );
  return entries.map((entry) => {
    const match = re.exec(normalize(entry));
    const fail = () =>
      error(
        `Exception « ${entry} » non comprise. Formats : « 2026-12-25 > 2026-12-26 », « -2027-01-01 », « +2026-12-31 », précédés éventuellement du type (« omr: »).`,
        `Exception "${entry}" not understood. Formats: "2026-12-25 > 2026-12-26", "-2027-01-01", "+2026-12-31", optionally prefixed with the type ("omr:").`,
      );
    if (!match) throw fail();
    const [, typeWord, sign, first, second] = match;
    let type = null;
    if (typeWord && !['tout', 'tous', 'all', '*'].includes(typeWord)) {
      const known = findWasteType(typeWord);
      if (!known) {
        throw error(
          `Type de déchet inconnu : « ${typeWord} ».`,
          `Unknown waste type: "${typeWord}".`,
        );
      }
      type = known.key;
    }
    const a = parseDate(first);
    const b = second ? parseDate(second) : null;
    if (a === null || (second && b === null)) throw fail();
    if (second) {
      if (sign) throw fail();
      return { type, remove: a, add: b };
    }
    if (sign === '-') return { type, remove: a, add: null };
    if (sign === '+') return { type, remove: null, add: a };
    throw fail();
  });
}
