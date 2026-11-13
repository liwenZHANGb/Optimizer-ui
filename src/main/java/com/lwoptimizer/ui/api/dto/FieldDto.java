package com.lwoptimizer.ui.api.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

@Schema(description = "One tunable setting: what it is, what values it accepts")
public record FieldDto(
        @Schema(example = "solver.jenetics.populationSize") String key,
        String label,
        @Schema(description = "Section the setting belongs to") String group,
        @Schema(allowableValues = {"number", "select", "boolean", "text"}) String type,
        Double min,
        Double max,
        Double step,
        @Schema(description = "Unit of a number", example = "s") String unit,
        @Schema(description = "Accepted values of a select") List<Option> options,
        @Schema(description = "False when the setting may be left empty") boolean required,
        String help,
        @Schema(description = "The setting only applies when another one has a given value: its key") String whenKey,
        @Schema(description = "...and that value") String whenValue) {

    public record Option(String value, String label) {
    }

    public static FieldDto number(String key, String label, String group, double min, double max, double step,
                                  String unit, boolean required, String help) {
        return new FieldDto(key, label, group, "number", min, max, step, unit, null, required, help, null, null);
    }

    public static FieldDto select(String key, String label, String group, List<Option> options, String help) {
        return new FieldDto(key, label, group, "select", null, null, null, null, options, true, help, null, null);
    }

    public static FieldDto toggle(String key, String label, String group, String help) {
        return new FieldDto(key, label, group, "boolean", null, null, null, null, null, true, help, null, null);
    }

    public static FieldDto text(String key, String label, String group, String help) {
        return new FieldDto(key, label, group, "text", null, null, null, null, null, true, help, null, null);
    }

    /** The same field, shown only when another setting has the given value. */
    public FieldDto when(String key, String value) {
        return new FieldDto(this.key, label, group, type, min, max, step, unit, options, required, help, key, value);
    }
}
