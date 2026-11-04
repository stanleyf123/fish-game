-- CANDIDATE ONLY. Never run on production without a separate reviewed release.
CREATE TABLE IF NOT EXISTS tm249_messages (
 id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
 visitor_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
 author_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
 message TEXT, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL, deleted_at INTEGER,
 CHECK(owner_id != visitor_id), CHECK(author_id=owner_id OR author_id=visitor_id),
 UNIQUE(author_id,request_id)
);
CREATE INDEX IF NOT EXISTS tm249_thread ON tm249_messages(owner_id,visitor_id,id);
CREATE INDEX IF NOT EXISTS tm249_author_time ON tm249_messages(author_id,created_at);
CREATE INDEX IF NOT EXISTS tm249_visitor_thread ON tm249_messages(visitor_id,id);
CREATE TABLE IF NOT EXISTS tm249_preferences (owner_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)));
CREATE TABLE IF NOT EXISTS tm249_blocks (owner_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,visitor_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,CHECK(owner_id!=visitor_id),PRIMARY KEY(owner_id,visitor_id));
CREATE TABLE IF NOT EXISTS tm249_reports (message_id INTEGER NOT NULL REFERENCES tm249_messages(id) ON DELETE CASCADE,reporter_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,reason TEXT NOT NULL CHECK(reason IN('abuse','spam','other')),created_at INTEGER NOT NULL,PRIMARY KEY(message_id,reporter_id));
