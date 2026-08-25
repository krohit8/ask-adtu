import initSqlJs from "sql.js";
import { readFileSync } from "node:fs";

async function main() {
  const SQL = await initSqlJs();
  const buffer = readFileSync("src/db/chunks.db");
  const db = new SQL.Database(buffer);
  
  const result = db.exec("SELECT * FROM leads");
  console.log("Leads count:", result[0]?.values?.length || 0);
  if (result[0]?.values?.length > 0) {
    console.log("First lead:", result[0].values[0]);
  }
  
  db.close();
}

main().catch(console.error);
