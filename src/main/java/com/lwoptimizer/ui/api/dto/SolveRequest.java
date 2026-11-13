package com.lwoptimizer.ui.api.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;
import java.util.Map;

@Schema(description = "What to optimize and how. Every part is optional.")
public record SolveRequest<P>(
        @Schema(description = """
                Settings that differ from the defaults, by key, as returned by GET /configuration. \
                Durations are in seconds. An empty value removes a setting.""",
                example = "{\"solver.engine\": \"jenetics\", \"solver.termination.timeLimit\": \"5\"}")
        Map<String, String> settings,
        @Schema(description = "Constraints to disable, re-weight or move to another level")
        List<ConstraintSetting> constraints,
        @Schema(description = """
                The problem to solve; the ready-made one when absent. It may already carry an \
                assignment and pins: the solver starts from it and does not change what is pinned.""")
        P plan) {
}
