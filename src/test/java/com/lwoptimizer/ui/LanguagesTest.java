package com.lwoptimizer.ui;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The three languages and the two themes stay complete: a text added in English without its
 * French and Chinese versions, a key used by a script that no dictionary has, or a colour
 * written outside the theme tokens, fails here rather than showing up on a screen.
 */
class LanguagesTest {

    private static final Path STATIC = Path.of("src/main/resources/static");
    private static final Pattern ENTRY = Pattern.compile("^\\s*'((?:[^'\\\\]|\\\\.)+)':", Pattern.MULTILINE);

    private static String read(String file) throws IOException {
        return Files.readString(STATIC.resolve(file), StandardCharsets.UTF_8);
    }

    private static Set<String> keys(String language) throws IOException {
        Set<String> keys = new TreeSet<>();
        Matcher matcher = ENTRY.matcher(read("js/lang/" + language + ".js"));
        while (matcher.find()) {
            keys.add(matcher.group(1));
        }
        return keys;
    }

    @Test
    void frenchAndChineseCoverEveryEnglishText() throws IOException {
        Set<String> english = keys("en");
        assertTrue(english.size() > 200, "the English dictionary was read");
        for (String language : List.of("fr", "zh")) {
            Set<String> missing = new TreeSet<>(english);
            missing.removeAll(keys(language));
            assertEquals(Set.of(), missing, "texts missing in " + language);
        }
        // What the API words in English is translated in both other languages, or in neither.
        Set<String> french = keys("fr");
        french.removeAll(english);
        Set<String> chinese = keys("zh");
        chinese.removeAll(english);
        assertEquals(french, chinese);
        assertTrue(french.contains("constraint.vehicle-capacity") && french.contains("finding.violation-not-penalized"));
    }

    @Test
    void everyTextAScriptOrThePageAsksForExists() throws IOException {
        Set<String> english = keys("en");
        List<Path> files = new ArrayList<>();
        try (Stream<Path> scripts = Files.walk(STATIC.resolve("js"))) {
            scripts.filter(path -> path.toString().endsWith(".js") && !path.toString().contains("lang")).forEach(files::add);
        }
        files.add(STATIC.resolve("index.html"));
        Pattern used = Pattern.compile("\\bt\\('([^']+)'|data-i18n(?:-title)?=\"([^\"]+)\"");
        Set<String> unknown = new TreeSet<>();
        for (Path file : files) {
            Matcher matcher = used.matcher(Files.readString(file, StandardCharsets.UTF_8));
            while (matcher.find()) {
                String key = matcher.group(1) != null ? matcher.group(1) : matcher.group(2);
                if (!english.contains(key)) {
                    unknown.add(key + " (" + file.getFileName() + ")");
                }
            }
        }
        assertEquals(Set.of(), unknown);
    }

    @Test
    void everyColourIsAThemeToken() throws IOException {
        String css = read("css/app.css");
        assertTrue(css.contains(":root[data-theme=\"light\"]"), "the light theme redefines the tokens");
        String rules = css.substring(css.indexOf("* { box-sizing"));
        Matcher literal = Pattern.compile("#[0-9a-fA-F]{3,8}\\b|rgba?\\(").matcher(rules);
        List<String> literals = new ArrayList<>();
        while (literal.find()) {
            literals.add(literal.group());
        }
        // The knob of a switch is white in both themes; nothing else names a colour.
        assertEquals(List.of("#fff"), literals);

        // Each token of the dark theme has its light counterpart.
        String dark = css.substring(css.indexOf(":root {"), css.indexOf(":root[data-theme=\"light\"]"));
        String light = css.substring(css.indexOf(":root[data-theme=\"light\"]"), css.indexOf("* { box-sizing"));
        Matcher token = Pattern.compile("(--[a-z0-9-]+):\\s*(?:#|rgba?\\(|invert|none)").matcher(dark);
        Set<String> missing = new TreeSet<>();
        while (token.find()) {
            if (!light.contains(token.group(1) + ":")) {
                missing.add(token.group(1));
            }
        }
        assertEquals(Set.of(), missing);
    }
}
