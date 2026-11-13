package com.lwoptimizer.ui.api.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;
import java.util.Map;

@Schema(description = "Everything that can be tuned for a use case, with the default values")
public record ConfigurationDto(
        @Schema(description = "The tunable settings: solver, algorithm and, where relevant, problem data")
        List<FieldDto> fields,
        @Schema(description = "Default value of each setting, by key")
        Map<String, String> defaults,
        @Schema(description = "The constraints of the use case with their default nature, weight and state")
        List<ConstraintSetting> constraints) {
}
