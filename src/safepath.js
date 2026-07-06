'use strict';

const path = require('path');

// Resolve a client-supplied relative path safely under `base`. Returns the
// absolute target for a `.jsonl` file that stays within `base`, or null for
// anything else (traversal, non-jsonl, junk). Absolute inputs are contained by
// stripping the leading separator so they land inside `base`.
function safeTarget(base, rel) {
  if (!rel || typeof rel !== 'string') return null;
  const cleaned = path.normalize(rel).replace(/^([/\\])+/, '');
  if (!cleaned.endsWith('.jsonl')) return null;
  const full = path.resolve(base, cleaned);
  if (full !== base && !full.startsWith(path.resolve(base) + path.sep)) return null;
  return full;
}

module.exports = { safeTarget };
