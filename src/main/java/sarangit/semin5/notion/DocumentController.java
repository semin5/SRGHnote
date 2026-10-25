package sarangit.semin5.notion;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import com.fasterxml.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/api/documents")
public class DocumentController {
    private static final String EMPTY = "{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\"}]}";
    private static final String DETAIL = "SELECT id, parent_id, title, content_json, version, created_by, updated_by, "
            + "COALESCE(created_by_name, created_by) AS created_by_name, "
            + "COALESCE(updated_by_name, updated_by) AS updated_by_name, locked_for_others, "
            + "TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS created_at, "
            + "TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS updated_at "
            + "FROM documents WHERE id = ? AND deleted_at IS NULL";
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public record Input(String title, String contentJson, Long parentId, Long version) {}
    public record OrderInput(List<Long> ids) {}
    public record LockInput(boolean locked) {}
    public record PreferenceInput(int pageSize, String viewMode) {}

    public DocumentController(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return jdbc.queryForList("SELECT id, parent_id, title, content_json, version, created_by, updated_by, "
                + "COALESCE(created_by_name, created_by) AS created_by_name, "
                + "COALESCE(updated_by_name, updated_by) AS updated_by_name, locked_for_others, "
                + "TO_CHAR(created_at, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS created_at, "
                + "TO_CHAR(updated_at, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS updated_at "
                + "FROM documents WHERE deleted_at IS NULL ORDER BY parent_id, created_at DESC, id DESC");
    }

    @GetMapping("/preferences")
    public Map<String, Object> preferences(@RequestAttribute("notionUser") PortalAuth.User user) {
        List<Map<String, Object>> settings = jdbc.queryForList(
                "SELECT page_size, view_mode FROM document_user_preferences WHERE username = ?", user.username());
        if (settings.isEmpty()) return Map.of("pageSize", 20, "viewMode", "AUTO");
        Map<String, Object> setting = settings.get(0);
        return Map.of("pageSize", ((Number) setting.get("page_size")).intValue(),
                "viewMode", setting.get("view_mode"));
    }

