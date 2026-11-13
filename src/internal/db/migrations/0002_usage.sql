-- Hourly usage snapshots taken by the background collector (internal/usage).
-- ts is Unix seconds (UTC) truncated to the hour; older rows are compacted to
-- the last snapshot of each UTC day.
CREATE TABLE IF NOT EXISTS cluster_usage (
    cluster_id   INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    ts           INTEGER NOT NULL,
    bytes        INTEGER NOT NULL,
    objects      INTEGER NOT NULL,
    data_avail   INTEGER NOT NULL,
    bucket_count INTEGER NOT NULL,
    PRIMARY KEY (cluster_id, ts)
);

CREATE TABLE IF NOT EXISTS bucket_usage (
    cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    bucket_id  TEXT    NOT NULL,
    ts         INTEGER NOT NULL,
    alias      TEXT    NOT NULL DEFAULT '',
    bytes      INTEGER NOT NULL,
    objects    INTEGER NOT NULL,
    PRIMARY KEY (cluster_id, bucket_id, ts)
);
