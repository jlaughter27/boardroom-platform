/**
 * BoardRoom local ESLint plugin.
 *
 * Hosts rules that are specific to this codebase and not worth publishing.
 * Loaded by `eslint.config.js` via the flat-config `plugins` map under the
 * `boardroom` namespace, so rules are referenced as
 * `'boardroom/<rule-name>': ['error', ...]`.
 */

'use strict';

module.exports = {
  rules: {
    'no-class-concat': require('./no-class-concat.js'),
  },
};