    @PutMapping("/preferences")
    public Map<String, Object> preferences(@RequestBody PreferenceInput input,
            @RequestAttribute("notionUser") PortalAuth.User user) {
        if (input.pageSize() != 20 && input.pageSize() != 50 && input.pageSize() != 100)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "pageSize must be 20, 50 or 100");
        String mode = input.viewMode();
        if (mode != null && !mode.equals("AUTO") && !mode.equals("LIST") && !mode.equals("CARD"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "viewMode must be AUTO, LIST or CARD");
        if ("AUTO".equals(mode) && input.pageSize() != 20)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "AUTO view uses pageSize 20");
        jdbc.update("INSERT INTO document_user_preferences (username, page_size, view_mode) "
                + "VALUES (?, ?, COALESCE(?, 'AUTO')) ON CONFLICT (username) DO UPDATE "
                + "SET page_size = EXCLUDED.page_size, view_mode = COALESCE(?, document_user_preferences.view_mode)",
                user.username(), input.pageSize(), mode, mode);
        return Map.of("pageSize", input.pageSize(), "viewMode", mode == null ? "AUTO" : mode);
    }

    @GetMapping("/order")
    public List<Long> order(@RequestAttribute("notionUser") PortalAuth.User user) {
        return jdbc.queryForList("SELECT document_id FROM document_user_order WHERE username = ? ORDER BY sort_order, document_id",
                Long.class, user.username());
    }

    @PutMapping("/order")
    @Transactional
    public void order(@RequestBody OrderInput input, @RequestAttribute("notionUser") PortalAuth.User user) {
        List<Long> ids = input.ids();
        if (ids == null || ids.size() > 10000 || ids.contains(null) || new LinkedHashSet<>(ids).size() != ids.size())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        List<Long> roots = jdbc.queryForList("SELECT id FROM documents WHERE parent_id IS NULL AND deleted_at IS NULL", Long.class);
        if (roots.size() != ids.size() || !new HashSet<>(roots).equals(new HashSet<>(ids)))
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Top-level pages changed; reload and retry");
        jdbc.update("DELETE FROM document_user_order WHERE username = ?", user.username());
        for (int i = 0; i < ids.size(); i++)
            jdbc.update("INSERT INTO document_user_order (username, document_id, sort_order) VALUES (?, ?, ?)",
                    user.username(), ids.get(i), i);
    }

    @GetMapping("/trash")
    public List<Map<String, Object>> trash() {
        return jdbc.queryForList("SELECT id, parent_id, title, created_by, locked_for_others, updated_by, "
                + "TO_CHAR(deleted_at, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS deleted_at "
                + "FROM documents WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC");
    }

    @GetMapping("/{id}")
    public Map<String, Object> detail(@PathVariable long id) { return find(id); }

    private Map<String, Object> find(long id) {
        return jdbc.queryForList(DETAIL, id).stream().findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    @PostMapping
    @Transactional
    public Map<String, Object> create(@RequestBody Input input, @RequestAttribute("notionUser") PortalAuth.User user) {
        if (input.parentId() == null) {
            if (!user.admin()) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        } else {
            Map<String, Object> parent = find(input.parentId());
            if (parent.get("parent_id") != null) requireUnlocked(parent, user);
        }
        String title = title(input.title());
        String content = content(input.contentJson() == null ? EMPTY : input.contentJson());
        GeneratedKeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(
                    "INSERT INTO documents (parent_id, title, content_json, created_by, updated_by, created_by_name, updated_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    new String[]{"id"});
            if (input.parentId() == null) statement.setNull(1, java.sql.Types.BIGINT);
            else statement.setLong(1, input.parentId());
            statement.setString(2, title);
            statement.setString(3, content);
            statement.setString(4, user.username());
            statement.setString(5, user.username());
            statement.setString(6, displayName(user));
            statement.setString(7, displayName(user));
            return statement;
        }, keys);
        long id = keys.getKey().longValue();
        event(id, "created", user.username());
        return find(id);
    }

    @PutMapping("/{id}")
    @Transactional
    public Map<String, Object> update(@PathVariable long id, @RequestBody Input input,
                                      @RequestAttribute("notionUser") PortalAuth.User user) {
        if (input.version() == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Version required");
        requireWrite(find(id), user);
        String title = title(input.title());
        String content = content(input.contentJson());
        int changed = jdbc.update("UPDATE documents SET title = ?, content_json = ?, updated_by = ?, updated_by_name = ?, "
                        + "version = version + 1, updated_at = CURRENT_TIMESTAMP(3) "
                        + "WHERE id = ? AND version = ? AND deleted_at IS NULL",
                title, content, user.username(), displayName(user), id, input.version());
        if (changed == 0) {
            find(id);
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This page changed elsewhere. Reload before saving.");
        }
        event(id, "updated", user.username());
        return find(id);
    }

    @DeleteMapping("/{id}")
    @Transactional
    public void delete(@PathVariable long id, @RequestAttribute("notionUser") PortalAuth.User user) {
        Map<String, Object> page = find(id);
        requireDelete(page, user);
        Timestamp deletedAt = Timestamp.valueOf(LocalDateTime.now());
        for (long documentId : descendants(id, false)) {
            jdbc.update("UPDATE documents SET deleted_at = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP(3) "
                    + "WHERE id = ? AND deleted_at IS NULL", deletedAt, user.username(), documentId);
            event(documentId, "deleted", user.username());
        }
    }

    @PostMapping("/{id}/restore")
    @Transactional
    public void restore(@PathVariable long id, @RequestAttribute("notionUser") PortalAuth.User user) {
        Map<String, Object> page = deleted(id);
        if (page.get("parent_id") == null) {
            if (!user.admin())
                throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        } else requireUnlocked(page, user);
        Number parent = (Number) page.get("parent_id");
        if (parent != null) {
            Integer activeParent = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM documents WHERE id = ? AND deleted_at IS NULL", Integer.class, parent.longValue());
            if (activeParent == null || activeParent == 0)
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Restore the parent page first");
        }
        Object deletedValue = page.get("deleted_at");
        LocalDateTime deletedAt = deletedValue instanceof Timestamp timestamp
                ? timestamp.toLocalDateTime() : (LocalDateTime) deletedValue;
        for (long documentId : descendants(id, true)) {
            int changed = jdbc.update("UPDATE documents SET deleted_at = NULL, updated_by = ?, updated_at = CURRENT_TIMESTAMP(3) "
                    + "WHERE id = ? AND deleted_at = ?", user.username(), documentId, deletedAt);
            if (changed > 0) event(documentId, "restored", user.username());
        }
    }

    @DeleteMapping("/{id}/permanent")
    @Transactional
    public void permanentDelete(@PathVariable long id, @RequestAttribute("notionUser") PortalAuth.User user) {
        Map<String, Object> page = deleted(id);
        requireDelete(page, user);
        List<Long> ids = descendants(id, true);
        for (long documentId : ids) {
            Integer active = jdbc.queryForObject(
                    "SELECT COUNT(*) FROM documents WHERE id = ? AND deleted_at IS NULL", Integer.class, documentId);
            if (active != null && active > 0)
                throw new ResponseStatusException(HttpStatus.CONFLICT, "An active child page remains");
        }
        for (int index = ids.size() - 1; index >= 0; index--) {
            long documentId = ids.get(index);
            jdbc.update("DELETE FROM attachments WHERE document_id = ?", documentId);
            jdbc.update("DELETE FROM documents WHERE id = ? AND deleted_at IS NOT NULL", documentId);
        }
        event(id, "purged", user.username());
    }

    private Map<String, Object> deleted(long id) {
        return jdbc.queryForList("SELECT id, parent_id, created_by, locked_for_others, deleted_at FROM documents WHERE id = ? AND deleted_at IS NOT NULL", id)
                .stream().findFirst().orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    @PutMapping("/{id}/lock")
    @Transactional
    public Map<String, Object> lock(@PathVariable long id, @RequestBody LockInput input,
                                    @RequestAttribute("notionUser") PortalAuth.User user) {
        Map<String, Object> page = find(id);
        if (page.get("parent_id") == null) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        if (!user.username().equals(page.get("created_by"))) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        jdbc.update("UPDATE documents SET locked_for_others = ? WHERE id = ?", input.locked(), id);
        event(id, "locked", user.username());
        return find(id);
    }

    private void requireWrite(Map<String, Object> page, PortalAuth.User user) {
        if (page.get("parent_id") == null && !user.admin()) throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        requireUnlocked(page, user);
    }

    private void requireDelete(Map<String, Object> page, PortalAuth.User user) {
        if (page.get("parent_id") == null && !"SUPER_ADMIN".equals(user.role()))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
        requireUnlocked(page, user);
    }

    private void requireUnlocked(Map<String, Object> page, PortalAuth.User user) {
        if (Boolean.TRUE.equals(page.get("locked_for_others"))
                && !user.username().equals(page.get("created_by")))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN);
    }

    private String displayName(PortalAuth.User user) {
        return user.displayName() == null || user.displayName().isBlank() ? user.username() : user.displayName();
    }

    private List<Long> descendants(long root, boolean includeDeleted) {
        List<Long> ids = new ArrayList<>();
        Set<Long> visited = new HashSet<>();
        ids.add(root);
        visited.add(root);
        for (int index = 0; index < ids.size(); index++) {
            String sql = "SELECT id FROM documents WHERE parent_id = ?" + (includeDeleted ? "" : " AND deleted_at IS NULL");
            for (Long child : jdbc.queryForList(sql, Long.class, ids.get(index))) {
                if (visited.add(child)) ids.add(child);
            }
        }
        return ids;
    }

    private String title(String value) {
        String clean = value == null || value.isBlank() ? "제목 없음" : value.trim();
        if (clean.length() > 200) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Title too long");
        return clean;
    }

    private String content(String value) {
        if (value == null || value.length() > 2_000_000)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid document size");
        try {
            if (!"doc".equals(mapper.readTree(value).path("type").asText())) throw new IllegalArgumentException();
        } catch (Exception error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid editor document");
        }
        return value;
    }

    private void event(long id, String type, String actor) {
        jdbc.update("INSERT INTO change_events (document_id, change_type, changed_by) VALUES (?, ?, ?)",
                id, type, actor);
    }
}
