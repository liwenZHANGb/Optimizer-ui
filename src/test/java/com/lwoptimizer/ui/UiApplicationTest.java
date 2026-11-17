package com.lwoptimizer.ui;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** The interface is static files plus one generated script telling the pages where the API is. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "lw.api-url=http://optimizer.example:9000/")
class UiApplicationTest {

    @Autowired
    private TestRestTemplate http;

    @Test
    void thePagesAreToldWhereTheApiIs() {
        ResponseEntity<String> config = http.getForEntity("/config.js", String.class);

        assertEquals(HttpStatus.OK, config.getStatusCode());
        assertEquals("window.LW_API_URL = \"http://optimizer.example:9000\";\n", config.getBody());
        assertTrue(config.getHeaders().getCacheControl().contains("no-store"));
    }

    @Test
    void thePageItsScriptsAndTheMapLibraryAreServed() {
        String page = http.getForObject("/", String.class);
        assertTrue(page.contains("<title>LW Optimizer</title>"));
        assertTrue(page.contains("/config.js"));

        assertTrue(page.contains("/js/boot.js"), "theme and language are set before the page is drawn");

        for (String file : new String[] {"/js/app.js", "/js/boot.js", "/js/i18n.js", "/js/lang/en.js", "/js/lang/fr.js",
                "/js/lang/zh.js", "/js/rules.js", "/js/import.js", "/js/views/jobshop.js", "/js/views/timetable.js", "/js/views/stocksizing.js", "/js/views/bltasp.js", "/js/views/blvrp.js", "/js/views/tasks.js", "/js/views/vrp.js", "/js/views/stock.js",
                "/js/views/carpool.js", "/css/app.css", "/webjars/leaflet/1.9.4/leaflet.js"}) {
            assertEquals(HttpStatus.OK, http.getForEntity(file, String.class).getStatusCode(), file);
        }
    }

    @Test
    void thereIsNoOptimizationEndpointHere() {
        // Optimizing is the API's job: this application answers nothing under /api.
        assertEquals(HttpStatus.NOT_FOUND, http.getForEntity("/api/vrp/problem", String.class).getStatusCode());
    }
}
