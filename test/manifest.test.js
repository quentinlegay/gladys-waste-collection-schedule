// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createActions } from '../src/actions.js';
import { DEFAULT_CONFIG, ruleKey } from '../src/config.js';
import { HOLIDAY_RULES } from '../src/holidays.js';
import { PROVIDERS } from '../src/providers/index.js';
import { MOMENTS, TRIGGER_COLLECTION_REMINDER, WASTE_TYPE_OPTIONS } from '../src/scenes.js';
import { CUSTOM_WASTE_TYPES } from '../src/wasteTypes.js';
import { DEFAULT_ITEMS, MAX_ITEMS, WIDGET_UPCOMING_COLLECTIONS } from '../src/widget.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const field = (key) => manifest.config_schema.find((f) => f.key === key);

test('every manifest action has a registered handler, and vice versa', () => {
  const handled = Object.keys(createActions({}));
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), handled.sort());
});

test('the widget declared in the manifest is the one the code serves', () => {
  assert.deepEqual(
    manifest.widgets.map((w) => w.key),
    [WIDGET_UPCOMING_COLLECTIONS],
  );
  const maxItems = manifest.widgets[0].settings.find((s) => s.key === 'max_items');
  assert.equal(maxItems.default, DEFAULT_ITEMS);
  assert.equal(maxItems.max, MAX_ITEMS);
});

test('widgets require Gladys >= 5.1.0, categories >= 4.86.0', () => {
  const minVersion = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.\d+/);
  assert.ok(minVersion, 'gladys_version must declare a minimum version');
  const [, major, minor] = minVersion.map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 1), manifest.gladys_version);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const f of manifest.config_schema) {
    if (f.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[f.key], f.default, `DEFAULT_CONFIG.${f.key}`);
    }
  }
});

test('every stored config key is known to the code', () => {
  for (const f of manifest.config_schema.filter((f) => f.type !== 'section')) {
    assert.ok(f.key in DEFAULT_CONFIG, `"${f.key}" is not in DEFAULT_CONFIG`);
  }
});

test('one rule field per custom waste type', () => {
  for (const type of CUSTOM_WASTE_TYPES) {
    const rule = field(ruleKey(type.key));
    assert.ok(rule, `missing ${ruleKey(type.key)}`);
    assert.equal(rule.type, 'string');
    assert.equal(rule.label.fr, type.label.fr);
    assert.equal(rule.label.en, type.label.en);
  }
});

test('the select options match the code', () => {
  assert.deepEqual(
    field('provider')
      .options.map((o) => o.value)
      .sort(),
    Object.keys(PROVIDERS).sort(),
  );
  assert.deepEqual(
    field('holiday_rule')
      .options.map((o) => o.value)
      .sort(),
    Object.values(HOLIDAY_RULES).sort(),
  );
});

test('section fields are purely presentational and within bounds', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    for (const text of Object.values(section.description ?? {})) {
      assert.ok(text.length <= 1000, `section "${section.key}" text over 1000 characters`);
    }
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('names and descriptions fit the store limits', () => {
  assert.ok(manifest.name.length <= 30);
  for (const text of Object.values(manifest.description)) {
    assert.ok(text.length <= 100, text);
  }
});

test('the scene trigger matches the events the code fires', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key),
    [TRIGGER_COLLECTION_REMINDER],
  );
  const [trigger] = manifest.scene_triggers;
  const options = (key) => trigger.fields.find((f) => f.key === key).options.map((o) => o.value);
  assert.deepEqual(options('waste_type'), WASTE_TYPE_OPTIONS);
  assert.deepEqual(
    options('moment'),
    MOMENTS.map((m) => m.key),
  );
  for (const f of trigger.fields) {
    assert.ok(
      f.options.some((o) => o.value === f.default),
      `default of ${f.key}`,
    );
  }
  // Every declared field and variable is a key of the event data.
  const event = { waste_type: 'all', moment: 'eve_19', waste_label: '', date: '', days_before: 1 };
  for (const key of [...trigger.fields, ...trigger.variables].map((f) => f.key)) {
    assert.ok(key in event, `event data lacks "${key}"`);
  }
});

test('the house position is requested (location: true)', () => {
  assert.equal(manifest.location, true);
});
