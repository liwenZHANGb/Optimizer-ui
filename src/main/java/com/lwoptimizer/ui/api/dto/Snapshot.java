package com.lwoptimizer.ui.api.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

@Schema(description = "A plan at one moment of an optimization, with its score")
public record Snapshot<P>(
        @Schema(description = "Position of this snapshot in the job, starting at 0 with the submitted plan") int index,
        @Schema(description = "Solver step (generation, or improving solution) at which it was found") long step,
        @Schema(description = "Milliseconds since the job started") long elapsedMs,
        ScoreDto score,
        @Schema(description = "The plan, with its assignment and derived figures") P plan,
        @Schema(description = "The score broken down per constraint") List<ConstraintLine> analysis) {
}
