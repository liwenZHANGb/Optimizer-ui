package com.lwoptimizer.ui.api;

import com.lwoptimizer.ui.service.ConfigurationService;
import com.lwoptimizer.ui.service.JobService;
import com.lwoptimizer.ui.usecase.CarpoolingUseCase;
import com.lwoptimizer.usecase.carpooling.domain.CarpoolPlan;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/carpooling")
@Tag(name = "Carpooling",
        description = "Decide which driver picks up which riders, and in which order, so that everybody reaches "
                + "the destination on time with as little driving as possible.")
public class CarpoolingApi extends UseCaseApi<CarpoolPlan, CarpoolingUseCase.Plan> {

    public CarpoolingApi(CarpoolingUseCase useCase, JobService jobs, ConfigurationService configurations) {
        super(useCase, jobs, configurations);
    }
}
