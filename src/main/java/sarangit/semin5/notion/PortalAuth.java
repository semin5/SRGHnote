package sarangit.semin5.notion;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class PortalAuth extends OncePerRequestFilter {
    private static final String PORTAL_COOKIE = "SRGHIT_AUTH";
    private static final String DEVICE_COOKIE = "SRGHIT_DEVICE";
    private final RestClient client;
    private final String portalMeUrl;

    public record User(String username, String displayName, String role) {
        public boolean admin() { return "ADMIN".equals(role) || "SUPER_ADMIN".equals(role); }
    }
    private record Identity(String username, String displayName, String role) {}

    public PortalAuth(@Value("${app.portal-me-url}") String portalMeUrl) {
        this.portalMeUrl = portalMeUrl;
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(2000);
        this.client = RestClient.builder().requestFactory(factory).build();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        if (!path.startsWith("/api/")) {
            chain.doFilter(request, response);
            return;
        }
        User user;
        try {
            user = resolve(request);
        } catch (PortalUnavailable error) {
            response.sendError(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
            return;
        }
        if (user == null) {
            response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }
        request.setAttribute("notionUser", user);
        chain.doFilter(request, response);
    }

    public User resolve(HttpServletRequest request) {
        String token = null;
        String deviceToken = null;
        if (request.getCookies() != null) {
            for (Cookie cookie : request.getCookies()) {
                if (PORTAL_COOKIE.equals(cookie.getName())) token = cookie.getValue();
                if (DEVICE_COOKIE.equals(cookie.getName())) deviceToken = cookie.getValue();
            }
        }
        if (token == null || token.isBlank()) return null;
        try {
            String cookieHeader = PORTAL_COOKIE + "=" + token;
            if (deviceToken != null && deviceToken.matches("[A-Za-z0-9_-]{43}"))
                cookieHeader += "; " + DEVICE_COOKIE + "=" + deviceToken;
            Identity identity = client.get().uri(portalMeUrl)
                    .header(HttpHeaders.COOKIE, cookieHeader)
                    .retrieve().body(Identity.class);
            if (identity == null || identity.username() == null || identity.username().isBlank()) return null;
            return new User(identity.username(), identity.displayName(), identity.role());
        } catch (HttpClientErrorException error) {
            return null;
        } catch (RestClientException error) {
            throw new PortalUnavailable(error);
        }
    }

    private static final class PortalUnavailable extends RuntimeException {
        private PortalUnavailable(Throwable cause) { super(cause); }
    }
}
