package com.lwoptimizer.ui.api.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "An optimization job")
public record JobDto<P>(
        String id,
        @Schema(description = "RUNNING, DONE or FAILED") String state,
        @Schema(description = "Engine that runs the job", example = "jenetics") String engine,
        @Schema(description = "Why the job ended, once it has", example = "UNIMPROVED_STEP_LIMIT") String terminationReason,
        @Schema(description = "What went wrong, for a failed job") String error,
        @Schema(description = "Number of snapshots published so far") int snapshots,
        @Schema(description = "The best plan so far; the final one when the job is done") Snapshot<P> best) {
}
