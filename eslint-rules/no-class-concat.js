/**
 * Custom ESLint rule: no-class-concat
 *
 * Background (Wave 2 — 2026-05-XX): we shipped 15+ corrupted Tailwind class
 * strings where two utilities were concatenated without a space, e.g.
 * `border-borderrounded-lg` (instead of `border-border rounded-lg`) and
 * `border-border-mx-6` (instead of `border-border mx-6`). We also shipped a
 * handful of phantom tokens that do not resolve to anything in our Tailwind
 * config (`bg-text-tertiary`, `border-t-line`). This rule prevents those
 * specific shapes from ever reaching `main` again.
 *
 * What it scans:
 *   - JSX `className="..."` string literals
 *   - String literals passed to `cn(...)`, `clsx(...)`, `twMerge(...)`
 *     (whether positional or part of `${...}` template chunks)
 *
 * What it flags:
 *   1. Regex `\b\w+-\w+rounded` — concatenated utility followed by `rounded`
 *      (e.g. `border-borderrounded`, `bg-cardrounded-lg`).
 *   2. Regex `\b\w+-\w+border\b` — concatenated utility followed by `border`
 *      where the preceding token is itself a utility-with-dash (e.g.
 *      `border-border-mx` — flagged because the second `border` is fused
 *      onto a token that already has a `-` infix).
 *   3. A configurable list of literal phantom classes (default:
 *      `bg-text-tertiary`, `border-t-line`).
 *
 * Autofix:
 *   Default = OFF. Wave 2 found that the typo is often ambiguous (is
 *   `border-borderrounded-lg` meant to be `border-border rounded-lg` or
 *   `border-rounded-lg`? both make sense in context). We leave the fix to
 *   the developer. The rule can be configured with `{ autofix: true }` if
 *   a team wants the lossy "insert space before `rounded`/`border`" fix.
 *
 * Configuration (in `eslint.config.js`):
 *   'boardroom/no-class-concat': ['error', {
 *     phantomClasses: ['bg-text-tertiary', 'border-t-line'],
 *     autofix: false,
 *   }]
 */

'use strict';

const DEFAULT_PHANTOM_CLASSES = ['bg-text-tertiary', 'border-t-line'];

// Match `border-borderrounded`, `bg-cardrounded-md`, etc.
// Pattern: a Tailwind-ish token (`word-word`) directly followed by `rounded`
// with no whitespace.
const CONCAT_ROUNDED = /\b\w+-\w+rounded\b/;

// Match `border-border-mx`, `text-text-py`, etc.
// Pattern: a token that already contains a `-` infix directly followed by
// `border` (no space). The `\b\w+-\w+border\b` pattern intentionally requires
// the second `border` to be fused onto a `word-word` prefix so we don't flag
// legitimate `border-l-2`-style classes.
const CONCAT_BORDER = /\b\w+-\w+border-(?!radius)\w+/;

function buildPhantomRegex(phantomList) {
  if (!phantomList || phantomList.length === 0) return null;
  const escaped = phantomList.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${escaped.join('|')})\\b`);
}

/**
 * Scan a string literal for any of the bad patterns. Returns either null
 * (clean) or an object describing the first match found.
 */
function findBadClass(value, phantomRegex) {
  if (typeof value !== 'string' || value.length === 0) return null;

  let match = value.match(CONCAT_ROUNDED);
  if (match) {
    return {
      kind: 'concat-rounded',
      match: match[0],
      message: `Likely concatenated Tailwind classes: "${match[0]}". Did you mean to insert a space before "rounded"?`,
    };
  }

  match = value.match(CONCAT_BORDER);
  if (match) {
    return {
      kind: 'concat-border',
      match: match[0],
      message: `Likely concatenated Tailwind classes: "${match[0]}". Did you mean to insert a space before "border"?`,
    };
  }

  if (phantomRegex) {
    match = value.match(phantomRegex);
    if (match) {
      return {
        kind: 'phantom-class',
        match: match[0],
        message: `Phantom Tailwind class "${match[0]}" does not resolve in this codebase. Use a defined token (see packages/boardroom-ai/client/src/styles/tokens.css).`,
      };
    }
  }

  return null;
}

const CLASS_HELPERS = new Set(['cn', 'clsx', 'twMerge', 'classNames']);

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Detect concatenated Tailwind class strings (e.g. `border-borderrounded-lg`) and phantom tokens.',
      recommended: true,
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          phantomClasses: {
            type: 'array',
            items: { type: 'string' },
            description: 'Literal class names to forbid (defaults to known launch-blockers).',
          },
          autofix: {
            type: 'boolean',
            description: 'If true, insert a space at the join point. Default false (ambiguous).',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      badClass: '{{message}}',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const phantomList = options.phantomClasses || DEFAULT_PHANTOM_CLASSES;
    const phantomRegex = buildPhantomRegex(phantomList);
    const autofix = options.autofix === true;

    function buildFixer(node, finding) {
      if (!autofix) return undefined;
      if (finding.kind === 'concat-rounded') {
        return (fixer) => {
          const raw = context.sourceCode.getText(node);
          const fixed = raw.replace(/(\w)rounded/g, '$1 rounded');
          return fixer.replaceText(node, fixed);
        };
      }
      if (finding.kind === 'concat-border') {
        return (fixer) => {
          const raw = context.sourceCode.getText(node);
          const fixed = raw.replace(/(\w-\w+)border/g, '$1 border');
          return fixer.replaceText(node, fixed);
        };
      }
      return undefined;
    }

    function report(node, value) {
      const finding = findBadClass(value, phantomRegex);
      if (!finding) return;
      context.report({
        node,
        messageId: 'badClass',
        data: { message: finding.message },
        fix: buildFixer(node, finding),
      });
    }

    function scanStringLiteralNode(node) {
      if (node.type === 'Literal' && typeof node.value === 'string') {
        report(node, node.value);
      } else if (node.type === 'TemplateLiteral') {
        for (const quasi of node.quasis) {
          report(quasi, quasi.value.cooked || quasi.value.raw || '');
        }
      }
    }

    return {
      // JSX <div className="..." />
      JSXAttribute(node) {
        if (!node.name || node.name.name !== 'className') return;
        if (!node.value) return;
        if (node.value.type === 'Literal') {
          report(node.value, node.value.value);
        } else if (node.value.type === 'JSXExpressionContainer') {
          // className={`...`} or className={cn(...)}
          const expr = node.value.expression;
          if (expr.type === 'TemplateLiteral') {
            scanStringLiteralNode(expr);
          } else if (expr.type === 'Literal') {
            report(expr, expr.value);
          }
        }
      },

      // cn('...'), clsx(`...`), twMerge('...')
      CallExpression(node) {
        const callee = node.callee;
        let name = null;
        if (callee.type === 'Identifier') name = callee.name;
        else if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
          name = callee.property.name;
        }
        if (!name || !CLASS_HELPERS.has(name)) return;
        for (const arg of node.arguments) {
          scanStringLiteralNode(arg);
        }
      },
    };
  },
};
