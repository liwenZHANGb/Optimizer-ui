package com.lwoptimizer.ui.api.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "Why a request was refused")
public record ErrorDto(String message) {
}
