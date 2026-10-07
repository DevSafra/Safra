/**
 * The post/ files that build an index CONCURRENTLY, and the one shape they may take.
 *
 * ## Why these files are different
 *
 * A plain `CREATE INDEX` refuses every write to its table for as long as the build reads it, and on
 * a table with millions of rows that is an outage at deploy time. `CONCURRENTLY` builds without
 * that lock, and PostgreSQL refuses it inside a transaction block, so it cannot go through the
 * one-transaction-per-file path the other post/ files take. A file that opts out says so on its
 * FIRST line with `NO_TRANSACTION_MARKER`, and is executed one statement at a time.
 *
 * ## Why only CREATE INDEX CONCURRENTLY IF NOT EXISTS
 *
 * Without a transaction, a file that fails half-way leaves its first half applied. That is
 * harmless for an index (the next run skips what exists and builds the rest) and is not harmless
 * for anything else, so the parser refuses every other statement rather than trusting a reviewer to
 * notice one. `IF NOT EXISTS` is what makes a re-run free.
 *
 * ## The one trap `IF NOT EXISTS` sets
 *
 * A concurrent build that fails (a deadlock, a cancelled deploy, a duplicate under UNIQUE) leaves an
 * INVALID index behind under the requested name. `IF NOT EXISTS` would then skip it on every later
 * deploy, and the table would carry an index that is maintained on every write and used by no
 * query. The runner drops an invalid index of that name before building, which is why the name is
 * parsed out here.
 */
export const NO_TRANSACTION_MARKER =
  '-- migrate: no-transaction, concurrent indexes only';

export interface ConcurrentIndexStatement {
  readonly name: string;
  readonly statement: string;
}

const CONCURRENT_INDEX =
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)\s+ON\s+/i;

export function isConcurrentIndexFile(sql: string): boolean {
  return sql.split('\n', 1)[0]?.trim() === NO_TRANSACTION_MARKER;
}

/**
 * Splits the file into its statements, refusing anything that is not a concurrent index build.
 *
 * Only `--` line comments are allowed, and a statement ends at a `;` that ends its line. Both rules
 * keep the split exact without parsing SQL: a block comment or a `;` inside a predicate would make a
 * naive split cut a statement in half, so the file is refused instead.
 */
export function parseConcurrentIndexFile(
  file: string,
  sql: string,
): ConcurrentIndexStatement[] {
  if (sql.includes('/*')) {
    throw new Error(
      `${file}: block comments are not allowed in a concurrent index file.`,
    );
  }

  const body = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  const chunks = body.split(/;[ \t]*$/m).map((chunk) => chunk.trim());
  const statements = chunks.filter((chunk) => chunk.length > 0);

  if (statements.some((statement) => statement.includes(';'))) {
    throw new Error(
      `${file}: every statement must end with a ";" at the end of its line.`,
    );
  }

  return statements.map((statement) => {
    const match = CONCURRENT_INDEX.exec(statement);
    if (!match?.[1]) {
      throw new Error(
        `${file}: only CREATE INDEX CONCURRENTLY IF NOT EXISTS is allowed here, found: ` +
          statement.split('\n', 1)[0],
      );
    }
    return { name: match[1].toLowerCase(), statement };
  });
}
