package com.lwoptimizer.ui.api.dto;

import com.lwoptimizer.constraint.score.Score;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "A score with three levels. Higher is better; a level outweighs the ones below it.")
public record ScoreDto(
        @Schema(description = "Broken hard rules: below zero the plan is not usable") long hard,
        @Schema(description = "What could not be planned at all, for instance customers left unvisited") long medium,
        @Schema(description = "Cost and preferences") long soft,
        @Schema(description = "The score as text", example = "0hard/-22220soft") String text,
        @Schema(description = "True when no hard rule is broken") boolean feasible) {

    public static ScoreDto of(Score score) {
        return new ScoreDto(score.hard(), score.medium(), score.soft(), score.toString(), score.isFeasible());
    }
}
