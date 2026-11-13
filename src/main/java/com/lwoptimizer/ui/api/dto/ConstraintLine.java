package com.lwoptimizer.ui.api.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "The contribution of one constraint to the score of a plan")
public record ConstraintLine(
        String name,
        @Schema(description = "Identifier of the constraint in settings", example = "vehicle-capacity") String key,
        @Schema(description = "Level of the constraint: hard, medium or soft") String level,
        @Schema(description = "Weight it was applied with", example = "1hard") String weight,
        @Schema(description = "Number of times the constraint matched") long matches,
        @Schema(description = "Points this constraint takes from (or adds to) its level; negative for a penalty") long points,
        @Schema(description = "The contribution as a score", example = "0hard/-5800soft") String score) {
}
