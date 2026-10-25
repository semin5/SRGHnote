package sarangit.semin5.notion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

class AttachmentControllerTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final AttachmentFileStore files = mock(AttachmentFileStore.class);
    private final AttachmentController controller = new AttachmentController(jdbc, files);

    @Test
    void pdfPreviewIsInlineWhileOriginalLinkStillDownloads() throws Exception {
        byte[] pdf = "%PDF-1.7\npreview".getBytes(StandardCharsets.US_ASCII);
        stubFile(7L, "manual.pdf", "application/pdf", pdf);

        var preview = controller.preview(7L);
        assertThat(preview.getHeaders().getContentType()).isEqualTo(MediaType.APPLICATION_PDF);
        assertThat(preview.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION)).startsWith("inline;");
        assertThat(preview.getBody()).isEqualTo(pdf);

        var download = controller.download(7L);
        assertThat(download.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION)).startsWith("attachment;");
    }

    @Test
    void nonPdfCannotBeEmbedded() throws Exception {
        stubFile(8L, "not-a-pdf.pdf", "application/pdf", "hello".getBytes(StandardCharsets.US_ASCII));
        assertThatThrownBy(() -> controller.preview(8L))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("415");
    }

    @Test
    void zipDownloadsWithItsOriginalKoreanFilename() throws Exception {
        byte[] zip = { 'P', 'K', 3, 4, 0, 0 };
        stubFile(9L, "순번대기표 이미지.zip", "application/zip", zip);

        var download = controller.download(9L);
        String disposition = download.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION);
        assertThat(disposition).startsWith("attachment;");
        assertThat(disposition).contains("filename*=");
        assertThat(org.springframework.http.ContentDisposition.parse(disposition).getFilename())
                .isEqualTo("순번대기표 이미지.zip");
        assertThat(download.getBody()).isEqualTo(zip);
    }

    private void stubFile(long id, String name, String type, byte[] content) throws Exception {
        when(jdbc.queryForList(anyString(), eq(id))).thenReturn(List.of(Map.of(
                "document_id", 1L, "file_name", name, "content_type", type, "size_bytes", (long) content.length)));
        when(files.read(1L, id, name, type, content.length)).thenReturn(content);
    }
}
