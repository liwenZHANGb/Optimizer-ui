package com.lwoptimizer.ui.api.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Reference to a job that has just been started")
public record JobRef(String id) {
}
