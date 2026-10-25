package sarangit.semin5.notion;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class NotionApplication {
    public static void main(String[] args) {
        SpringApplication.run(NotionApplication.class, args);
    }
}
