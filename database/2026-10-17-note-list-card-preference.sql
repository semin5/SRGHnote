ALTER TABLE document_user_preferences
    ADD COLUMN IF NOT EXISTS view_mode varchar(8) NOT NULL DEFAULT 'LIST';

ALTER TABLE document_user_preferences
    DROP CONSTRAINT IF EXISTS document_user_preferences_view_mode_check;

ALTER TABLE document_user_preferences
    ADD CONSTRAINT document_user_preferences_view_mode_check
    CHECK (view_mode IN ('LIST', 'CARD'));
