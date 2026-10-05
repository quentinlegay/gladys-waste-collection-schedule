// -----------------------------------------------------------------------------
// Day matcher for the OpenStreetMap `opening_hours` syntax.
//
// Publidata describes every collection with this syntax, e.g.
//   "Tu 11:00-23:59"                                    every Tuesday
//   "2024 Mar 11-2030 Dec 30 week 02-53/2 Mo 11:00-23:59" Monday of even weeks
//   "2026 Jul 14 off"                                    no collection that day
//   "Feb,May,Aug,Nov Th[4] 05:00-12:00"                  4th Thursday of these months
//   "2025 Jan 17,2026 Jan 16 06:00-23:59"                explicit days
// A collection is a DAY: the times are ignored. Only the day selectors are
// supported (years, dates and date ranges, months, ISO weeks, weekdays with an
// optional [nth] of the month, days of the month). Anything else (PH, SH,
// easter, offsets…) throws, so the caller can skip that one schedule loudly
// instead of guessing.
//
// The same parser is offered to power users in the custom schedule.
// -----------------------------------------------------------------------------

import { daysInMonth, isoWeek, toParts, weekday } from './dates.js';

export class OpeningHoursError extends Error {}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const TIME_SPANS =
  /\b\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2}\+?)?(?:\s*,\s*\d{1,2}:\d{2}(?:\s*-\s*\d{1,2}:\d{2}\+?)?)*/g;

