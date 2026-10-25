package sarangit.semin5.notion;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.PreparedStatement;
import java.util.List;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ContentDisposition;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class AttachmentController {
    private static final Logger log = LoggerFactory.getLogger(AttachmentController.class);
    private final JdbcTemplate jdbc;
    private final AttachmentFileStore files;

    public AttachmentController(JdbcTemplate jdbc, AttachmentFileStore files) {
        this.jdbc = jdbc;
        this.files = files;
    }

    @GetMapping("/documents/{documentId}/files")
    public List<Map<String, Object>> list(@PathVariable long documentId) {
        requireDocument(documentId);
        return jdbc.queryForList("SELECT id, file_name, content_type, size_bytes, "
                + "TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS created_at "
                + "FROM attachments WHERE document_id = ? ORDER BY id", documentId);
    }

    @PostMapping(value = "/documents/{documentId}/files", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Transactional
    public Map<String, Object> upload(@PathVariable long documentId, @RequestParam("file") MultipartFile file,
                                      @RequestAttribute("notionUser") PortalAuth.User user) throws Exception {
        requireDocument(documentId);
        Integer writable = jdbc.queryForObject("SELECT COUNT(*) FROM documents WHERE id = ? AND deleted_at IS NULL "
                + "AND parent_id IS NOT NULL AND (NOT locked_for_others OR created_by = ?)",
                Integer.class, documentId, user.username());
        if (writable == null || writable == 0) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        if (!files.available()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "Attachment storage is not mounted");
        if (file.isEmpty() || file.getSize() > 50_000_000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "File must be between 1 byte and 50 MB");
        String name = file.getOriginalFilename() == null ? "attachment" : file.getOriginalFilename()
                .replace('\\', '/').replaceAll("^.*/", "").trim();
        if (name.isEmpty()) name = "attachment";
        if (name.length() > 255) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Filename too long");
        String type = file.getContentType() == null ? "application/octet-stream" : file.getContentType();
        if (type.length() > 120) type = "application/octet-stream";
        byte[] bytes = file.getBytes();
        String finalName = name;
        String finalType = type;
        GeneratedKeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(
                    "INSERT INTO attachments (document_id, file_name, content_type, size_bytes, data, created_by) "
                    + "VALUES (?, ?, ?, ?, ?, ?)", new String[]{"id"});
            statement.setLong(1, documentId);
            statement.setString(2, finalName);
            statement.setString(3, finalType);
            statement.setLong(4, bytes.length);
            statement.setBytes(5, bytes);
            statement.setString(6, user.username());
            return statement;
        }, keys);
        long id = keys.getKey().longValue();
        try {
            files.store(documentId, id, name, type, bytes);
        } catch (IOException error) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Attachment storage unavailable", error);
        }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCompletion(int status) {
                    if (status != STATUS_COMMITTED) {
                        try { files.remove(documentId, id, finalName, finalType); }
                        catch (IOException error) { log.warn("Could not clean up rolled-back attachment {}", id, error); }
                    }
                }
            });
        }
        jdbc.update("INSERT INTO change_events (document_id, change_type, changed_by) VALUES (?, 'file', ?)",
                documentId, user.username());
        return Map.of("id", id, "file_name", name, "content_type", type,
                "size_bytes", bytes.length, "url", "/note/api/files/" + id);
    }

    @GetMapping("/files/{id}")
    public ResponseEntity<byte[]> download(@PathVariable long id) {
        return fileResponse(id, false);
    }

    @GetMapping("/files/{id}/preview")
    public ResponseEntity<byte[]> preview(@PathVariable long id) {
        return fileResponse(id, true);
    }

    private ResponseEntity<byte[]> fileResponse(long id, boolean pdfPreview) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT a.document_id, a.file_name, a.content_type, a.size_bytes FROM attachments a "
                + "JOIN documents d ON d.id = a.document_id WHERE a.id = ? AND d.deleted_at IS NULL", id);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        Map<String, Object> row = rows.getFirst();
        long documentId = ((Number) row.get("document_id")).longValue();
        String name = (String) row.get("file_name");
        String type = (String) row.get("content_type");
        long size = ((Number) row.get("size_bytes")).longValue();
        byte[] bytes = null;
        try { bytes = files.read(documentId, id, name, type, size); }
        catch (IOException error) { log.warn("Could not read attachment {} from disk", id, error); }
        if (bytes == null) {
            bytes = jdbc.queryForObject("SELECT data FROM attachments WHERE id = ?", byte[].class, id);
            if (files.available()) {
                try { files.store(documentId, id, name, type, bytes); }
                catch (IOException error) { log.warn("Could not restore attachment {} to disk", id, error); }
            }
        }
        if (pdfPreview && (bytes.length < 5 || bytes[0] != '%' || bytes[1] != 'P'
                || bytes[2] != 'D' || bytes[3] != 'F' || bytes[4] != '-'))
            throw new ResponseStatusException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Not a PDF file");
        boolean inlineImage = List.of("image/png", "image/jpeg", "image/gif", "image/webp").contains(type);
        ContentDisposition disposition = (pdfPreview || inlineImage
                ? ContentDisposition.inline() : ContentDisposition.attachment())
                .filename(name, StandardCharsets.UTF_8).build();
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_DISPOSITION, disposition.toString())
                .header("X-Content-Type-Options", "nosniff")
                .header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .contentType(pdfPreview ? MediaType.APPLICATION_PDF
                        : MediaType.parseMediaType(inlineImage ? type : "application/octet-stream"))
                .body(bytes);
    }

    @Scheduled(initialDelay = 30_000, fixedDelayString = "${app.attachment-sync-delay:60000}")
    public void syncLocalFiles() {
        if (!files.available()) return;
        try {
            List<Map<String, Object>> rows = jdbc.queryForList(
                    "SELECT id, document_id, file_name, content_type, size_bytes FROM attachments ORDER BY id");
            Set<Long> knownIds = new HashSet<>();
            for (Map<String, Object> row : rows) {
                long id = ((Number) row.get("id")).longValue();
                knownIds.add(id);
                long documentId = ((Number) row.get("document_id")).longValue();
                String name = (String) row.get("file_name");
                String type = (String) row.get("content_type");
                long size = ((Number) row.get("size_bytes")).longValue();
                if (files.present(documentId, id, name, type, size)) continue;
                try {
                    byte[] bytes = jdbc.queryForObject("SELECT data FROM attachments WHERE id = ?", byte[].class, id);
                    if (bytes != null) files.store(documentId, id, name, type, bytes);
                } catch (Exception error) {
                    log.warn("Could not synchronize attachment {} to local disk", id, error);
                }
            }
            files.removeOrphans(knownIds);
        } catch (Exception error) {
            log.warn("Could not synchronize local attachments", error);
        }
    }

    private void requireDocument(long id) {
        Integer count = jdbc.queryForObject("SELECT COUNT(*) FROM documents WHERE id = ? AND deleted_at IS NULL",
                Integer.class, id);
        if (count == null || count == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
    }
}
