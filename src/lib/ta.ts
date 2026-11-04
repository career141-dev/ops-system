/**
 * The window to the TA System (15, Part E; Phase 1 steps 20 to 22).
 *
 * Ops reads the TA System through its API and keeps no copy of anything that
 * belongs to it — openings, candidates, placements. Three switches, separately:
 * reads, writes, and a fake TA for working before the API exists.
 *
 * Writes never go straight out from a screen. They are queued (`opsOutbox`) and
 * carry a key, so asking twice cannot create two openings: the API is on
 * another machine, and "did that get through?" must have a safe answer.
 *
 * Every call is recorded with how long it took, because the first question when
 * something looks wrong is whether the window is open at all.
 */

export interface TaPerson {
  id: string;
  fullName: string;
  email: string;
  taRole: string | null;
  isActive: boolean;
}

export interface TaContact {
  name: string;
  email: string;
  /** "hr" is who a set is sent to; the rest are copied or kept for reference. */
  role: string | null;
  phone?: string | null;
}

export interface TaClient {
  id: string;
  name: string;
  nameKey: string;
  industry: string | null;
  esaSignedAt: number | null;
  status: string;
  opsOwnerId: string | null;
  /** The client's own people, kept on TA's client record (Part E, GET clients). */
  contacts?: TaContact[];
}

/** One round of CVs sent to a client, as TA keeps it (Part E, GET client-sets). */
export interface TaClientSet {
  id: string;
  setNumber: number;
  openingId: string;
  applicationIds: string[];
  /** Per application: who it is and whether the prepared CV exists. */
  applications: { id: string; name: string; preparedCv: boolean }[];
  dispatch: string;
  status: string;
  sentAt: number | null;
  receivedAt: number | null;
}

export interface TaOpening {
  id: string;
  title: string;
  clientId: string;
  status: string;
  primaryRecruiterId: string | null;
  taLeadId: string | null;
  headcount: number;
  assignedAt: number | null;
}

export interface TaEvent {
  id: string;
  type: string;
  at: number;
  data: Record<string, unknown>;
}

export type TaResult<T> =
  | { ok: true; data: T; ms: number }
  | { ok: false; reason: string };

function base(): string | null {
  const url = (process.env.OPS_TA_BASE_URL ?? "").trim();
  return url || null;
}

const on = (name: string) => (process.env[name] ?? "").trim().toLowerCase() === "on";

export function readsEnabled(): boolean {
  return on("OPS_TA_READS_ENABLED");
}

export function writesEnabled(): boolean {
  return on("OPS_TA_WRITES_ENABLED");
}

/**
 * A stand-in TA System, for the laptop and the tests.
 *
 * The real API does not exist yet (it is a TA-side pull request), and waiting
 * for it would mean none of this could be built or shown. The fake answers the
 * same shapes from recorded data and is obvious about it on every screen.
 */
export function fakeTa(): boolean {
  return on("OPS_TA_FAKE");
}

export function windowInWords(): string {
  if (fakeTa()) return "A stand-in TA System with recorded answers. Nothing real is read.";
  if (!readsEnabled()) return "Reading the TA System is switched off.";
  if (!base()) return "No TA System address is set yet.";
  return "Reading " + base() + ".";
}

async function note(entry: {
  direction: "read" | "write" | "events";
  path: string;
  ok: boolean;
  status: number | null;
  ms: number;
  note: string | null;
}): Promise<void> {
  // Imported here rather than at the top: this file is read by screens, and
  // the recorder has to pick the store at the moment of the call.
  const { logTaCall } = await import("@/data/taLog");
  await logTaCall(entry);
}

