/**
 * postings.mjs
 * Isolated synthetic benchmark prototype: a SQLite-backed posting index with
 * keyset-paginated single-token search. NOT a production API; no FTS, no
 * external dependencies, no network.
 *
 * Tokenisation is ASCII-only: text is lowercased and split on [a-z0-9_]+.
 * Non-ASCII characters act as separators and are not indexed.
 */

import { DatabaseSync } from 'node:sqlite';

// ASCII-lowercase token pattern; intentionally limited (not production Unicode).
const TOKEN_RE = /[a-z0-9_]+/g;
const ID_RE = /^r\d{7}$/;
const MAX_TEXT = 65536;
const MAX_TOKEN = 128;

function isControlFreeString(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 128) return false;
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c < 32 || c === 127) return false;
  }
  return true;
}

function validateTerm(term) {
  if (typeof term !== 'string') throw new TypeError('term must be a string');
  if (term.length < 1 || term.length > MAX_TOKEN) {
    throw new RangeError('term length must be 1..128');
  }
  if (!/^[a-z0-9_]+$/.test(term)) {
    throw new TypeError('term must be a single lowercase ASCII token [a-z0-9_]');
  }
  return term;
}

function validateLimit(limit) {
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('limit must be an integer in 1..100');
  }
  return limit;
}

function validateMaxPostings(maxPostings) {
  if (
    typeof maxPostings !== 'number' ||
    !Number.isInteger(maxPostings) ||
    maxPostings < 1 ||
    maxPostings > 10000
  ) {
    throw new RangeError('maxPostings must be an integer in 1..10000');
  }
  return maxPostings;
}

function validateName(name) {
  if (!isControlFreeString(name)) {
    throw new TypeError('scope/generation must be 1..128 chars with no control characters');
  }
  return name;
}

// Validate a cursor object and equality with the current query context.
// `cursor === undefined` means "no cursor"; `null` is rejected as invalid.
function validateCursor(cursor, { scope, generation, term }) {
  if (cursor === undefined) return null;
  if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) {
    throw new TypeError('cursor must be a plain object');
  }
  if (cursor.version !== 1) {
    throw new TypeError('cursor.version must be 1');
  }
  if (cursor.scope !== scope) {
    throw new TypeError('cursor.scope mismatch');
  }
  if (cursor.generation !== generation) {
    throw new TypeError('cursor.generation mismatch');
  }
  if (cursor.term !== term) {
    throw new TypeError('cursor.term mismatch');
  }
  const after = cursor.after;
  if (typeof after !== 'string' || !ID_RE.test(after)) {
    throw new TypeError('cursor.after must be a valid record id');
  }
  return after;
}