function tokenize(text) {
  const tokens = [];
  const re = /\s+|(\d+)|([A-Za-z]+)|([-,/:[\]])/y;
  let match;
  while (re.lastIndex < text.length) {
    const start = re.lastIndex;
    match = re.exec(text);
    if (!match) {
      throw new OpeningHoursError(`unexpected character "${text[start]}" in "${text}"`);
    }
    if (match[1] !== undefined) {
      tokens.push({ type: 'num', value: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({ type: 'word', value: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ type: 'sym', value: match[3] });
    }
  }
  return tokens;
}

class Parser {
  constructor(tokens, source) {
    this.tokens = tokens;
    this.i = 0;
    this.source = source;
  }

  peek(offset = 0) {
    return this.tokens[this.i + offset];
  }

  next() {
    return this.tokens[this.i++];
  }

  fail(message) {
    throw new OpeningHoursError(`${message} in "${this.source}"`);
  }

  isSym(value, offset = 0) {
    const t = this.peek(offset);
    return t?.type === 'sym' && t.value === value;
  }

  isYear(offset = 0) {
    const t = this.peek(offset);
    return t?.type === 'num' && t.value.length === 4;
  }

  isMonth(offset = 0) {
    const t = this.peek(offset);
    return t?.type === 'word' && MONTHS.includes(t.value);
  }

  isWeekday(offset = 0) {
    const t = this.peek(offset);
    return t?.type === 'word' && WEEKDAYS.includes(t.value);
  }

  isSmallNumber(offset = 0) {
    const t = this.peek(offset);
    return t?.type === 'num' && t.value.length <= 2;
  }

  number() {
    const t = this.next();
    if (t?.type !== 'num') {
      this.fail('number expected');
    }
    return Number(t.value);
  }

  // year ("-" year)? ("/" step)? ("," ...)*
  years() {
    const items = [];
    do {
      if (items.length) this.next(); // ','
      const from = this.number();
      let to = from;
      let step = 1;
      if (this.isSym('-') && this.isYear(1)) {
        this.next();
        to = this.number();
      }
      if (this.isSym('/')) {
        this.next();
        step = this.number();
      }
      items.push({ from, to, step });
    } while (this.isSym(',') && this.isYear(1) && !this.isMonth(2));
    return items;
  }

  // [year] month [day]
  datePoint(requireMonth) {
    const point = {};
    if (this.isYear()) {
      point.year = this.number();
    }
    if (this.isMonth()) {
      point.month = MONTHS.indexOf(this.next().value) + 1;
    } else if (requireMonth) {
      this.fail('month expected');
    }
    if (this.isSmallNumber()) {
      point.day = this.number();
    }
    if (point.year === undefined && point.month === undefined && point.day === undefined) {
      this.fail('date expected');
    }
    return point;
  }

  // item ("," item)*, item = point ("-" point)?
  dates() {
    const items = [];
    let lastYear;
    do {
      if (items.length) this.next(); // ','
      const from = this.datePoint(true);
      // "2025 Jan,Apr,Jul": a year written once applies to the next months.
      if (from.year === undefined) {
        from.year = lastYear;
      }
      lastYear = from.year;
      let to = null;
      if (this.isSym('-')) {
        this.next();
        to = this.datePoint(false);
      }
      items.push({ from, to });
    } while (this.isSym(',') && (this.isMonth(1) || (this.isYear(1) && this.isMonth(2))));
    return items;
  }

  // "week" n ("-" n ("/" step)?)? ("," ...)*
  weeks() {
    this.next(); // 'week'
    const weeks = new Set();
    do {
      if (weeks.size) this.next(); // ','
      const from = this.number();
      let to = from;
      let step = 1;
      if (this.isSym('-')) {
        this.next();
        to = this.number();
        if (this.isSym('/')) {
          this.next();
          step = this.number();
        }
      }
      if (from < 1 || to > 53 || step < 1) {
        this.fail('invalid week range');
      }
      for (let w = from; w <= to; w += step) weeks.add(w);
    } while (this.isSym(',') && this.isSmallNumber(1));
    return weeks;
  }

  // Wd ("-" Wd)? ("[" nth ("," nth)* "]")? ("," ...)*
  weekdays() {
    const items = [];
    do {
      if (items.length) this.next(); // ','
      const from = WEEKDAYS.indexOf(this.next().value);
      let to = from;
      if (this.isSym('-') && this.isWeekday(1)) {
        this.next();
        to = WEEKDAYS.indexOf(this.next().value);
      }
      let nth = null;
      if (this.isSym('[')) {
        this.next();
        nth = [];
        while (!this.isSym(']')) {
          if (this.isSym(',')) {
            this.next();
            continue;
          }
          const negative = this.isSym('-');
          if (negative) this.next();
          const n = this.number();
          if (!negative && this.isSym('-')) {
            this.next();
            const end = this.number();
            for (let k = n; k <= end; k += 1) nth.push(k);
          } else {
            nth.push(negative ? -n : n);
          }
          if (this.i >= this.tokens.length) this.fail('"]" expected');
        }
        this.next(); // ']'
      }
      items.push({ from, to, nth });
    } while (this.isSym(',') && this.isWeekday(1));
    return items;
  }

  // n ("-" n)? ("," ...)*  — days of the month (lenient, not in the OSM spec)
  monthdays() {
    const days = new Set();
    do {
      if (days.size) this.next(); // ','
      const from = this.number();
      let to = from;
      if (this.isSym('-') && this.isSmallNumber(1)) {
        this.next();
        to = this.number();
      }
      for (let d = from; d <= to; d += 1) days.add(d);
    } while (this.isSym(',') && this.isSmallNumber(1));
    return days;
  }

  selectors() {
    const sel = { years: null, dates: null, weeks: null, weekdays: null, monthdays: null };
    while (this.i < this.tokens.length) {
      const t = this.peek();
      if (this.isSym(':') || this.isSym(',')) {
        this.next(); // "Dec: We" / "Jan, Mo" separators
      } else if (this.isYear() && this.isMonth(1)) {
        // "2025 Jan 17", "2025 Jan,Apr": a dated selector. A year NOT followed
        // by a month ("2024-2025 Dec", "2024,2025 week 1") is a year selector.
        sel.dates = this.dates();
      } else if (this.isYear()) {
        sel.years = this.years();
      } else if (this.isMonth()) {
        sel.dates = this.dates();
      } else if (t.type === 'word' && t.value === 'week') {
        sel.weeks = this.weeks();
      } else if (this.isWeekday()) {
        sel.weekdays = this.weekdays();
      } else if (this.isSmallNumber()) {
        sel.monthdays = this.monthdays();
      } else {
        this.fail(`unsupported "${t.value}"`);
      }
    }
    return sel;
  }
}

function matchDateItem(item, year, month, day) {
  const { from, to } = item;
  if (!to) {
    return (
      (from.year === undefined || from.year === year) &&
      from.month === month &&
      (from.day === undefined || from.day === day)
    );
  }
  const toYear = to.year ?? from.year;
  const toMonth = to.month ?? from.month;
  const fromDay = from.day ?? 1;
  if (from.year !== undefined) {
    const start = [from.year, from.month, fromDay];
    const end = [toYear, toMonth, to.day ?? daysInMonth(toYear, toMonth)];
    const key = (y, m, d) => y * 10000 + m * 100 + d;
    const k = key(year, month, day);
    return k >= key(...start) && k <= key(...end);
  }
  // Recurring every year, possibly across New Year ("Nov 15-Feb 15").
  const k = month * 100 + day;
  const start = from.month * 100 + fromDay;
  const end = toMonth * 100 + (to.day ?? 31);
  return start <= end ? k >= start && k <= end : k >= start || k <= end;
}

function matchWeekday(item, dn, day, month, year) {
  const wd = weekday(dn);
  const inRange =
    item.from <= item.to ? wd >= item.from && wd <= item.to : wd >= item.from || wd <= item.to;
  if (!inRange) {
    return false;
  }
  if (!item.nth) {
    return true;
  }
  const n = Math.ceil(day / 7);
  const fromEnd = -(Math.floor((daysInMonth(year, month) - day) / 7) + 1);
  return item.nth.includes(n) || item.nth.includes(fromEnd);
}

function compileSelectors(sel) {
  return (dn) => {
    const { year, month, day } = toParts(dn);
    if (
      sel.years &&
      !sel.years.some((y) => year >= y.from && year <= y.to && (year - y.from) % y.step === 0)
    ) {
      return false;
    }
    if (sel.dates && !sel.dates.some((item) => matchDateItem(item, year, month, day))) {
      return false;
    }
    if (sel.weeks && !sel.weeks.has(isoWeek(dn))) {
      return false;
    }
    if (sel.weekdays && !sel.weekdays.some((item) => matchWeekday(item, dn, day, month, year))) {
      return false;
    }
    if (sel.monthdays && !sel.monthdays.has(day)) {
      return false;
    }
    return true;
  };
}

/**
 * Parse an `opening_hours` value into its rules.
 * @param {string} text
 * @returns {{ off: boolean, match: (dn: number) => boolean }[]}
 * @throws {OpeningHoursError} on an unsupported or invalid syntax
 */
export function parseOpeningHours(text) {
  const source = String(text ?? '');
  const rules = source
    .replace(/"[^"]*"/g, ' ') // comments
    .split(/;|\|\|/)
    .map((rule) => rule.trim())
    .filter(Boolean);
  if (!rules.length) {
    throw new OpeningHoursError('empty rule');
  }
  return rules.map((rule) => {
    let body = rule;
    const off = /\b(off|closed)\b/.test(body);
    body = body
      .replace(/\b(off|closed|open|unknown)\b/g, ' ')
      .replace(/\b24\/7\b/g, ' ')
      .replace(TIME_SPANS, ' ')
      .trim();
    const parser = new Parser(tokenize(body), source);
    return { off, match: compileSelectors(parser.selectors()) };
  });
}

/**
 * Whether a day is "open" for a whole `opening_hours` value: a later `off`
 * rule closes the days it matches, as in the OSM evaluation order.
 * @param {ReturnType<typeof parseOpeningHours>} rules
 */
export function isOpen(rules, dn) {
  let open = false;
  for (const rule of rules) {
    if (rule.match(dn)) {
      open = !rule.off;
    }
  }
  return open;
}

/** Whether ANY rule (open or off) selects that day. */
export function isSelected(rules, dn) {
  return rules.some((rule) => rule.match(dn));
}
