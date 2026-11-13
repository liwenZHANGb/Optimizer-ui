package com.lwoptimizer.ui;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Serves the web interface of the LW Optimizer: static pages, styles and scripts.
 *
 * <p>There is no optimization code here. The pages call the REST API of lw-optimizer from
 * the browser; this application only tells them where that API is ({@code /config.js}).
 */
@SpringBootApplication
@RestController
public class UiApplication {

    private final String apiUrl;

    public UiApplication(@Value("${lw.api-url}") String apiUrl) {
        this.apiUrl = apiUrl.replaceAll("/+$", "");
    }

    public static void main(String[] args) {
        SpringApplication.run(UiApplication.class, args);
    }

    /** The one piece of configuration the pages need: the address of the API. */
    @GetMapping(value = "/config.js", produces = "application/javascript")
    public ResponseEntity<String> config() {
        String script = "window.LW_API_URL = " + quote(apiUrl) + ";\n";
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.parseMediaType("application/javascript"))
                .body(script);
    }

    private static String quote(String text) {
        return "\"" + text.replace("\\", "\\\\").replace("\"", "\\\"").replace("<", "\\u003c") + "\"";
    }
}