async function call<T>(
  direction: "read" | "write" | "events",
  path: string,
  init?: RequestInit,
): Promise<TaResult<T>> {
  const started = Date.now();
  const give = async (reason: string, status: number | null = null): Promise<TaResult<T>> => {
    await note({ direction, path, ok: false, status, ms: Date.now() - started, note: reason });
    return { ok: false, reason };
  };

  if (fakeTa()) {
    const { fakeAnswer } = await import("@/data/fakeTa");
    const answer = fakeAnswer<T>(path, String(init?.method ?? "GET"));
    if (!answer.ok) return give(answer.reason);
    await note({ direction, path, ok: true, status: 200, ms: 0, note: "stand-in" });
    return { ok: true, data: answer.data, ms: 0 };
  }

  if (direction === "write" ? !writesEnabled() : !readsEnabled()) {
    return give(direction === "write" ? "Writing to the TA System is switched off." : "Reading the TA System is switched off.");
  }
  const root = base();
  if (!root) return give("No TA System address is set yet.");
  const token = (process.env.OPS_TA_TOKEN ?? "").trim();
  if (!token) return give("No TA System token is set yet.");

  try {
    const response = await fetch(root.replace(/\/$/, "") + path, {
      ...init,
      headers: { authorization: "Bearer " + token, "content-type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return give("The TA System answered " + response.status + ".", response.status);
    const data = (await response.json()) as T;
    await note({ direction, path, ok: true, status: response.status, ms: Date.now() - started, note: null });
    return { ok: true, data, ms: Date.now() - started };
  } catch (error) {
    return give(error instanceof Error && error.name === "TimeoutError" ? "The TA System did not answer in twenty seconds." : "The TA System could not be reached.");
  }
}

/**
 * The same call, for a read that answers with a file instead of JSON.
 *
 * Everything about it is the same - the switches, the stand-in, the timing
 * written to the log - so there is one door to the TA System and not two.
 */
async function callBytes(
  direction: "read" | "write" | "events",
  path: string,
): Promise<TaResult<{ bytes: Uint8Array; mime: string }>> {
  const started = Date.now();
  const give = async (reason: string, status: number | null = null): Promise<TaResult<{ bytes: Uint8Array; mime: string }>> => {
    await note({ direction, path, ok: false, status, ms: Date.now() - started, note: reason });
    return { ok: false, reason };
  };

  if (fakeTa()) {
    const { fakeFile } = await import("@/data/fakeTa");
    const answer = fakeFile(path);
    if (!answer.ok) return give(answer.reason);
    await note({ direction, path, ok: true, status: 200, ms: 0, note: "stand-in" });
    return { ok: true, data: answer.data, ms: 0 };
  }

  if (!readsEnabled()) return give("Reading the TA System is switched off.");
  const root = base();
  if (!root) return give("No TA System address is set yet.");
  const token = (process.env.OPS_TA_TOKEN ?? "").trim();
  if (!token) return give("No TA System token is set yet.");

  try {
    const response = await fetch(root.replace(/\/$/, "") + path, {
      headers: { authorization: "Bearer " + token },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return give("The TA System answered " + response.status + ".", response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mime = response.headers.get("content-type") ?? "application/pdf";
    await note({ direction, path, ok: true, status: response.status, ms: Date.now() - started, note: null });
    return { ok: true, data: { bytes, mime }, ms: Date.now() - started };
  } catch (error) {
    return give(
      error instanceof Error && error.name === "TimeoutError"
        ? "The TA System did not answer in twenty seconds."
        : "The TA System could not be reached.",
    );
  }
}

/* ── Reads (Part E2) ──────────────────────────────────────────────────── */

/** The desk's people. The first read we use, because it proves the window works. */
export function people(): Promise<TaResult<TaPerson[]>> {
  return call<TaPerson[]>("read", "/integrations/v1/people");
}

/** A client by name, to know whether they are already ours before making a lead. */
export function clients(query: string): Promise<TaResult<TaClient[]>> {
  return call<TaClient[]>("read", "/integrations/v1/clients?q=" + encodeURIComponent(query));
}

export function openings(clientId?: string): Promise<TaResult<TaOpening[]>> {
  const where = clientId ? "?clientId=" + encodeURIComponent(clientId) : "";
  return call<TaOpening[]>("read", "/integrations/v1/openings" + where);
}

export function opening(openingId: string): Promise<TaResult<TaOpening>> {
  return call<TaOpening>("read", "/integrations/v1/openings/" + encodeURIComponent(openingId));
}

/** What a client has been sent and what came back, for one opening. */
export function clientSets(openingId: string): Promise<TaResult<TaClientSet[]>> {
  return call<TaClientSet[]>("read", "/integrations/v1/openings/" + encodeURIComponent(openingId) + "/client-sets");
}

/** The opening's pipeline, for the depth rules (15, Phase 4 step 14). */
export interface TaPipeline {
  applications: {
    id: string;
    candidateName: string;
    currentStage: string;
    setNumber: number | null;
    backupForApplicationId: string | null;
  }[];
  counts: Record<string, number>;
}

export function pipeline(openingId: string): Promise<TaResult<TaPipeline>> {
  return call<TaPipeline>("read", "/integrations/v1/openings/" + encodeURIComponent(openingId) + "/pipeline");
}

/** One round, by its number on the opening (15, Phase 4 step 2). */
export function clientSet(openingId: string, setNumber: number): Promise<TaResult<TaClientSet>> {
  return call<TaClientSet>(
    "read",
    "/integrations/v1/openings/" + encodeURIComponent(openingId) + "/client-sets/" + setNumber,
  );
}

/**
 * The prepared CV of one application, as bytes (15, Phase 4 step 3).
 *
 * TA streams the file rather than describing it, so this is the one read that
 * is not JSON. It is fetched once and kept, because the email we send has to
 * be reproducible a year later: TA may replace a prepared CV, and what the
 * client actually received must not change with it.
 */
export async function preparedCv(applicationId: string): Promise<TaResult<{ bytes: Uint8Array; mime: string }>> {
  return callBytes("read", "/integrations/v1/applications/" + encodeURIComponent(applicationId) + "/prepared-cv");
}

/* ── Writes (Part E2), always from the outbox and never from a screen ──── */

export function write(path: string, body: Record<string, unknown>, idempotencyKey: string): Promise<TaResult<unknown>> {
  return call<unknown>("write", path, {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

/* ── Events (Part E3) ─────────────────────────────────────────────────── */

export function eventsAfter(cursor: string, limit = 200): Promise<TaResult<{ events: TaEvent[]; nextCursor: string }>> {
  return call<{ events: TaEvent[]; nextCursor: string }>(
    "events",
    "/integrations/v1/events?after=" + encodeURIComponent(cursor) + "&limit=" + limit,
  );
}
