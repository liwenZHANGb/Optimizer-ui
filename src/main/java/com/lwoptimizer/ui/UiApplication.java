package com.lwoptimizer.ui;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;

/**
 * REST API and web interface of the LW Optimizer use cases.
 *
 * <ul>
 *   <li>{@code /} the interface;</li>
 *   <li>{@code /api/<use case>/...} one REST API per use case;</li>
 *   <li>{@code /swagger-ui.html} the interactive documentation of those APIs,
 *       {@code /v3/api-docs} their OpenAPI description.</li>
 * </ul>
 */
@SpringBootApplication
public class UiApplication {

    public static void main(String[] args) {
        SpringApplication.run(UiApplication.class, args);
    }

    @Bean
    OpenAPI apiDescription() {
        return new OpenAPI().info(new Info()
                .title("LW Optimizer API")
                .version("0.1.0")
                .description("""
                        One API per optimization use case. They all work the same way:

                        1. `GET /problem` returns a ready-made problem, and `GET /configuration` the settings \
                        and constraints that can be tuned, with their defaults.
                        2. `POST /jobs` starts an optimization and returns a job id. The plan in the request \
                        may already carry an assignment and pins: the solver then starts from it and leaves \
                        what is pinned untouched (rescheduling).
                        3. `GET /jobs/{id}` returns the state of the job and its best plan so far; \
                        `GET /jobs/{id}/events` streams every improvement as it is found; \
                        `DELETE /jobs/{id}` stops the job early.
                        4. `POST /analysis` scores a plan without solving it.
                        """));
    }
}
