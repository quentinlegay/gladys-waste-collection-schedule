import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CustomRuleError, parseCustomRule, parseExceptions } from '../src/customRules.js';
import { dayNumber, toIso } from '../src/dates.js';

const d = (iso) => dayNumber(...iso.split('-').map(Number));

/** Days of [from, from + count) matched by a rule. */
function days(rule, from = '2026-10-01', count = 31) {
  const match = parseCustomRule(rule);
  const out = [];
  for (let dn = d(from); dn < d(from) + count; dn += 1) {
    if (match(dn)) out.push(toIso(dn));
  }
  return out;
}

test('an empty rule means "not collected"', () => {
  assert.equal(parseCustomRule(''), null);
  assert.equal(parseCustomRule('   '), null);
  assert.equal(parseCustomRule(undefined), null);
});

test('a weekday, in French or English, any case, with or without accents', () => {
  const tuesdays = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'];
  assert.deepEqual(days('mardi'), tuesdays);
  assert.deepEqual(days('Mardi'), tuesdays);
  assert.deepEqual(days('le mardi'), tuesdays);
  assert.deepEqual(days('Tuesday'), tuesdays);
  assert.deepEqual(days('tous les mardis'), tuesdays);
  assert.deepEqual(days('every tuesday'), tuesdays);
});

test('several weekdays', () => {
  assert.deepEqual(days('lundi et jeudi', '2026-10-05', 7), ['2026-10-05', '2026-10-08']);
  assert.deepEqual(days('lun, jeu', '2026-10-05', 7), ['2026-10-05', '2026-10-08']);
  assert.deepEqual(days('monday and thursday', '2026-10-05', 7), ['2026-10-05', '2026-10-08']);
});

test('even and odd ISO weeks', () => {
  // Oct 12th, 2026 is in week 42.
  assert.deepEqual(days('lundi semaines paires'), ['2026-10-12', '2026-10-26']);
  assert.deepEqual(days('lundi en semaines impaires'), ['2026-10-05', '2026-10-19']);
  assert.deepEqual(days('monday odd weeks'), ['2026-10-05', '2026-10-19']);
  assert.deepEqual(days('Le lundi à partir de 11h en semaines paires'), [
    '2026-10-12',
    '2026-10-26',
  ]);
});

test('every N weeks from a reference date', () => {
  assert.deepEqual(days('vendredi toutes les 2 semaines depuis le 09/01/2026'), [
    '2026-10-02',
    '2026-10-16',
    '2026-10-30',
  ]);
  assert.deepEqual(days('every other friday from 2026-01-09'), [
    '2026-10-02',
    '2026-10-16',
    '2026-10-30',
  ]);
  assert.deepEqual(days('vendredi une semaine sur deux à partir du 2026-01-16'), [
    '2026-10-09',
    '2026-10-23',
  ]);
  assert.deepEqual(days('jeudi tous les 21 jours depuis 2026-10-01', '2026-10-01', 50), [
    '2026-10-01',
    '2026-10-22',
    '2026-11-12',
  ]);
  // Nothing before the reference date.
  assert.deepEqual(days('vendredi toutes les 2 semaines depuis le 16/10/2026'), [
    '2026-10-16',
    '2026-10-30',
  ]);
});

test('nth weekday of the month', () => {
  assert.deepEqual(days('1er et 3e mercredi', '2026-10-01', 61), [
    '2026-10-07',
    '2026-10-21',
    '2026-11-04',
    '2026-11-18',
  ]);
  assert.deepEqual(days('premier mercredi du mois', '2026-10-01', 61), [
    '2026-10-07',
    '2026-11-04',
  ]);
  assert.deepEqual(days('dernier vendredi', '2026-10-01', 61), ['2026-10-30', '2026-11-27']);
  assert.deepEqual(days('2nd tuesday of the month', '2026-10-01', 31), ['2026-10-13']);
});

test('months', () => {
  assert.deepEqual(days('mercredi de mars à novembre', '2026-11-20', 120), [
    '2026-11-25',
    '2027-03-03',
    '2027-03-10',
    '2027-03-17',
  ]);
  assert.deepEqual(days('dernier samedi d’avril à octobre', '2026-10-01', 250), [
    '2026-10-31',
    '2027-04-24',
    '2027-05-29',
  ]);
  assert.deepEqual(days('samedi en juillet et août', '2026-07-01', 70).length, 9);
  // A range across New Year.
  assert.deepEqual(days('lundi de novembre à février', '2027-02-20', 20), ['2027-02-22']);
});

test('bounds', () => {
  assert.deepEqual(days("mardi jusqu'au 13/10/2026"), ['2026-10-06', '2026-10-13']);
  assert.deepEqual(days('mardi à partir du 20/10/2026'), ['2026-10-20', '2026-10-27']);
});

test('explicit days, and several clauses', () => {
  assert.deepEqual(days('14/11/2026, 2026-12-12', '2026-11-01', 60), ['2026-11-14', '2026-12-12']);
  assert.deepEqual(days('mardi ; 2026-10-10', '2026-10-05', 7), ['2026-10-06', '2026-10-10']);
});

test('the OpenStreetMap syntax is accepted too', () => {
  assert.deepEqual(days('week 02-53/2 Mo'), ['2026-10-12', '2026-10-26']);
  assert.deepEqual(days('Tu; 2026 Oct 13 off'), ['2026-10-06', '2026-10-20', '2026-10-27']);
});

test('errors are explicit and bilingual', () => {
  const cases = [
    ['mardi poubelle', /Mot non compris : « poubelle »/],
    ['tous les 10 jours lundi', /multiple de 7/],
    ['vendredi toutes les 2 semaines', /date de référence/],
    ['semaines paires', /Jour de la semaine manquant/],
    ['lundi semaines paires et impaires', /paires ET impaires/],
    ['lundi 2026-10-12', /règle à part/],
    ['31/02/2026', /Mot non compris|Date invalide/],
  ];
  for (const [rule, expected] of cases) {
    assert.throws(
      () => parseCustomRule(rule),
      (err) => {
        assert.ok(err instanceof CustomRuleError, rule);
        assert.match(err.messages.fr, expected, rule);
        assert.ok(err.messages.en.length > 0);
        assert.ok(err.messages.fr.includes(rule), 'the message quotes the faulty rule');
        return true;
      },
    );
  }
});

test('exceptions: move, cancel, add, per type or for all', () => {
  assert.deepEqual(
    parseExceptions('omr: 2026-12-25 > 2026-12-26 ; emb: -01/01/2027 ; +2026-12-31'),
    [
      { type: 'omr', remove: d('2026-12-25'), add: d('2026-12-26') },
      { type: 'emb', remove: d('2027-01-01'), add: null },
      { type: null, remove: null, add: d('2026-12-31') },
    ],
  );
  assert.deepEqual(parseExceptions('Verre: 2026-12-25 -> 2026-12-24'), [
    { type: 'verre', remove: d('2026-12-25'), add: d('2026-12-24') },
  ]);
  assert.deepEqual(parseExceptions('paper: +2026-12-31'), [
    { type: 'papier', remove: null, add: d('2026-12-31') },
  ]);
  assert.deepEqual(parseExceptions(''), []);
});

test('exceptions: errors', () => {
  assert.throws(() => parseExceptions('2026-12-25'), /not understood/); // no operation
  assert.throws(() => parseExceptions('poubelle: -2026-12-25'), /Unknown waste type/);
  assert.throws(() => parseExceptions('-2026-13-01'), /not understood/);
});
