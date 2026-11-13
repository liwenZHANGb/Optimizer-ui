package com.lwoptimizer.ui.api.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "How one constraint is to be applied")
public record ConstraintSetting(
        @Schema(description = "Identifier of the constraint: its name in lower case with dashes", example = "balance-workload") String key,
        @Schema(description = "Display name", accessMode = Schema.AccessMode.READ_ONLY) String name,
        @Schema(description = "False removes the constraint from the score", defaultValue = "true") Boolean enabled,
        @Schema(description = "Nature of the constraint", allowableValues = {"hard", "medium", "soft"}) String level,
        @Schema(description = "Weight on that level, zero or more", example = "2") Long weight,
        @Schema(description = "PENALTY or REWARD", accessMode = Schema.AccessMode.READ_ONLY) String impact) {
}
