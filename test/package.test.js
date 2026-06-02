'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const pkg = require('../package.json');

test('voice-first CLI has a cmux-voice primary alias with legacy aliases retained', () => {
  assert.strictEqual(pkg.bin['cmux-voice'], 'bin/cmux-skills.js');
  assert.strictEqual(pkg.bin['hermes-cmux'], 'bin/cmux-skills.js');
  assert.strictEqual(pkg.bin['cmux-skills'], 'bin/cmux-skills.js');
});
