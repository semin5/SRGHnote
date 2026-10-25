CREATE TABLE IF NOT EXISTS document_user_preferences (
    username varchar(100) PRIMARY KEY,
    page_size integer NOT NULL DEFAULT 50 CHECK (page_size IN (50, 100))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON document_user_preferences TO semin5;
