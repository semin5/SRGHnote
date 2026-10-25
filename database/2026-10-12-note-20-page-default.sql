-- Keep 50/100 as selectable values while switching the default to 20.
ALTER TABLE document_user_preferences
    DROP CONSTRAINT IF EXISTS document_user_preferences_page_size_check;
ALTER TABLE document_user_preferences
    ADD CONSTRAINT document_user_preferences_page_size_check
    CHECK (page_size IN (20, 50, 100));
ALTER TABLE document_user_preferences
    ALTER COLUMN page_size SET DEFAULT 20;
UPDATE document_user_preferences SET page_size = 20 WHERE page_size = 50;
