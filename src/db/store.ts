import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";

export interface StoredChunk {
  id: number;
  url: string;
  title: string;
  section: string;
  kind: "page" | "pdf" | "faq";
  text: string;
  embedding: Float32Array;
}

export const DB_PATH = path.resolve(process.cwd(), "src/db/chunks.db");

type SqlJs = Awaited<ReturnType<typeof initSqlJs>>;

let db: InstanceType<SqlJs["Database"]> | null = null;
let chunksCache: StoredChunk[] | null = null;
let sqlJsInit: Promise<SqlJs> | null = null;

async function getSqlJs(): Promise<SqlJs> {
  if (!sqlJsInit) {
    sqlJsInit = initSqlJs({
      locateFile: (name) => path.resolve(process.cwd(), "node_modules", "sql.js", "dist", name),
    });
  }
  return sqlJsInit;
}

async function openDb(): Promise<InstanceType<SqlJs["Database"]>> {
  if (!db) {
    if (!existsSync(DB_PATH)) {
      throw new Error(
        `Knowledge base not found at ${DB_PATH}. Run: npm run crawl && npm run ingest`,
      );
    }
    const SQL = await getSqlJs();
    const buffer = readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    db.exec(`CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      user_query TEXT NOT NULL,
      interested_domain TEXT,
      topic TEXT,
      phone_number TEXT,
      contact_requested INTEGER DEFAULT 0,
      contact_status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_leads_session ON leads(session_id); CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(contact_status);`);
    try {
      db.exec("ALTER TABLE leads ADD COLUMN topic TEXT");
    } catch {
      // column already exists
    }
  }
  return db;
}

async function persistDb() {
  if (!db) return;
  const data = db.export();
  writeFileSync(DB_PATH, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
}

export async function isReady(): Promise<boolean> {
  try {
    return (await getChunks()).length > 0;
  } catch {
    return false;
  }
}

export interface Lead {
  id: number;
  sessionId: string;
  userQuery: string;
  interestedDomain: string | null;
  topic: string | null;
  phoneNumber: string | null;
  contactRequested: boolean;
  contactStatus: "pending" | "contacted" | "completed";
  createdAt: string;
}

export async function createLead(data: {
  sessionId: string;
  userQuery: string;
  interestedDomain?: string | null;
  topic?: string | null;
  phoneNumber?: string | null;
  contactRequested?: boolean;
}): Promise<Lead> {
  const d = await openDb();
  const now = new Date().toISOString();
  d.run(
    `INSERT INTO leads (session_id, user_query, interested_domain, topic, phone_number, contact_requested, contact_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.sessionId,
      data.userQuery,
      data.interestedDomain ?? null,
      data.topic ?? null,
      data.phoneNumber ?? null,
      data.contactRequested ? 1 : 0,
      "pending",
      now,
    ],
  );
  const idResult = d.exec("SELECT last_insert_rowid() as id");
  const id = (idResult[0]?.values[0]?.[0] as number) ?? 0;
  await persistDb();
  return {
    id,
    sessionId: data.sessionId,
    userQuery: data.userQuery,
    interestedDomain: data.interestedDomain ?? null,
    topic: data.topic ?? null,
    phoneNumber: data.phoneNumber ?? null,
    contactRequested: !!data.contactRequested,
    contactStatus: "pending",
    createdAt: now,
  };
}

export async function getLeads(options?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ leads: Lead[]; total: number }> {
  const d = await openDb();
  const status = options?.status;
  const limit = options?.limit ?? 100;
  const offset = options?.offset ?? 0;
  const where = status ? "WHERE contact_status = ?" : "";
  const countStmt = d.prepare(`SELECT COUNT(*) as total FROM leads ${where}`);
  if (status) countStmt.bind([status]);
  const countRow = countStmt.getAsObject() as { total: number };
  countStmt.free();
  const stmt = d.prepare(
    `SELECT id, session_id, user_query, interested_domain, topic, phone_number, contact_requested, contact_status, created_at
     FROM leads ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
  );
  if (status) stmt.bind([status, limit, offset]);
  else stmt.bind([limit, offset]);
  const rows: Lead[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      id: number;
      session_id: string;
      user_query: string;
      interested_domain: string | null;
      topic: string | null;
      phone_number: string | null;
      contact_requested: number;
      contact_status: string;
      created_at: string;
    };
    rows.push({
      id: row.id,
      sessionId: row.session_id,
      userQuery: row.user_query,
      interestedDomain: row.interested_domain,
      topic: row.topic,
      phoneNumber: row.phone_number,
      contactRequested: !!row.contact_requested,
      contactStatus: row.contact_status as Lead["contactStatus"],
      createdAt: row.created_at,
    });
  }
  stmt.free();
  return { leads: rows, total: countRow.total };
}

export async function updateLeadStatus(id: number, status: Lead["contactStatus"]): Promise<boolean> {
  const d = await openDb();
  d.run("UPDATE leads SET contact_status = ? WHERE id = ?", [status, id]);
  await persistDb();
  return true;
}

export async function updateLeadPhone(id: number, phoneNumber: string): Promise<boolean> {
  const d = await openDb();
  d.run("UPDATE leads SET phone_number = ? WHERE id = ?", [phoneNumber, id]);
  await persistDb();
  return true;
}

/** All chunks with embeddings, loaded once and cached in memory (~few MB). */
export async function getChunks(): Promise<StoredChunk[]> {
  if (chunksCache) return chunksCache;
  const d = await openDb();
  const stmt = d.prepare("SELECT id, url, title, section, kind, text, embedding FROM chunks");
  const rows: StoredChunk[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      id: number;
      url: string;
      title: string;
      section: string;
      kind: StoredChunk["kind"];
      text: string;
      embedding: Uint8Array;
    };
    rows.push({
      ...row,
      embedding: new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / 4,
      ),
    });
  }
  stmt.free();
  chunksCache = rows;
  return chunksCache;
}
