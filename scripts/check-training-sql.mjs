// Tests the actual migration in a disposable PostgreSQL (PGlite) database.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PGlite } = require(
  process.env.TRAINING_PGLITE_PATH || "@electric-sql/pglite",
);
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222";
try {
  await db.exec(`create schema auth; create role authenticated; create role anon;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth, public to authenticated, anon;
    insert into auth.users values ('${alice}'),('${bob}');`);
  await db.exec(
    await fs.readFile(
      new URL(
        "../supabase/migrations/202609170001_training.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    `set role authenticated; set request.jwt.claim.sub='${alice}';`,
  );
  await db.query(
    "insert into training_workspaces(user_id,data) values ($1,$2)",
    [alice, { version: 1 }],
  );
  await assert.rejects(
    db.query("insert into training_workspaces(user_id,data) values ($1,$2)", [
      bob,
      { version: 1 },
    ]),
    /row-level security/,
  );
  await db.exec(`set request.jwt.claim.sub='${bob}'`);
  assert.equal(
    (await db.query("select * from training_workspaces")).rows.length,
    0,
  );
  assert.equal(
    (
      await db.query(
        "update training_workspaces set revision=2 where user_id=$1 returning user_id",
        [alice],
      )
    ).rows.length,
    0,
  );
  await db.query(
    "insert into training_workspaces(user_id,data) values ($1,$2)",
    [bob, { version: 1 }],
  );
  await assert.rejects(
    db.query("update training_workspaces set data=$1 where user_id=$2", [
      {},
      bob,
    ]),
    /check constraint/,
  );
  await db.exec(`set request.jwt.claim.sub='${alice}'`);
  assert.equal(
    (
      await db.query(
        "update training_workspaces set revision=2 where user_id=$1 and revision=1 returning revision",
        [alice],
      )
    ).rows.length,
    1,
  );
  assert.equal(
    (
      await db.query(
        "update training_workspaces set revision=3 where user_id=$1 and revision=1 returning revision",
        [alice],
      )
    ).rows.length,
    0,
  );
  await assert.rejects(
    db.query("update training_workspaces set user_id=$1 where user_id=$2", [
      bob,
      alice,
    ]),
    /row-level security/,
  );
  await db.exec("reset role; set role anon");
  await assert.rejects(
    db.query("select * from training_workspaces"),
    /permission denied/,
  );
  console.log(
    "PASS: migration executes; RLS isolates reads/inserts/updates; owner cannot be reassigned; anonymous access denied; schema version enforced; stale revisions cannot overwrite.",
  );
} finally {
  await db.close();
}