export class PostingIndex {
  /**
   * @param {string} [path] SQLite file path; defaults to an in-memory db.
   */
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this._closed = false;
    this.db.exec('PRAGMA foreign_keys = ON;');
    this._init();
  }

  _init() {
    // generations: track existing (scope, generation) pairs so we can reject
    // duplicate builds including empty ones, and detect unknown generations.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS generations (
        scope TEXT NOT NULL,
        generation TEXT NOT NULL,
        PRIMARY KEY (scope, generation)
      ) WITHOUT ROWID
    `);
    // records: store record IDs only, for transactional duplicate detection
    // without a corpus-sized in-memory Set. FK inline to generations.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (
        scope TEXT NOT NULL,
        generation TEXT NOT NULL,
        id TEXT NOT NULL,
        PRIMARY KEY (scope, generation, id),
        FOREIGN KEY (scope, generation) REFERENCES generations (scope, generation)
          ON DELETE CASCADE
      ) WITHOUT ROWID
    `);
    // postings: composite PRIMARY KEY without rowid; supports indexed keyset
    // scan on (scope, generation, term, id) with no sort and no full scan.
    // FK inline to generations (SQLite does not support ADD CONSTRAINT).
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS postings (
        scope TEXT NOT NULL,
        generation TEXT NOT NULL,
        term TEXT NOT NULL,
        id TEXT NOT NULL,
        PRIMARY KEY (scope, generation, term, id),
        FOREIGN KEY (scope, generation) REFERENCES generations (scope, generation)
          ON DELETE CASCADE
      ) WITHOUT ROWID
    `);
  }

  /** Idempotent close. */
  close() {
    if (this.db && !this._closed) {
      try {
        this.db.close();
      } finally {
        this._closed = true;
      }
    }
  }

  /**
   * Build a generation from a records iterable.
   */
  build(scope, generation, recordsIterable) {
    scope = validateName(scope);
    generation = validateName(generation);

    const exists = this.db
      .prepare('SELECT 1 FROM generations WHERE scope = ? AND generation = ?')
      .get(scope, generation);
    if (exists) {
      throw new Error(`duplicate generation: ${scope}/${generation}`);
    }

    if (recordsIterable == null || typeof recordsIterable[Symbol.iterator] !== 'function') {
      throw new TypeError('recordsIterable must be iterable');
    }

    this.db.exec('BEGIN IMMEDIATE');
    try {
      // Insert the generation row even for empty corpora, so empty generations
      // are tracked and duplicate detection works for them too.
      this.db
        .prepare('INSERT INTO generations (scope, generation) VALUES (?, ?)')
        .run(scope, generation);

      const insRecord = this.db.prepare(
        'INSERT INTO records (scope, generation, id) VALUES (?, ?, ?)'
      );
      const insPosting = this.db.prepare(
        'INSERT OR IGNORE INTO postings (scope, generation, term, id) VALUES (?, ?, ?, ?)'
      );

      // for-of ensures the iterator's return() is invoked on any throw, so the
      // caller's generator can release resources deterministically.
      for (const record of recordsIterable) {
        if (record == null || typeof record !== 'object') {
          throw new TypeError('record must be an object');
        }
        const id = record.id;
        const text = record.text;
        if (typeof id !== 'string' || !ID_RE.test(id)) {
          throw new TypeError('record.id must match /^r\\d{7}$/');
        }
        if (typeof text !== 'string') {
          throw new TypeError('record.text must be a string');
        }
        if (text.length > MAX_TEXT) {
          throw new RangeError('record.text exceeds 65536 chars');
        }
        insRecord.run(scope, generation, id);

        const seen = new Set();
        const lower = text.toLowerCase();
        TOKEN_RE.lastIndex = 0;
        let m;
        while ((m = TOKEN_RE.exec(lower)) !== null) {
          const token = m[0];
          if (token.length > MAX_TOKEN) {
            throw new RangeError('token exceeds 128 chars');
          }
          if (seen.has(token)) continue;
          seen.add(token);
          insPosting.run(scope, generation, token, id);
        }
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Keyset-paginated search over a single token.
   *
   * @returns {{ids: string[], postingsRead: number, complete: boolean,
   *            cursor: object|undefined, internalWorkMeasured: boolean}}
   */
  search(scope, generation, term, { limit = 10, maxPostings = 100, cursor } = {}) {
    scope = validateName(scope);
    generation = validateName(generation);
    term = validateTerm(term);
    limit = validateLimit(limit);
    maxPostings = validateMaxPostings(maxPostings);

    // Validate cursor BEFORE any SQL query.
    const after = validateCursor(cursor, { scope, generation, term });

    const genExists = this.db
      .prepare('SELECT 1 FROM generations WHERE scope = ? AND generation = ?')
      .get(scope, generation);
    if (!genExists) {
      throw new Error(`unknown generation: ${scope}/${generation}`);
    }

    const cap = Math.min(limit, maxPostings);

    const stmt = this.db.prepare(
      `SELECT id FROM postings
       WHERE scope = ? AND generation = ? AND term = ? AND id > ?
       ORDER BY id
       LIMIT ?`
    );
    const rows = stmt.all(scope, generation, term, after || '', cap);
    const ids = rows.map((r) => r.id);
    const postingsRead = rows.length;
    // Conservative completion: an exactly-full page cannot prove exhaustion;
    // a subsequent empty page confirms it. complete iff page < cap.
    const complete = postingsRead < cap;
    let nextCursor = undefined;
    if (!complete) {
      nextCursor = {
        version: 1,
        scope,
        generation,
        term,
        after: ids[ids.length - 1],
      };
    }
    return {
      ids,
      postingsRead,
      complete,
      cursor: nextCursor,
      internalWorkMeasured: false,
    };
  }

  /**
   * Return SQLite EXPLAIN QUERY PLAN detail strings for the search shape.
   */
  explainSearchPlan(scope, generation, term) {
    scope = validateName(scope);
    generation = validateName(generation);
    term = validateTerm(term);
    const genExists = this.db
      .prepare('SELECT 1 FROM generations WHERE scope = ? AND generation = ?')
      .get(scope, generation);
    if (!genExists) {
      throw new Error(`unknown generation: ${scope}/${generation}`);
    }
    const rows = this.db
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT id FROM postings
         WHERE scope = ? AND generation = ? AND term = ? AND id > ''
         ORDER BY id
         LIMIT 10`
      )
      .all(scope, generation, term);
    return rows.map((r) => r.detail);
  }
}
