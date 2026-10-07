/** The one job the `exports` queue carries, so far. */
export const EXPORT_JOB = 'export.build' as const;

/**
 * Where a built CSV lives.
 *
 * `exports/`, outside the `properties/*` anonymous-read grant — the same reasoning as `incoming/`
 * and a stronger case: this is not one stranger's photograph, it is every booking a filter matched,
 * with customer names in it. It is fetched through the API by an authorised caller whose download
 * writes an audit row, never by a URL that works for anybody holding it.
 *
 * One function for the worker that writes the file and the retention sweep that deletes it. The
 * sweep also deletes it for a row that FAILED, which carries no `file_key` but may have had its
 * bytes written before the row update that would have recorded them failed — so the key has to be
 * derivable from the reference alone, by the same rule both times.
 */
export function exportFileKey(reference: string): string {
  return `exports/${reference}.csv`;
}

/**
 * What a worker needs to build one CSV.
 *
 * ## Only the row id travels
 *
 * Not the filters, not the requester's claims. Both are already ON the row, which is the record
 * everything else reads — the screen, the audit trail, the expiry sweep — and a job carrying its own
 * copy would be a second source of truth for what this export contains. The failure mode is
 * specific and bad: a job whose filters disagreed with the row's would produce a file the row
 * describes wrongly, and the row is what an auditor reads.
 *
 * It also means nothing here is worth redacting. A row id is not data about anybody.
 *
 * ## Authorisation is re-derived, never carried
 *
 * A booking export is scoped by the requester's own city scope, and that scope must be the one they
 * hold WHEN THE FILE IS BUILT — not the one they held when they asked. Carrying claims in a job
 * payload would let an export outlive the permission that justified it: revoke somebody's access at
 * 10:00 and a job queued at 09:59 would still hand them the data. The worker reads the requester
 * from the row and their scope from the database.
 */
export interface ExportJobData {
  /** The `export_jobs` row this job completes. */
  readonly exportId: string;
}

/**
 * A deterministic job id, so one request cannot be built twice.
 *
 * A dash, never a colon — BullMQ rejects `:` outright, since it is its own key separator.
 */
export function exportJobId(exportId: string): string {
  return `export-${exportId}`;
}
