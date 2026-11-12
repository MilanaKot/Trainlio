/**
 * What a coach writes about one booking (handoff v3.3, K17). The same limits
 * are CHECK constraints in migration 43; these are for the form's counter and
 * the action's validation, so the database is never the first to say no.
 */

/** `Poznámka k tréninku · jen trenéři` (decision 35). */
export const COACH_NOTE_LIMIT = 200

/** `Zpráva pro rodiče` (decision 36). */
export const PARENT_MESSAGE_LIMIT = 500
