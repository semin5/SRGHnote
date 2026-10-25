package sarangit.semin5.notion;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/events")
public class ChangeStreamController {
    private final JdbcTemplate jdbc;
    private final CopyOnWriteArrayList<SseEmitter> clients = new CopyOnWriteArrayList<>();
    private volatile long lastEvent;

    public ChangeStreamController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
        Long newest = jdbc.queryForObject("SELECT COALESCE(MAX(id), 0) FROM change_events", Long.class);
        lastEvent = newest == null ? 0 : newest;
    }

    @GetMapping(produces = "text/event-stream")
    public SseEmitter subscribe() throws IOException {
        SseEmitter emitter = new SseEmitter(25 * 60 * 1000L);
        clients.add(emitter);
        emitter.onCompletion(() -> clients.remove(emitter));
        emitter.onTimeout(() -> clients.remove(emitter));
        emitter.onError(error -> clients.remove(emitter));
        emitter.send(SseEmitter.event().name("connected").data(Map.of("ok", true)));
        return emitter;
    }

    @Scheduled(fixedDelay = 2000)
    public void publishChanges() {
        List<Map<String, Object>> events = jdbc.queryForList(
                "SELECT id, document_id, change_type, changed_by FROM change_events WHERE id > ? ORDER BY id LIMIT 200",
                lastEvent);
        for (Map<String, Object> event : events) {
            lastEvent = ((Number) event.get("id")).longValue();
            for (SseEmitter client : clients) {
                try { client.send(SseEmitter.event().name("change").id(String.valueOf(lastEvent)).data(event)); }
                catch (Exception error) { client.complete(); clients.remove(client); }
            }
        }
    }
}
