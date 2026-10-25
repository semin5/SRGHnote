ALTER TABLE documents ADD COLUMN IF NOT EXISTS created_by_name varchar(100);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_by_name varchar(100);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS locked_for_others boolean NOT NULL DEFAULT false;

UPDATE documents SET created_by_name = CASE created_by
    WHEN '99001' THEN '김재현' WHEN '99261014' THEN '최인호' WHEN '99261016' THEN '오세민'
    ELSE created_by END WHERE created_by_name IS NULL;
UPDATE documents SET updated_by_name = CASE updated_by
    WHEN '99001' THEN '김재현' WHEN '99261014' THEN '최인호' WHEN '99261016' THEN '오세민'
    ELSE updated_by END WHERE updated_by_name IS NULL;

CREATE TABLE IF NOT EXISTS document_user_order (
    username varchar(100) NOT NULL,
    document_id bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    sort_order integer NOT NULL,
    PRIMARY KEY (username, document_id)
);
CREATE INDEX IF NOT EXISTS document_user_order_sort_idx ON document_user_order(username, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON document_user_order TO semin5;
