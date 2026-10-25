package sarangit.semin5.notion;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

class DocumentControllerTest {
    private final PortalAuth.User user = new PortalAuth.User("test", "Tester", "ADMIN");

    @Test
    void savesListAndCardViewPerUser() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        DocumentController controller = new DocumentController(jdbc, new ObjectMapper());
        assertThat(controller.preferences(user)).containsEntry("pageSize", 20).containsEntry("viewMode", "AUTO");
        assertThat(controller.preferences(new DocumentController.PreferenceInput(20, "AUTO"), user))
                .containsEntry("pageSize", 20).containsEntry("viewMode", "AUTO");
        assertThat(controller.preferences(new DocumentController.PreferenceInput(50, "CARD"), user))
                .containsEntry("pageSize", 50).containsEntry("viewMode", "CARD");
        verify(jdbc).update(contains("view_mode = COALESCE"),
                org.mockito.ArgumentMatchers.eq("test"), org.mockito.ArgumentMatchers.eq(50),
                org.mockito.ArgumentMatchers.eq("CARD"), org.mockito.ArgumentMatchers.eq("CARD"));
        assertThatThrownBy(() -> controller.preferences(new DocumentController.PreferenceInput(20, "GRID"), user))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
        assertThatThrownBy(() -> controller.preferences(new DocumentController.PreferenceInput(50, "AUTO"), user))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
    }

    @Test
    void documentListOrdersNewestCreatedPagesFirst() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        new DocumentController(jdbc, new ObjectMapper()).list();
        verify(jdbc).queryForList(contains("ORDER BY parent_id, created_at DESC, id DESC"));
    }

    @Test
    void onlyAdminCanCreateTopLevelFolder() {
        DocumentController controller = new DocumentController(mock(JdbcTemplate.class), new ObjectMapper());
        assertThatThrownBy(() -> controller.create(
                new DocumentController.Input("제목", "{\"type\":\"script\"}", null, null),
                new PortalAuth.User("reader", "Reader", "USER")))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("403");
        assertThatThrownBy(() -> controller.create(
                new DocumentController.Input("제목", "{\"type\":\"script\"}", null, null), user))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
    }

    @Test
    void lockedTopLevelStillAllowsAddingChildren() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), org.mockito.ArgumentMatchers.eq(8L)))
                .thenReturn(List.of(Map.of("id", 8L, "created_by", "owner", "locked_for_others", true)));
        DocumentController controller = new DocumentController(jdbc, new ObjectMapper());
        assertThatThrownBy(() -> controller.create(
                new DocumentController.Input("하위 페이지", "{\"type\":\"script\"}", 8L, null),
                new PortalAuth.User("reader", "Reader", "USER")))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
    }

    @Test
    void onlyAdminCanUpdateTopLevelPage() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), org.mockito.ArgumentMatchers.eq(8L)))
                .thenReturn(List.of(Map.of("id", 8L, "created_by", "owner", "locked_for_others", false)));
        DocumentController controller = new DocumentController(jdbc, new ObjectMapper());
        assertThatThrownBy(() -> controller.update(8L,
                new DocumentController.Input("제목", "{\"type\":\"script\"}", null, 1L),
                new PortalAuth.User("reader", "Reader", "USER")))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("403");
        assertThatThrownBy(() -> controller.update(8L,
                new DocumentController.Input("제목", "{\"type\":\"script\"}", null, 1L), user))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
    }

    @Test
    void onlySuperAdminCanMoveTopLevelFolderToTrash() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(contains("FROM documents WHERE id = ? AND deleted_at IS NULL"),
                org.mockito.ArgumentMatchers.eq(8L)))
                .thenReturn(List.of(Map.of("id", 8L, "created_by", "owner", "locked_for_others", false)));
        DocumentController controller = new DocumentController(jdbc, new ObjectMapper());
        assertThatThrownBy(() -> controller.delete(8L,
                new PortalAuth.User("reader", "Reader", "USER")))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("403");
        assertThatThrownBy(() -> controller.delete(8L, user))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("403");
        assertThatCode(() -> controller.delete(8L,
                new PortalAuth.User("super", "Super", "SUPER_ADMIN"))).doesNotThrowAnyException();
    }

    @Test
    void adminCanRestoreButOnlySuperAdminCanPermanentlyDeleteTopLevelFolder() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(contains("FROM documents WHERE id = ? AND deleted_at IS NOT NULL"),
                org.mockito.ArgumentMatchers.eq(8L)))
                .thenReturn(List.of(Map.of("id", 8L, "created_by", "owner", "locked_for_others", false,
                        "deleted_at", Timestamp.valueOf("2026-10-13 09:00:00"))));
        DocumentController controller = new DocumentController(jdbc, new ObjectMapper());
        PortalAuth.User owner = new PortalAuth.User("owner", "Owner", "USER");
        assertThatThrownBy(() -> controller.restore(8L, owner))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("403");
        assertThatThrownBy(() -> controller.permanentDelete(8L, owner))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("403");
        assertThatCode(() -> controller.restore(8L, user)).doesNotThrowAnyException();
        assertThatThrownBy(() -> controller.permanentDelete(8L, user))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("403");
        assertThatCode(() -> controller.permanentDelete(8L,
                new PortalAuth.User("super", "Super", "SUPER_ADMIN"))).doesNotThrowAnyException();
    }

    @Test
    void creatorLockBlocksEveryoneExceptCreator() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), org.mockito.ArgumentMatchers.eq(8L)))
                .thenReturn(List.of(Map.of("id", 8L, "parent_id", 2L, "created_by", "owner", "locked_for_others", true)));
        DocumentController controller = new DocumentController(jdbc, new ObjectMapper());
        assertThatThrownBy(() -> controller.update(8L,
                new DocumentController.Input("제목", "{\"type\":\"script\"}", null, 1L),
                new PortalAuth.User("reader", "Reader", "USER")))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("403");
        assertThatThrownBy(() -> controller.update(8L,
                new DocumentController.Input("제목", "{\"type\":\"script\"}", null, 1L), user))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("403");
        assertThatThrownBy(() -> controller.update(8L,
                new DocumentController.Input("제목", "{\"type\":\"script\"}", null, 1L),
                new PortalAuth.User("owner", "Owner", "USER")))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
    }

    @Test
    void rejectsNonEditorJsonAndOversizedTitle() {
        DocumentController controller = new DocumentController(mock(JdbcTemplate.class), new ObjectMapper());
        assertThatThrownBy(() -> controller.create(
                new DocumentController.Input("제목", "{\"type\":\"script\"}", null, null), user))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
        assertThatThrownBy(() -> controller.create(
                new DocumentController.Input("x".repeat(201), null, null, null), user))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("400");
    }

    @Test
    void rejectsStaleDocumentVersionInsteadOfOverwriting() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), org.mockito.ArgumentMatchers.eq(8L)))
                .thenReturn(List.of(Map.of("id", 8L, "parent_id", 2L, "version", 2L)));
        DocumentController controller = new DocumentController(jdbc, new ObjectMapper());
        assertThatThrownBy(() -> controller.update(8L,
                new DocumentController.Input("제목", "{\"type\":\"doc\"}", null, 1L), user))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
    }
}
