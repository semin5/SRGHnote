package sarangit.semin5.notion;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class AttachmentFileStore {
    private static final Pattern STORED_FILE = Pattern.compile("^(\\d+)-.+");
    private final Path root;
    private final Path requiredMount;

    AttachmentFileStore(String root) {
        this(root, "");
    }

    @Autowired
    public AttachmentFileStore(@Value("${app.attachments-root:/mnt/sarangit/srgh/note}") String root,
                               @Value("${app.attachments-required-mount:/mnt/sarangit}") String requiredMount) {
        this.root = Path.of(root).toAbsolutePath().normalize();
        this.requiredMount = requiredMount.isBlank() ? null : Path.of(requiredMount).toAbsolutePath().normalize();
        if (this.requiredMount != null && !this.root.startsWith(this.requiredMount)) {
            throw new IllegalArgumentException("Attachment root must be inside the required mount");
        }
    }

    boolean available() {
        if (requiredMount == null) return true;
        try (Stream<String> mounts = Files.lines(Path.of("/proc/self/mountinfo"))) {
            return mounts.anyMatch(line -> {
                String[] fields = line.split(" ", 6);
                return fields.length >= 5 && fields[4].equals(requiredMount.toString());
            });
        } catch (IOException error) {
            return false;
        }
    }

    private void requireMount() throws IOException {
        if (!available()) throw new IOException("Attachment mount is not available: " + requiredMount);
    }

    Path pathFor(long documentId, long attachmentId, String name, String contentType) {
        String category = contentType != null && contentType.toLowerCase(Locale.ROOT).startsWith("image/")
                ? "images" : "files";
        String safeName = name.replaceAll("[^\\p{L}\\p{N}._ -]", "_").replaceAll("^\\.+", "").trim();
        if (safeName.isEmpty()) safeName = "attachment";
        if (safeName.length() > 120) safeName = safeName.substring(0, 120);
        Path path = root.resolve(category).resolve(Long.toString(documentId))
                .resolve(attachmentId + "-" + safeName).normalize();
        if (!path.startsWith(root)) throw new IllegalArgumentException("Invalid attachment path");
        return path;
    }

    boolean present(long documentId, long attachmentId, String name, String contentType, long size) {
        if (!available()) return false;
        Path path = pathFor(documentId, attachmentId, name, contentType);
        try {
            return Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) && Files.size(path) == size;
        } catch (IOException error) {
            return false;
        }
    }

    byte[] read(long documentId, long attachmentId, String name, String contentType, long size) throws IOException {
        if (!present(documentId, attachmentId, name, contentType, size)) return null;
        return Files.readAllBytes(pathFor(documentId, attachmentId, name, contentType));
    }

    void store(long documentId, long attachmentId, String name, String contentType, byte[] bytes) throws IOException {
        requireMount();
        Path path = pathFor(documentId, attachmentId, name, contentType);
        Files.createDirectories(path.getParent());
        Path temporary = path.resolveSibling("." + attachmentId + "-" + UUID.randomUUID() + ".tmp");
        try {
            Files.write(temporary, bytes);
            try {
                Files.move(temporary, path, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (java.nio.file.AtomicMoveNotSupportedException error) {
                Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }

    void remove(long documentId, long attachmentId, String name, String contentType) throws IOException {
        requireMount();
        Files.deleteIfExists(pathFor(documentId, attachmentId, name, contentType));
    }

    void removeOrphans(Set<Long> knownIds) throws IOException {
        requireMount();
        Instant cutoff = Instant.now().minus(1, ChronoUnit.HOURS);
        for (String category : new String[]{"images", "files"}) {
            Path categoryPath = root.resolve(category);
            if (!Files.isDirectory(categoryPath, LinkOption.NOFOLLOW_LINKS)) continue;
            try (Stream<Path> documents = Files.list(categoryPath)) {
                for (Path directory : documents.toList()) {
                    if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) continue;
                    try (Stream<Path> entries = Files.list(directory)) {
                        for (Path entry : entries.toList()) {
                            if (!Files.isRegularFile(entry, LinkOption.NOFOLLOW_LINKS)) continue;
                            Matcher match = STORED_FILE.matcher(entry.getFileName().toString());
                            if (!match.matches() || knownIds.contains(Long.parseLong(match.group(1)))) continue;
                            if (Files.getLastModifiedTime(entry).toInstant().isBefore(cutoff)) Files.deleteIfExists(entry);
                        }
                    }
                    try { Files.delete(directory); } catch (java.nio.file.DirectoryNotEmptyException ignored) { }
                }
            }
        }
    }
}
