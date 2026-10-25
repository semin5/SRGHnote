package sarangit.semin5.notion;

import static org.junit.jupiter.api.Assertions.*;

import com.sun.net.httpserver.HttpServer;
import jakarta.servlet.http.Cookie;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class PortalAuthTest {
    @Test
    void forwardsBothPortalCookiesForDesignatedBrowser() throws Exception {
        AtomicReference<String> forwarded = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/me", exchange -> {
            forwarded.set(exchange.getRequestHeaders().getFirst("Cookie"));
            byte[] body = "{\"username\":\"tester\",\"displayName\":\"Test\",\"role\":\"USER\"}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            try (var stream = exchange.getResponseBody()) { stream.write(body); }
        });
        server.start();
        try {
            PortalAuth auth = new PortalAuth("http://127.0.0.1:" + server.getAddress().getPort() + "/me");
            MockHttpServletRequest request = new MockHttpServletRequest();
            String deviceSecret = "A".repeat(43);
            request.setCookies(new Cookie("SRGHIT_AUTH", "signed-token"),
                    new Cookie("SRGHIT_DEVICE", deviceSecret));
            assertEquals("tester", auth.resolve(request).username());
            assertEquals("SRGHIT_AUTH=signed-token; SRGHIT_DEVICE=" + deviceSecret, forwarded.get());

            request.setCookies(new Cookie("SRGHIT_AUTH", "ordinary-token"));
            assertEquals("tester", auth.resolve(request).username());
            assertEquals("SRGHIT_AUTH=ordinary-token", forwarded.get());
        } finally {
            server.stop(0);
        }
    }
}
