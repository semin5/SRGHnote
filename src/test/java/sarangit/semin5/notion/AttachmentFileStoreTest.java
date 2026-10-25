package sarangit.semin5.notion;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AttachmentFileStoreTest {
    @TempDir Path directory;

    @Test
    void sortsImagesAndOtherFilesIntoDocumentFolders() throws Exception {
        AttachmentFileStore store = new AttachmentFileStore(directory.toString());
        byte[] image = {1, 2, 3};
        byte[] file = {4, 5};

        store.store(12, 40, "구성도.png", "image/png", image);
        store.store(12, 41, "설계서.pdf", "application/pdf", file);

        assertThat(Files.readAllBytes(directory.resolve("images/12/40-구성도.png"))).isEqualTo(image);
        assertThat(Files.readAllBytes(directory.resolve("files/12/41-설계서.pdf"))).isEqualTo(file);
        assertThat(store.read(12, 40, "구성도.png", "image/png", image.length)).isEqualTo(image);
        assertThat(store.present(12, 41, "설계서.pdf", "application/pdf", file.length)).isTrue();
    }

    @Test
    void removesUnsafeFileNameCharacters() throws Exception {
        AttachmentFileStore store = new AttachmentFileStore(directory.toString());
        store.store(1, 2, "../name\\test?.txt", "text/plain", new byte[]{9});
        assertThat(store.pathFor(1, 2, "../name\\test?.txt", "text/plain"))
                .startsWith(directory.resolve("files/1"));
        assertThat(store.read(1, 2, "../name\\test?.txt", "text/plain", 1)).containsExactly(9);
    }

    @Test
    void cleansOnlyOldFilesMissingFromDatabase() throws Exception {
        AttachmentFileStore store = new AttachmentFileStore(directory.toString());
        store.store(1, 2, "keep.png", "image/png", new byte[]{1});
        store.store(1, 3, "old.png", "image/png", new byte[]{2});
        Path old = store.pathFor(1, 3, "old.png", "image/png");
        Files.setLastModifiedTime(old, FileTime.from(Instant.now().minus(2, ChronoUnit.HOURS)));

        store.removeOrphans(Set.of(2L));

        assertThat(Files.exists(store.pathFor(1, 2, "keep.png", "image/png"))).isTrue();
        assertThat(Files.exists(old)).isFalse();
    }

    @Test
    void refusesWritesWhenRequiredMountIsOnlyAnOrdinaryDirectory() throws Exception {
        Path mount = directory.resolve("mount");
        Files.createDirectories(mount);
        AttachmentFileStore store = new AttachmentFileStore(mount.resolve("srgh/note").toString(),
                mount.toString());

        assertThat(store.available()).isFalse();
        assertThatThrownBy(() -> store.store(1, 2, "file.pdf", "application/pdf", new byte[]{1}))
                .isInstanceOf(java.io.IOException.class).hasMessageContaining("not available");
        assertThat(Files.exists(mount.resolve("srgh/note"))).isFalse();
    }
}
