ALTER TABLE document_user_preferences
    DROP CONSTRAINT IF EXISTS document_user_preferences_view_mode_check;

ALTER TABLE document_user_preferences
    ADD CONSTRAINT document_user_preferences_view_mode_check
    CHECK (view_mode IN ('AUTO', 'LIST', 'CARD'));

ALTER TABLE document_user_preferences
    ALTER COLUMN view_mode SET DEFAULT 'AUTO';

UPDATE document_user_preferences
SET view_mode = 'AUTO'
WHERE view_mode = 'LIST' AND page_size = 20;
